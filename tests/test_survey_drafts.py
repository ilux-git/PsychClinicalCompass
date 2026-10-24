import asyncio
import json
from uuid import uuid4

import pytest
from sqlalchemy import func, select

from app.modules.adherence.rewards import ParticipationAward
from app.modules.audit.models import AuditEvent
from app.modules.surveys.models import SurveyAssignment, SurveyDraft, SurveySubmission


async def prepare(client, headers):
    survey = await client.post('/surveys', headers=headers('doctor'), json={
        'title': 'Проверка паузы', 'questions': [
            {'id': 'choice', 'kind': 'single', 'prompt': 'Выбор', 'options': [
                {'id': 'yes', 'label': 'Да'}, {'id': 'no', 'label': 'Нет'}]},
            {'id': 'note', 'kind': 'text', 'prompt': 'Комментарий'},
            {'id': 'scale', 'kind': 'scale', 'prompt': 'Число', 'required': False, 'minimum': 0, 'maximum': 5}]})
    assert survey.status_code == 201
    sid = survey.json()['id']
    await client.post(f'/surveys/{sid}/publish', headers=headers('doctor'))
    assignment = await client.post(f'/surveys/{sid}/assign', headers=headers('doctor'), json={
        'patient_ids': [1], 'client_request_id': str(uuid4())})
    return assignment.json()['assignment_ids'][0]


async def test_private_partial_draft_is_not_a_submission_or_award(client, headers, database):
    aid = await prepare(client, headers)
    path = f'/survey-assignments/{aid}/draft'
    original = (await client.get(path, headers=headers('patient1'))).json()
    assert original['answers'] == {} and original['revision'] == 0 and original['updated_at'] is None
    secret = 'Рабочий ответ: только пациент'
    saved = await client.put(path, headers=headers('patient1'), json={'answers': {'note': secret}, 'expected_revision': 0})
    assert saved.status_code == 200
    assert saved.json()['revision'] == 1 and saved.json()['updated_at']
    assert (await client.get(path, headers=headers('patient1'))).json()['answers'] == {'note': secret}
    patient_list = (await client.get('/survey-assignments', headers=headers('patient1'))).json()
    assert patient_list[0]['draft_updated_at'] and patient_list[0]['submission'] is None
    doctor_list = await client.get('/survey-assignments', headers=headers('doctor'))
    assert secret not in doctor_list.text and 'draft_updated_at' not in doctor_list.text
    report = (await client.get('/analytics/engagement', headers=headers('doctor'))).json()
    assert report['completed'] == 0 and report['quotes'] == []
    assert secret not in (await client.get('/analytics/engagement', headers=headers('admin'))).text
    async with database() as session:
        assert await session.scalar(select(func.count(SurveySubmission.id))) == 0
        assert await session.scalar(select(func.count(ParticipationAward.id))) == 0
        assignment = await session.get(SurveyAssignment, aid)
        assert assignment.status == 'assigned' and assignment.first_opened_at is None
        events = (await session.scalars(select(AuditEvent).where(AuditEvent.event_type == 'survey.draft_saved'))).all()
        assert len(events) == 1 and events[0].actor_id
        assert secret not in json.dumps([event.details for event in events], ensure_ascii=False)


async def test_draft_checks_role_patient_and_partial_answer_types(client, headers):
    aid = await prepare(client, headers)
    path = f'/survey-assignments/{aid}/draft'
    valid = {'answers': {'note': 'Только часть'}, 'expected_revision': 0}
    for role, status in [('doctor', 403), ('doctor2', 403), ('admin', 403), ('patient2', 404), ('patient3', 404)]:
        assert (await client.get(path, headers=headers(role))).status_code == status
        assert (await client.put(path, headers=headers(role), json=valid)).status_code == status
    for answers in [{'unknown': 'answer'}, {'choice': 'bad'}, {'scale': True}, {'scale': 6}, {'note': ['text']}]:
        assert (await client.put(path, headers=headers('patient1'), json={**valid, 'answers': answers})).status_code == 422
    assert (await client.put(path, headers=headers('patient1'), json={**valid, 'expected_revision': True})).status_code == 422
    empty = (await client.put(path, headers=headers('patient1'), json={'answers': {}, 'expected_revision': 0})).json()
    assert empty['revision'] == 0 and empty['replayed']
    assert (await client.put(path, headers=headers('patient1'), json=valid)).status_code == 200
    assert (await client.post(f'/survey-assignments/{aid}/submit', headers=headers('patient1'), json={
        'answers': {'note': 'Только часть'}, 'expected_draft_revision': 1})).status_code == 422


async def test_concurrent_drafts_conflict_and_final_submission_is_once(client, headers, database):
    aid = await prepare(client, headers)
    path = f'/survey-assignments/{aid}/draft'
    results = await asyncio.gather(*[client.put(path, headers=headers('patient1'), json={
        'answers': {'note': value}, 'expected_revision': 0}) for value in ('Первое окно', 'Второе окно')])
    assert sorted(r.status_code for r in results) == [200, 409]
    current = (await client.get(path, headers=headers('patient1'))).json()
    assert current['revision'] == 1
    retry = await client.put(path, headers=headers('patient1'), json={'answers': current['answers'], 'expected_revision': 0})
    assert retry.json()['replayed'] and retry.json()['revision'] == 1
    assert (await client.put(path, headers=headers('patient1'), json={
        'answers': current['answers'], 'expected_revision': 9})).status_code == 409
    final = {'answers': {'note': 'Отправленный ответ', 'choice': 'no'}}
    for extra in ({}, {'expected_draft_revision': 0}):
        assert (await client.post(f'/survey-assignments/{aid}/submit', headers=headers('patient1'), json={**final, **extra})).status_code == 409
    final['expected_draft_revision'] = 1
    results = await asyncio.gather(*[client.post(f'/survey-assignments/{aid}/submit', headers=headers('patient1'), json=final) for _ in range(2)])
    assert all(r.status_code == 200 for r in results)
    assert sorted(r.json()['replayed'] for r in results) == [False, True]
    assert (await client.get(path, headers=headers('patient1'))).json()['already_completed']
    assert (await client.put(path, headers=headers('patient1'), json={
        'answers': {'note': 'Поздняя запись'}, 'expected_revision': 1})).status_code == 409
    async with database() as session:
        assert await session.scalar(select(func.count(SurveyDraft.assignment_id))) == 0
        assert await session.scalar(select(func.count(SurveySubmission.id))) == 1
        awards = (await session.scalars(select(ParticipationAward))).all()
        assert len(awards) == 1 and awards[0].points == 3
        assert await session.scalar(select(func.count(AuditEvent.id)).where(AuditEvent.event_type == 'survey.draft_saved')) == 1


async def test_draft_and_final_write_cannot_overwrite_each_other(client, headers, database):
    aid = await prepare(client, headers)
    path = f'/survey-assignments/{aid}'
    await client.put(path+'/draft', headers=headers('patient1'), json={'answers': {'note': 'Версия один'}, 'expected_revision': 0})
    draft, final = await asyncio.gather(
        client.put(path+'/draft', headers=headers('patient1'), json={'answers': {'note': 'Версия два'}, 'expected_revision': 1}),
        client.post(path+'/submit', headers=headers('patient1'), json={
            'answers': {'note': 'Окончательный ответ', 'choice': 'yes'}, 'expected_draft_revision': 1}))
    assert sorted([draft.status_code, final.status_code]) == [200, 409]
    async with database() as session:
        submission = await session.scalar(select(SurveySubmission))
        working = await session.get(SurveyDraft, aid)
        if final.status_code == 200:
            assert submission.answers['note'] == 'Окончательный ответ' and working is None
        else:
            assert submission is None and working.answers == {'note': 'Версия два'} and working.revision == 2


async def test_failed_final_transaction_keeps_private_draft(client, headers, database, monkeypatch):
    import app.modules.surveys.service as service
    aid = await prepare(client, headers)
    path = f'/survey-assignments/{aid}'
    await client.put(path+'/draft', headers=headers('patient1'), json={'answers': {'note': 'Сохранено до сбоя'}, 'expected_revision': 0})
    async def fail(*args, **kwargs):
        raise RuntimeError('Injected final award failure')
    monkeypatch.setattr(service, 'grant_points', fail)
    with pytest.raises(RuntimeError, match='Injected final award failure'):
        await client.post(path+'/submit', headers=headers('patient1'), json={
            'answers': {'note': 'Полный ответ', 'choice': 'yes'}, 'expected_draft_revision': 1})
    async with database() as session:
        working = await session.get(SurveyDraft, aid)
        assert working.revision == 1 and working.answers == {'note': 'Сохранено до сбоя'}
        assert (await session.get(SurveyAssignment, aid)).status == 'assigned'
        assert await session.scalar(select(func.count(SurveySubmission.id))) == 0
        assert await session.scalar(select(func.count(ParticipationAward.id))) == 0
        assert await session.scalar(select(func.count(AuditEvent.id)).where(AuditEvent.event_type == 'survey.completed')) == 0
