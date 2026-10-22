import asyncio
from datetime import datetime, timezone
from uuid import uuid4

import pytest
from sqlalchemy import func, select, update

from app.modules.access.models import TelegramBinding
from app.modules.alerts.models import Alert, ClinicalDecision
from app.modules.assessments.models import OutboxEvent, QuestionnaireResponse
from app.modules.audit.models import AuditEvent
from app.modules.messaging.models import Message
from app.workers.outbox_worker import process_pending_events


async def assessment(client, headers, answers=None):
    payload = {"form_type": "phq9", "form_version": "demo-v1", "answers": answers or [1] * 9,
               "client_request_id": str(uuid4())}
    response = await client.post('/assessments/responses', headers=headers('patient1'), json=payload)
    assert response.status_code == 201
    return response, payload


async def test_assessment_outbox_and_manual_review_are_idempotent(client, headers, database):
    response, payload = await assessment(client, headers)
    retry = await client.post('/assessments/responses', headers=headers('patient1'), json=payload)
    assert retry.json()['id'] == response.json()['id']
    assert response.json()['risk_flags'] == ['phq9_item9_positive']
    assert sum(await asyncio.gather(process_pending_events(), process_pending_events())) == 1
    alerts = (await client.get('/alerts', headers=headers('doctor'))).json()
    assert len(alerts) == 1
    alert, decision = alerts[0], alerts[0]['decision']
    assert alert['severity'] == 'review_required'
    assert decision['requires_doctor_approval'] and decision['mis_write_performed'] is False
    assert decision['facts']['assessment_id'] == response.json()['id']
    assert decision['confirmed_by'] is None
    close = f"/alerts/{alert['id']}/close"
    assert (await client.post(close, headers=headers('doctor'))).status_code == 409
    path = f"/clinical-decisions/{decision['id']}/confirm"
    action = {'action': 'confirmed', 'expected_version': 1, 'reason': 'Учебная оценка зафиксирована врачом'}
    assert (await client.post(path, headers=headers('doctor2'), json=action)).status_code == 404
    assert (await client.post(path, headers=headers('patient1'), json=action)).status_code == 403
    assert (await client.post(path, headers=headers('doctor'), json={**action, 'expected_version': 2})).status_code == 409
    confirmed = (await client.post(path, headers=headers('doctor'), json=action)).json()
    assert confirmed['version'] == 2 and confirmed['confirmed_by'] is not None
    assert (await client.post(path, headers=headers('doctor'), json=action)).json() == confirmed
    assert (await client.post(path, headers=headers('doctor'), json={**action, 'action':'declined'})).status_code == 409
    assert (await client.post(close, headers=headers('doctor'))).json()['status'] == 'closed'
    # Replay of the outbox event cannot multiply the alert or its decision.
    async with database() as session:
        await session.execute(update(OutboxEvent).values(status='pending'))
        await session.commit()
    await process_pending_events()
    async with database() as session:
        assert await session.scalar(select(func.count(Alert.id))) == 1
        assert await session.scalar(select(func.count(ClinicalDecision.id))) == 1
        assert await session.scalar(select(func.count(AuditEvent.id)).where(AuditEvent.event_type == 'doctor.decision_recorded')) == 1


@pytest.mark.parametrize('domain', ['assessments', 'messaging'])
async def test_business_event_and_audit_rollback_together(client, headers, database, monkeypatch, domain):
    if domain == 'assessments':
        import app.modules.assessments.service as service
        model = QuestionnaireResponse
        path, payload = '/assessments/responses', {'form_type':'phq9','form_version':'demo','answers':[1]*9}
        role = 'patient1'
    else:
        import app.modules.messaging.service as service
        model = Message
        path, payload = '/conversations/1/messages', {'text':'Test atomic write','channel':'tg_doctor'}
        role = 'doctor'
    def fail(*args, **kwargs):
        raise RuntimeError('Injected transaction failure')
    monkeypatch.setattr(service, 'record_event', fail)
    with pytest.raises(RuntimeError, match='Injected transaction failure'):
        await client.post(path, headers=headers(role), json=payload)
    async with database() as session:
        assert await session.scalar(select(func.count(model.id))) == 0
        assert await session.scalar(select(func.count(OutboxEvent.id))) == 0
        assert await session.scalar(select(func.count(AuditEvent.id))) == 0


async def test_unknown_event_retries_and_fails_without_partial_work(client, database):
    async with database() as session:
        event = OutboxEvent(event_type='unsupported', payload={'text':'must not appear in logs'}, attempts=0)
        session.add(event)
        await session.commit()
        event_id = event.id
    for _ in range(5):
        async with database() as session:
            await session.execute(update(OutboxEvent).where(OutboxEvent.id == event_id).values(next_attempt_at=datetime.now(timezone.utc)))
            await session.commit()
        assert await process_pending_events() == 0
    async with database() as session:
        event = await session.get(OutboxEvent, event_id)
        assert (event.status, event.attempts, event.last_error, event.processed_at) == ('failed', 5, 'ValueError', None)
        assert await session.scalar(select(func.count(Alert.id))) == 0
    assert await process_pending_events() == 0


async def test_worker_savepoint_rolls_back_partial_handler_work(client, database, monkeypatch):
    import app.workers.outbox_worker as worker
    async def fail(session, event):
        session.add(AuditEvent(actor_id=None, patient_id=1, event_type='partial', object_type='test', object_id=None, details={}))
        await session.flush()
        raise RuntimeError('Injected handler failure')
    monkeypatch.setattr(worker, '_handle_event', fail)
    async with database() as session:
        session.add(OutboxEvent(event_type='test', payload={}))
        await session.commit()
    assert await worker.process_pending_events() == 0
    async with database() as session:
        assert await session.scalar(select(func.count(AuditEvent.id))) == 0
        event = await session.scalar(select(OutboxEvent))
        assert event.attempts == 1 and event.status == 'pending'


async def test_message_replay_cursor_and_simulated_delivery(client, headers, database):
    path = '/conversations/1/messages'
    payload = {'text':'Синтетическое сообщение','channel':'tg_doctor','client_request_id':str(uuid4())}
    results = await asyncio.gather(*[client.post(path, headers=headers('doctor'), json=payload) for _ in range(2)])
    assert results[0].json()['id'] == results[1].json()['id']
    assert (await client.post(path, headers=headers('doctor'), json={**payload,'text':'changed'})).status_code == 409
    assert (await client.post('/conversations/2/messages', headers=headers('doctor'), json=payload)).status_code == 404
    assert await process_pending_events() == 1
    history = (await client.get(path, headers=headers('patient1'))).json()
    assert len(history) == 1 and history[0]['status'] == 'simulated'
    async with database() as session:
        for i in range(105):
            session.add(Message(patient_id=1, sender_id=None, sender_role='patient', text=f'Message {i}', channel='web', status='sent'))
        await session.commit()
    recent = (await client.get(path, headers=headers('doctor'))).json()
    assert len(recent) == 100 and recent[0]['text'] == 'Message 5' and recent[-1]['text'] == 'Message 104'
    newer = (await client.get(path + '?after_id=' + str(recent[-3]['id']), headers=headers('patient1'))).json()
    assert [row['text'] for row in newer] == ['Message 103','Message 104']
    assert (await client.get(path+'?limit=201', headers=headers('doctor'))).status_code == 422
    async with database() as session:
        assert await session.scalar(select(func.count(OutboxEvent.id))) == 1


async def test_telegram_requires_verified_binding_not_mis_id(client, database, accounts, monkeypatch):
    from app.core.config import get_settings
    settings = get_settings()
    path = '/integrations/telegram/webhook'
    update_body = {'message':{'message_id':1,'text':'Synthetic incoming','chat':{'type':'private','id':1},'from':{'id':1}}}
    assert (await client.post(path, json=update_body)).status_code == 503
    monkeypatch.setattr(settings, 'telegram_enabled', True)
    monkeypatch.setattr(settings, 'telegram_webhook_secret', 'test-secret')
    auth = {'X-Telegram-Bot-Api-Secret-Token':'test-secret'}
    assert (await client.post(path, json=update_body)).status_code == 403
    assert (await client.post(path, headers=auth, json=update_body)).status_code == 200
    async with database() as session:
        assert await session.scalar(select(func.count(Message.id))) == 0
        session.add(TelegramBinding(user_id=accounts['patient1'].id, telegram_chat_id=10001, telegram_user_id=20001, verified_at=datetime.now(timezone.utc)))
        await session.commit()
    update_body['message']['chat']['id'] = 10001
    await client.post(path, headers=auth, json=update_body)  # Wrong Telegram sender.
    async with database() as session:
        assert await session.scalar(select(func.count(Message.id))) == 0
    update_body['message']['from']['id'] = 20001
    await asyncio.gather(*[client.post(path, headers=auth, json=update_body) for _ in range(2)])
    async with database() as session:
        rows = (await session.scalars(select(Message))).all()
        assert len(rows) == 1 and rows[0].patient_id == 1 and rows[0].sender_id == accounts['patient1'].id
    for malformed in ([], {'message':[]}, {'message':{'chat':42}}, {'message':{'chat':{},'from':[]}}):
        assert (await client.post(path, headers=auth, json=malformed)).json()['status'] == 'ignored'
