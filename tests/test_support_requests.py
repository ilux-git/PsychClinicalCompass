import asyncio
from uuid import uuid4

import pytest
from sqlalchemy import func, select, update

from app.modules.alerts.models import Alert, AlertHandling, ClinicalDecision
from app.modules.assessments.models import OutboxEvent
from app.modules.audit.models import AuditEvent
from app.modules.messaging.models import Message
from app.modules.notes.models import DoctorTask
from app.workers.outbox_worker import process_pending_events


async def request_support(client, headers, channel="web"):
    payload = {"text": "Учебный запрос: трудно подобрать время следующего визита",
               "channel": channel, "support_requested": True, "client_request_id": str(uuid4())}
    response = await client.post("/conversations/1/messages", headers=headers("patient1"), json=payload)
    assert response.status_code == 201
    return response.json(), payload


async def test_only_explicit_patient_intent_creates_support_event(client, headers, database):
    # Words never substitute for the explicit control, nor create a clinical decision.
    await client.post("/conversations/1/messages", headers=headers("patient1"),
                      json={"text": "Мне трудно, нужна поддержка", "channel": "web"})
    assert await process_pending_events() == 0
    message, payload = await request_support(client, headers)
    retry = await client.post("/conversations/1/messages", headers=headers("patient1"), json=payload)
    assert retry.json()["id"] == message["id"]
    assert (await client.post("/conversations/1/messages", headers=headers("patient1"),
                             json={**payload, "support_requested": False})).status_code == 409
    assert (await client.post("/conversations/1/messages", headers=headers("doctor"), json=payload)).status_code == 403
    queued = (await client.get("/patients/1/support-requests", headers=headers("patient1"))).json()
    assert len(queued) == 1 and queued[0]["status"] == "queued"
    assert sum(await asyncio.gather(process_pending_events(), process_pending_events())) == 1
    alerts = (await client.get("/alerts?patient_id=1", headers=headers("doctor"))).json()
    assert len(alerts) == 1 and alerts[0]["decision"] is None
    assert alerts[0]["source_kind"] == "support_request"
    assert alerts[0]["source_message"]["text"] == payload["text"]
    assert alerts[0]["severity"] == "support_requested"
    async with database() as session:
        assert await session.scalar(select(func.count(ClinicalDecision.id))) == 0
        await session.execute(update(OutboxEvent).values(status="pending"))
        await session.commit()
    await process_pending_events()
    async with database() as session:
        assert await session.scalar(select(func.count(Alert.id))) == 1
    path = "/patients/1/support-requests"
    assert (await client.get(path, headers=headers("doctor2"))).status_code == 404
    assert (await client.get(path, headers=headers("patient2"))).status_code == 404
    assert (await client.get(path, headers=headers("admin"))).status_code == 403


async def test_one_doctor_command_is_atomic_idempotent_and_scoped(client, headers, database):
    await request_support(client, headers)
    await process_pending_events()
    alert = (await client.get("/alerts", headers=headers("doctor"))).json()[0]
    path = f"/alerts/{alert['id']}/actions"
    payload = {"client_request_id": str(uuid4()), "title": "Уточнить варианты времени",
               "kind": "organization", "reply": "Учебный ответ: уточняю варианты времени", "reply_channel": "tg_doctor"}
    for other, expected in [("patient1", 403), ("admin", 403), ("doctor2", 404)]:
        assert (await client.post(path, headers=headers(other), json=payload)).status_code == expected
    results = await asyncio.gather(*[client.post(path, headers=headers("doctor"), json=payload) for _ in range(2)])
    assert all(result.status_code == 201 for result in results)
    assert results[0].json() == results[1].json()
    assert results[0].json()["mis_write_performed"] is False
    assert (await client.post(path, headers=headers("doctor"), json={**payload, "reply": "Другое"})).status_code == 409
    async with database() as session:
        assert await session.scalar(select(func.count(AlertHandling.id))) == 1
        assert await session.scalar(select(func.count(DoctorTask.id))) == 1
        assert await session.scalar(select(func.count(Message.id))) == 2
        task = await session.scalar(select(DoctorTask))
        assert task.source_type == "alert" and task.source_id == alert["id"]
        assert task.status == "open" and task.verification_status == "pending"
        assert (await session.get(Alert, alert["id"])).status == "acknowledged"
        assert await session.scalar(select(func.count(AuditEvent.id)).where(AuditEvent.event_type == "alert.action_planned")) == 1
    assert await process_pending_events() == 1
    history = (await client.get("/conversations/1/messages", headers=headers("patient1"))).json()
    assert history[-1]["status"] == "simulated" and not history[-1]["support_requested"]
    progress = (await client.get("/patients/1/support-requests", headers=headers("patient1"))).json()[0]
    assert progress["acknowledged_at"] and progress["external_delivery_performed"] is False
    refreshed = (await client.get("/alerts", headers=headers("doctor"))).json()[0]
    assert refreshed["actions"] == [{"task_id":results[0].json()["task_id"], "title":payload["title"], "status":"open",
                                       "reply_message_id":results[0].json()["reply_message_id"], "created_at":refreshed["actions"][0]["created_at"]}]
    metrics = (await client.get("/analytics/care", headers=headers("doctor"))).json()["support_requests"]
    assert metrics["total"] == metrics["acknowledged"] == metrics["with_task"] == metrics["with_linked_reply"] == 1
    assert metrics["acknowledgement_coverage"]["percent"] == 100
    assert metrics["median_to_linked_reply_seconds"] >= 0 and metrics["oldest_unacknowledged_seconds"] is None
    assert (await client.post(f"/alerts/{alert['id']}/close", headers=headers("doctor"))).status_code == 409


async def test_failed_doctor_command_does_not_half_acknowledge_or_send(client, headers, database, monkeypatch):
    import app.modules.alerts.router as router
    await request_support(client, headers)
    await process_pending_events()
    alert = (await client.get("/alerts", headers=headers("doctor"))).json()[0]
    def fail(*args, **kwargs):
        raise RuntimeError("Injected command audit failure")
    monkeypatch.setattr(router, "record_event", fail)
    with pytest.raises(RuntimeError, match="Injected command"):
        await client.post(f"/alerts/{alert['id']}/actions", headers=headers("doctor"), json={
            "client_request_id": str(uuid4()), "title": "Учебная задача", "reply": "Учебный ответ", "reply_channel": "tg_doctor"})
    async with database() as session:
        assert await session.scalar(select(func.count(DoctorTask.id))) == 0
        assert await session.scalar(select(func.count(AlertHandling.id))) == 0
        assert await session.scalar(select(func.count(Message.id))) == 1
        assert await session.scalar(select(func.count(OutboxEvent.id))) == 1
        assert (await session.get(Alert, alert["id"])).status == "created"


async def test_support_and_message_event_rollback_together(client, headers, database, monkeypatch):
    import app.modules.messaging.service as service
    def fail(*args, **kwargs):
        raise RuntimeError("Injected support audit failure")
    monkeypatch.setattr(service, "record_event", fail)
    with pytest.raises(RuntimeError, match="Injected support"):
        await request_support(client, headers, "tg_patient")
    async with database() as session:
        for model in (Message, OutboxEvent, Alert):
            assert await session.scalar(select(func.count(model.id))) == 0


async def test_doctor_action_validates_text_time_and_clinical_assignee(client, headers, accounts):
    await request_support(client, headers)
    await process_pending_events()
    alert = (await client.get("/alerts", headers=headers("doctor"))).json()[0]
    path = f"/alerts/{alert['id']}/actions"
    payload = {"client_request_id": str(uuid4()), "title": "Учебное действие"}
    for invalid in ({"title": " "}, {"due_at": "2026-10-25T12:00:00"}, {"assigned_to_id": accounts["doctor2"].id}):
        assert (await client.post(path, headers=headers("doctor"), json={**payload, **invalid})).status_code == 422
    valid = await client.post(path, headers=headers("doctor"), json=payload)
    assert valid.status_code == 201 and valid.json()["reply_message_id"] is None


async def test_many_requests_from_one_patient_do_not_make_safe_admin_group(client, headers, monkeypatch):
    import app.modules.analytics.care as care
    original = care.patient_snapshot
    monkeypatch.setattr(care, "patient_snapshot", lambda _: original(None))
    for _ in range(12):
        await request_support(client, headers)
    doctor = (await client.get("/analytics/care", headers=headers("doctor"))).json()["support_requests"]
    other = (await client.get("/analytics/care", headers=headers("doctor2"))).json()["support_requests"]
    assert doctor["total"] == doctor["queued"] == 12 and other["total"] == 0
    assert doctor["acknowledgement_coverage"]["numerator"] == 0
    assert doctor["median_to_acknowledgement_seconds"] is None
    policy = (await client.get("/admin/privacy-policy",headers=headers("admin"))).json()
    update = {"client_request_id":str(uuid4()),"min_group_size":1,"expected_revision":policy["revision"],"reason":"Синтетическая проверка"}
    changed = (await client.put("/admin/privacy-policy",headers=headers("admin"),json=update)).json()
    summary = (await client.get("/analytics/clinic",headers=headers("admin"))).json()
    assert not summary["workflow"]["suppressed"]
    assert summary["workflow"]["values"]["support_requests"]["total"] == 12
    assert "трудно подобрать" not in str(summary) and "Иван" not in str(summary)
    update.update(client_request_id=str(uuid4()),min_group_size=2,expected_revision=changed["revision"])
    assert (await client.put("/admin/privacy-policy",headers=headers("admin"),json=update)).status_code == 200
    hidden = (await client.get("/analytics/clinic",headers=headers("admin"))).json()
    assert hidden["workflow"]["suppressed"] and hidden["workflow"]["values"] is None
