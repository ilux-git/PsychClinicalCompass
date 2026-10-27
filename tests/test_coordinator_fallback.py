import asyncio
from datetime import timedelta

import pytest
import pytest_asyncio
from sqlalchemy import func, select

from app.modules.access.models import User, UserRole
from app.modules.alerts.escalation import route_due_urgent_alerts
from app.modules.alerts.escalation_models import CoordinatorNotice, DoctorEscalationRoute
from app.modules.alerts.models import Alert, ClinicalDecision
from app.modules.assessments.catalog import GAD7_KEY, PANIC_KEY, PHQ9_KEY
from app.modules.assessments.models import OutboxEvent
from app.modules.audit.models import AuditEvent
from app.workers.outbox_worker import process_pending_events
from tests.conftest import TEST_HASH
from tests.test_clinical_instruments import values
from tests.test_clinical_review import complete

ROUTE = "/doctors/me/escalation-route"
NOTICES = "/coordination/urgent-notices"


@pytest_asyncio.fixture
async def coordinators(accounts, database):
    async with database() as session:
        for name in ("coordinator", "coordinator2"):
            user = User(username=name, display_name=name, role=UserRole.coordinator, hashed_password=TEST_HASH)
            session.add(user)
            await session.flush()
            accounts[name] = user
        await session.commit()
    return accounts


async def configure(client, headers, coordinators, name="coordinator", revision=0):
    response = await client.put(ROUTE, headers=headers("doctor"), json={
        "coordinator_id": coordinators[name].id if name else None, "expected_revision": revision})
    assert response.status_code == 200, response.text
    return response.json()


async def urgent(client, headers):
    await complete(client, headers, GAD7_KEY, values(7, 3))


async def test_route_is_explicit_scoped_revisioned_and_retries_do_not_reassign(client, headers, coordinators, database):
    initial = (await client.get(ROUTE, headers=headers("doctor"))).json()
    assert initial["coordinator_id"] is None and initial["revision"] == 0
    assert len(initial["coordinators"]) == 2
    for role in ("patient1", "admin", "coordinator"):
        assert (await client.get(ROUTE, headers=headers(role))).status_code == 403
        assert (await client.put(ROUTE, headers=headers(role), json={"coordinator_id": coordinators["coordinator"].id, "expected_revision": 0})).status_code == 403
    for recipient in (coordinators["doctor2"].id, coordinators["patient1"].id, 999999, True):
        assert (await client.put(ROUTE, headers=headers("doctor"), json={"coordinator_id": recipient, "expected_revision": 0})).status_code == 422
    first = await configure(client, headers, coordinators)
    assert first["revision"] == 1 and not first["replayed"]
    assert (await configure(client, headers, coordinators))["replayed"]
    conflict = await client.put(ROUTE, headers=headers("doctor"), json={"coordinator_id": coordinators["coordinator2"].id, "expected_revision": 0})
    assert conflict.status_code == 409
    assert (await client.get(ROUTE, headers=headers("doctor2"))).json()["coordinator_id"] is None
    assert (await configure(client, headers, coordinators, None, 1))["revision"] == 2
    async with database() as session:
        assert await session.scalar(select(func.count(AuditEvent.id)).where(AuditEvent.event_type == "coordination.route_changed")) == 2


@pytest.mark.parametrize("availability,expected", [("available", 0), ("busy", 0), ("offline", 1), ("on_leave", 1)])
async def test_only_agreed_unavailable_states_route_a_new_unaccepted_urgent_event(client, headers, coordinators, database, availability, expected):
    await configure(client, headers, coordinators)
    assert (await client.patch("/doctors/me/availability", headers=headers("doctor"), json={"availability": availability})).status_code == 200
    await urgent(client, headers)
    assert await process_pending_events() == 1
    async with database() as session:
        rows = list((await session.scalars(select(CoordinatorNotice))).all())
        assert len(rows) == expected
        if expected:
            assert rows[0].reason == "doctor_unavailable" and rows[0].patient_id == 1
            assert rows[0].coordinator_id == coordinators["coordinator"].id


async def test_expired_original_deadline_routes_once_even_without_new_outbox_events(client, headers, coordinators, database):
    await configure(client, headers, coordinators)
    await client.patch("/doctors/me/availability", headers=headers("doctor"), json={"availability": "available"})
    await urgent(client, headers)
    # Explicit legacy snapshot: new results no longer inherit the former 2h clock.
    from app.modules.assessments.clinical_models import ClinicalResult
    from app.modules.assessments.triage import assess_review
    async with database() as session:
        result = await session.scalar(select(ClinicalResult))
        result.result = {**result.result, "triage": assess_review(GAD7_KEY, result.score, result.result)}
        await session.commit()
    await process_pending_events()
    async with database() as session:
        alert = await session.scalar(select(Alert))
        assert await route_due_urgent_alerts(session, now=alert.acknowledgement_due_at) == 0
        assert await route_due_urgent_alerts(session, now=alert.acknowledgement_due_at + timedelta(microseconds=1)) == 1
        await session.commit()
    assert await process_pending_events() == 0
    async with database() as session:
        notice = await session.scalar(select(CoordinatorNotice))
        assert notice.reason == "acknowledgement_overdue"
        assert await session.scalar(select(func.count(CoordinatorNotice.id))) == 1


async def test_no_automatic_recipient_and_no_escalation_after_doctor_acceptance(client, headers, coordinators, database):
    await urgent(client, headers)
    await process_pending_events()
    assert (await client.get(NOTICES, headers=headers("coordinator"))).json()["items"] == []
    alert = (await client.get("/alerts?patient_id=1", headers=headers("doctor"))).json()[0]
    await client.post(f"/alerts/{alert['id']}/acknowledge", headers=headers("doctor"), json={})
    await configure(client, headers, coordinators)
    await process_pending_events()
    async with database() as session:
        assert await session.scalar(select(func.count(CoordinatorNotice.id))) == 0


async def test_item9_now_routes_as_high_when_unavailable_but_panic_does_not(client, headers, coordinators, database):
    await configure(client, headers, coordinators)
    await complete(client, headers, PHQ9_KEY, {**values(9, 0), "q9": "n1"})
    await complete(client, headers, PANIC_KEY, values(15, 1))
    await process_pending_events()
    async with database() as session:
        assert await session.scalar(select(func.count(Alert.id))) == 2
        assert await session.scalar(select(func.count(CoordinatorNotice.id))) == 1


async def test_coordinator_receives_only_operational_context_and_cannot_accept_clinical_work(client, headers, coordinators, database):
    await configure(client, headers, coordinators)
    await urgent(client, headers)
    await process_pending_events()
    page = (await client.get(NOTICES, headers=headers("coordinator"))).json()
    assert page["pending"] == 1 and len(page["items"]) == 1
    notice = page["items"][0]
    assert set(notice) == {"id", "patient_id", "doctor_id", "doctor_name", "reason", "created_at", "acknowledged_at", "state", "original_acknowledgement_due_at"}
    assert notice["patient_id"] == 1 and notice["state"] == "pending"
    assert "Иван Петров" not in str(page) and "score" not in str(page)
    assert (await client.get(NOTICES, headers=headers("coordinator2"))).json()["items"] == []
    path = f"{NOTICES}/{notice['id']}/acknowledge"
    assert (await client.post(path, headers=headers("coordinator2"), json={})).status_code == 404
    assert (await client.post(path, headers=headers("doctor"), json={})).status_code == 403
    receipts = [(await client.post(path, headers=headers("coordinator"), json={})).json() for _ in range(2)]
    assert receipts[0] == receipts[1] and not receipts[0]["clinical_alert_acknowledged"]
    for resource in ("/patients/1", "/patients/1/clinical-results", "/patients/1/notes", "/alerts/inbox"):
        assert (await client.get(resource, headers=headers("coordinator"))).status_code in (403, 404)
    async with database() as session:
        alert = await session.scalar(select(Alert))
        decision = await session.scalar(select(ClinicalDecision))
        assert alert.status == "created" and alert.acknowledged_at is None and decision.status == "pending_review"
        assert await session.scalar(select(func.count(AuditEvent.id)).where(AuditEvent.event_type == "coordination.urgent_acknowledged")) == 1
    assert (await client.get(NOTICES, headers=headers("coordinator"))).json()["items"][0]["state"] == "accepted_by_coordinator"


async def test_concurrent_materialization_cannot_duplicate_notice_or_audit(client, headers, coordinators, database):
    await urgent(client, headers)
    await process_pending_events()
    await configure(client, headers, coordinators)
    async def route():
        async with database() as session:
            count = await route_due_urgent_alerts(session)
            await session.commit()
            return count
    assert sum(await asyncio.gather(route(), route())) == 1
    async with database() as session:
        assert await session.scalar(select(func.count(CoordinatorNotice.id))) == 1
        assert await session.scalar(select(func.count(AuditEvent.id)).where(AuditEvent.event_type == "coordination.urgent_routed")) == 1


async def test_notice_audit_failure_rolls_back_notice_and_retries_without_losing_clinical_source(client, headers, coordinators, database, monkeypatch):
    from app.modules.alerts import escalation
    await configure(client, headers, coordinators)
    await urgent(client, headers)
    original = escalation.record_event
    def fail(*args, **kwargs):
        raise RuntimeError("controlled operational audit failure")
    monkeypatch.setattr(escalation, "record_event", fail)
    assert await process_pending_events() == 1
    async with database() as session:
        assert await session.scalar(select(func.count(CoordinatorNotice.id))) == 0
        assert await session.scalar(select(func.count(Alert.id))) == 1
        assert await session.scalar(select(OutboxEvent.status)) == "processed"
    monkeypatch.setattr(escalation, "record_event", original)
    assert await process_pending_events() == 0
    assert await process_pending_events() == 0
    async with database() as session:
        assert await session.scalar(select(func.count(CoordinatorNotice.id))) == 1


async def test_route_change_only_affects_undispatched_notices_and_cursor_keeps_recipient_scope(client, headers, coordinators):
    await configure(client, headers, coordinators)
    await urgent(client, headers)
    await urgent(client, headers)
    await process_pending_events()
    first = (await client.get(NOTICES + "?limit=1", headers=headers("coordinator"))).json()
    assert len(first["items"]) == 1 and first["next_before_id"] is not None
    second = (await client.get(NOTICES + f"?limit=1&before_id={first['next_before_id']}", headers=headers("coordinator"))).json()
    assert second["items"][0]["id"] < first["items"][0]["id"] and second["next_before_id"] is None
    await configure(client, headers, coordinators, "coordinator2", 1)
    await urgent(client, headers)
    await process_pending_events()
    assert len((await client.get(NOTICES, headers=headers("coordinator"))).json()["items"]) == 2
    assert len((await client.get(NOTICES, headers=headers("coordinator2"))).json()["items"]) == 1
    for role in ("doctor", "patient1", "admin"):
        assert (await client.get(NOTICES, headers=headers(role))).status_code == 403


async def test_doctor_acceptance_removes_active_notice_but_keeps_history_without_forged_coordinator_receipt(client, headers, coordinators, database):
    await configure(client, headers, coordinators)
    await urgent(client, headers)
    await process_pending_events()
    alert = (await client.get("/alerts?patient_id=1", headers=headers("doctor"))).json()[0]
    await client.post(f"/alerts/{alert['id']}/acknowledge", headers=headers("doctor"), json={})
    current = (await client.get(NOTICES, headers=headers("coordinator"))).json()
    assert current["items"] == [] and current["active"] == 0 and current["pending"] == 0
    history = (await client.get(NOTICES + "?view=all", headers=headers("coordinator"))).json()
    assert history["items"][0]["state"] == "accepted_by_doctor"
    assert history["items"][0]["acknowledged_at"] is None
    async with database() as session:
        assert await session.scalar(select(func.count(AuditEvent.id)).where(AuditEvent.event_type == "coordination.urgent_acknowledged")) == 0


async def test_concurrent_route_choices_require_a_fresh_revision(client, headers, coordinators):
    choices = await asyncio.gather(*[client.put(ROUTE, headers=headers("doctor"), json={
        "coordinator_id": coordinators[name].id, "expected_revision": 0}) for name in ("coordinator", "coordinator2")])
    assert sorted(response.status_code for response in choices) == [200, 409]
    current = (await client.get(ROUTE, headers=headers("doctor"))).json()
    assert current["revision"] == 1 and current["coordinator_id"] in {coordinators['coordinator'].id, coordinators['coordinator2'].id}
