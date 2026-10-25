from datetime import datetime, timezone
from uuid import uuid4

import pytest
from sqlalchemy import func, select

from app.modules.adherence.models import DiaryEntry
from app.modules.adherence.rewards import POLICY_VERSION, ParticipationAward
from app.modules.surveys.models import SurveySubmission


async def assignment(client, headers):
    response = await client.post('/surveys', headers=headers('doctor'), json={
        'title': 'Обратная связь', 'questions': [
            {'id': 'note', 'prompt': 'Что хотите сообщить?', 'kind': 'text'},
            {'id': 'choice', 'prompt': 'Есть ли вопрос?', 'kind': 'single',
             'options': [{'id': 'yes', 'label': 'Да'}, {'id': 'no', 'label': 'Нет'}]},
        ]})
    assert response.status_code == 201
    survey_id = response.json()['id']
    assert (await client.post(f'/surveys/{survey_id}/publish', headers=headers('doctor'))).status_code == 200
    response = await client.post(f'/surveys/{survey_id}/assign', headers=headers('doctor'),
                                 json={'patient_ids': [1], 'client_request_id': str(uuid4())})
    assert response.status_code == 201
    return response.json()['assignment_ids'][0]


async def test_diary_receipt_matches_saved_award_replay_and_daily_cap(client, headers, database):
    payload = {'text': 'Синтетическое наблюдение', 'client_request_id': str(uuid4()),
               'shared_with_doctor': False}
    first = await client.post('/diary/entries', headers=headers('patient1'), json=payload)
    assert first.status_code == 201
    receipt = first.json()['participation']
    assert receipt['points'] == 3 and receipt['policy_version'] == POLICY_VERSION and receipt['recorded_at']
    retry = await client.post('/diary/entries', headers=headers('patient1'), json=payload)
    assert retry.json()['replayed'] is True and retry.json()['participation'] == receipt
    second = await client.post('/diary/entries', headers=headers('patient1'),
                               json={**payload, 'text': 'Ещё наблюдение', 'client_request_id': str(uuid4())})
    assert second.json()['participation']['points'] == 0
    assert (await client.get('/participation/points', headers=headers('patient1'))).json()['balance'] == 3
    assert (await client.get('/patients/1/diary', headers=headers('doctor'))).json()['entries'] == []
    async with database() as session:
        assert await session.scalar(select(func.count(ParticipationAward.id))) == 2


async def test_survey_receipt_reports_actual_capped_points_and_owned_replay(client, headers, database):
    async with database() as session:
        session.add(ParticipationAward(patient_id=1, kind='survey', source_key='existing-test-award',
                    points=29, day=datetime.now(timezone.utc).date(), policy_version=POLICY_VERSION))
        await session.commit()
    aid = await assignment(client, headers)
    url = f'/survey-assignments/{aid}/submit'
    payload = {'answers': {'note': 'Любой честный ответ', 'choice': 'no'}}
    for role, status in [('doctor', 403), ('admin', 403), ('patient2', 404)]:
        response = await client.post(url, headers=headers(role), json=payload)
        assert response.status_code == status and 'participation' not in response.json()
    first = await client.post(url, headers=headers('patient1'), json=payload)
    assert first.status_code == 200
    receipt = first.json()['participation']
    assert receipt['points'] == 1  # Effort is 3, but only 1 point remains under today's cap.
    retry = await client.post(url, headers=headers('patient1'), json=payload)
    assert retry.json()['replayed'] is True and retry.json()['participation'] == receipt
    other = await assignment(client, headers)
    capped = await client.post(f'/survey-assignments/{other}/submit', headers=headers('patient1'), json=payload)
    assert capped.json()['participation']['points'] == 0
    assert (await client.get('/participation/points', headers=headers('patient1'))).json()['balance'] == 30


async def test_legacy_submission_without_linked_award_has_unknown_receipt_not_zero(client, headers, database):
    aid = await assignment(client, headers)
    answers = {'note': 'Исторический ответ', 'choice': 'yes'}
    async with database() as session:
        session.add(SurveySubmission(patient_id=1, assignment_id=aid, answers=answers))
        await session.commit()
    response = await client.post(f'/survey-assignments/{aid}/submit', headers=headers('patient1'),
                                 json={'answers': answers})
    assert response.status_code == 200 and response.json()['replayed'] is True
    assert response.json()['participation'] is None
    async with database() as session:
        assert await session.scalar(select(func.count(ParticipationAward.id))) == 0


async def test_receipt_read_failure_does_not_commit_diary_or_award(client, headers, database, monkeypatch):
    import app.modules.adherence.router as diary

    async def fail(*args, **kwargs):
        raise RuntimeError('receipt-read-failure')

    monkeypatch.setattr(diary, 'participation_receipt', fail)
    with pytest.raises(RuntimeError, match='receipt-read-failure'):
        await client.post('/diary/entries', headers=headers('patient1'),
                          json={'text': 'Синтетика', 'client_request_id': str(uuid4())})
    async with database() as session:
        assert await session.scalar(select(func.count(DiaryEntry.id))) == 0
        assert await session.scalar(select(func.count(ParticipationAward.id))) == 0
