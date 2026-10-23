import asyncio
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from sqlalchemy import func, select, update

from app.modules.alerts.models import Alert, AlertPresentation
from app.modules.assessments.models import OutboxEvent
from app.modules.audit.models import AuditEvent
from app.modules.patients.models import Patient
from app.workers.outbox_worker import process_pending_events


async def create_alert(client, headers, patient="patient1"):
    result = await client.post("/assessments/responses", headers=headers(patient), json={
        "form_type": "phq9", "form_version": "demo-v1", "answers": [1] * 9,
        "client_request_id": str(uuid4()),
    })
    assert result.status_code == 201
    await process_pending_events()
    return result.json()["id"]


async def test_inbox_scope_counts_and_cursor(client, headers):
    for patient in ("patient1", "patient1", "patient3", "patient2"):
        await create_alert(client, headers, patient)
    first = (await client.get("/alerts/inbox?limit=2", headers=headers("doctor"))).json()
    assert (first["total_open"], first["not_presented"]) == (3, 3)
    assert len(first["items"]) == 2
    assert {item["patient_id"] for item in first["items"]} <= {1, 3}
    assert not first["external_delivery_performed"]
    second = (await client.get(f'/alerts/inbox?limit=2&before_id={first["next_before_id"]}', headers=headers("doctor"))).json()
    assert len(second["items"]) == 1 and second["next_before_id"] is None
    assert first["items"][-1]["id"] > second["items"][0]["id"]
    assert second["total_open"] == 3  # Counts describe the whole owned queue, not the current page.
    other = (await client.get("/alerts/inbox", headers=headers("doctor2"))).json()
    assert len(other["items"]) == 1 and other["items"][0]["patient_id"] == 2
    for role in ("patient1", "admin"):
        assert (await client.get("/alerts/inbox", headers=headers(role))).status_code == 403
    assert (await client.get("/alerts/inbox?limit=101", headers=headers("doctor"))).status_code == 422


async def test_presentation_is_idempotent_authorized_and_not_a_decision(client, headers, database, accounts):
    await create_alert(client, headers)
    item = (await client.get("/alerts/inbox", headers=headers("doctor"))).json()["items"][0]
    path = f'/alerts/{item["id"]}/presented'
    for role, status in (("doctor2", 404), ("admin", 403), ("patient1", 403)):
        assert (await client.post(path, headers=headers(role), json={})).status_code == status
    replies = await asyncio.gather(*[client.post(path, headers=headers("doctor"), json={}) for _ in range(2)])
    assert all(reply.status_code == 200 for reply in replies)
    assert replies[0].json() == replies[1].json()
    assert replies[0].json()["human_read_confirmed"] is False
    current = (await client.get("/alerts/inbox", headers=headers("doctor"))).json()
    assert current["not_presented"] == 0 and current["items"][0]["status"] == "created"
    alert = (await client.get("/alerts", headers=headers("doctor"))).json()[0]
    assert alert["decision"]["status"] == "pending_review" and alert["acknowledged_at"] is None
    async with database() as session:
        assert await session.scalar(select(func.count(AlertPresentation.id))) == 1
        audit = (await session.scalars(select(AuditEvent).where(AuditEvent.event_type == "alert.presented"))).all()
        assert len(audit) == 1 and audit[0].actor_id == accounts["doctor"].id
        assert audit[0].details == {"channel": "in_app", "human_read_confirmed": False}


async def test_reassignment_requires_new_doctors_own_presentation(client, headers, database, accounts):
    await create_alert(client, headers)
    item = (await client.get("/alerts/inbox", headers=headers("doctor"))).json()["items"][0]
    path = f'/alerts/{item["id"]}/presented'
    assert (await client.post(path, headers=headers("doctor"))).status_code == 200
    async with database() as session:
        await session.execute(update(Patient).where(Patient.id == 1).values(doctor_id=accounts["doctor2"].id))
        await session.commit()
    assert (await client.post(path, headers=headers("doctor"))).status_code == 404
    other = (await client.get("/alerts/inbox", headers=headers("doctor2"))).json()
    assert other["not_presented"] == 1 and other["items"][0]["presented_at"] is None
    assert (await client.post(path, headers=headers("doctor2"))).status_code == 200
    async with database() as session:
        assert await session.scalar(select(func.count(AlertPresentation.id))) == 2


async def test_intervals_use_ingestion_event_and_unknown_is_not_zero(client, headers, database, accounts):
    await create_alert(client, headers)
    start = datetime(2026, 10, 23, tzinfo=timezone.utc)
    async with database() as session:
        alert = await session.scalar(select(Alert))
        alert.created_at = start + timedelta(seconds=2)
        await session.execute(update(OutboxEvent).where(OutboxEvent.id == alert.source_event_id).values(created_at=start))
        session.add(AlertPresentation(alert_id=alert.id, doctor_id=accounts["doctor"].id, presented_at=start + timedelta(seconds=8)))
        await session.commit()
    item = (await client.get("/alerts/inbox", headers=headers("doctor"))).json()["items"][0]
    assert item["latency_seconds"] == {"event_to_alert": 2.0, "event_to_presentation": 8.0, "event_to_acknowledgement": None}
    async with database() as session:
        await session.execute(update(Alert).values(created_at=start - timedelta(seconds=1)))
        await session.commit()
    item = (await client.get("/alerts/inbox", headers=headers("doctor"))).json()["items"][0]
    assert item["latency_seconds"]["event_to_alert"] is None


async def test_acknowledged_stays_in_queue_until_doctor_closes_it(client, headers):
    await create_alert(client, headers)
    alert = (await client.get("/alerts", headers=headers("doctor"))).json()[0]
    prefix = f'/alerts/{alert["id"]}'
    assert (await client.post(prefix + "/acknowledge", headers=headers("doctor"))).status_code == 200
    assert (await client.get("/alerts/inbox", headers=headers("doctor"))).json()["total_open"] == 1
    assert (await client.post(prefix + "/close", headers=headers("doctor"))).status_code == 409
    await client.post(f'/clinical-decisions/{alert["decision"]["id"]}/confirm', headers=headers("doctor"),
                      json={"action": "declined", "expected_version": 1, "reason": "Синтетический тест"})
    assert (await client.post(prefix + "/close", headers=headers("doctor"))).status_code == 200
    assert (await client.get("/alerts/inbox", headers=headers("doctor"))).json()["total_open"] == 0


async def test_presentation_and_audit_rollback_together(client, headers, database, monkeypatch):
    import app.modules.alerts.router as router
    await create_alert(client, headers)
    alert = (await client.get("/alerts/inbox", headers=headers("doctor"))).json()["items"][0]
    def fail(*args, **kwargs):
        raise RuntimeError("Injected audit failure")
    monkeypatch.setattr(router, "record_event", fail)
    with pytest.raises(RuntimeError, match="Injected audit failure"):
        await client.post(f'/alerts/{alert["id"]}/presented', headers=headers("doctor"))
    async with database() as session:
        assert await session.scalar(select(func.count(AlertPresentation.id))) == 0
        assert await session.scalar(select(func.count(AuditEvent.id)).where(AuditEvent.event_type == "alert.presented")) == 0
