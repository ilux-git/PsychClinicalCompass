from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from sqlalchemy import func, select

from app.modules.adherence.medication_models import MedicationItem, MedicationLog
from app.modules.adherence.rewards import POLICY_VERSION, ParticipationAward
from app.modules.audit.models import AuditEvent


def schedule(**changes):
    return {"label": "Учебная личная позиция", "instructions": "Не назначение",
            "schedule_text": "Свободное учебное расписание", "schedule_kind": "description",
            "times": [], "weekdays": [], "timezone": "UTC", "starts_on": "2026-01-01",
            "ends_on": None, "active": True, **changes}


async def create_item(client, headers):
    payload = {**schedule(), "client_request_id": str(uuid4())}
    response = await client.post("/medications/items", headers=headers("patient1"), json=payload)
    assert response.status_code == 201
    return payload, response.json()


def report(item, status="unknown"):
    day = datetime.now(timezone.utc).date().isoformat()
    return {"item_key": item["key"], "day": day, "occurrence_key": f"{day}@self_report/v{item['revision']}",
            "status": status, "reason": "Учебное наблюдение", "client_request_id": str(uuid4())}


async def test_schedule_receipt_follows_committed_revision_and_noop_is_replayed(client, headers, database):
    payload, item = await create_item(client, headers)
    receipt = item["participation"]
    assert receipt["points"] == 2 and receipt["policy_version"] == POLICY_VERSION and receipt["recorded_at"]
    retry = await client.post("/medications/items", headers=headers("patient1"), json=payload)
    assert retry.json()["replayed"] is True and retry.json()["participation"] == receipt
    path = f"/medications/items/{item['id']}"
    noop = await client.put(path, headers=headers("patient1"), json={**schedule(), "expected_revision": 1})
    assert noop.json()["replayed"] is True and noop.json()["participation"] == receipt
    changed = {**schedule(label="Учебная правка"), "expected_revision": 1}
    first = await client.put(path, headers=headers("patient1"), json=changed)
    assert first.json()["replayed"] is False and first.json()["revision"] == 2
    assert first.json()["participation"]["points"] == 0
    second = await client.put(path, headers=headers("patient1"), json=changed)
    assert second.json()["replayed"] is True and second.json()["participation"] == first.json()["participation"]
    _, next_item = await create_item(client, headers)
    assert next_item["participation"]["points"] == 0
    assert (await client.get("/participation/points", headers=headers("patient1"))).json()["balance"] == 2
    async with database() as session:
        assert await session.scalar(select(func.count(ParticipationAward.id))) == 3
        rows = (await session.scalars(select(ParticipationAward).order_by(ParticipationAward.id))).all()
        assert [(r.source_key, r.points) for r in rows] == [
            (f"item:{item['id']}:v1", 2), (f"item:{item['id']}:v2", 0), (f"item:{next_item['id']}:v1", 0)]


@pytest.mark.parametrize("status", ["taken", "not_taken", "unknown", "not_applicable"])
async def test_report_receipt_uses_same_reward_for_every_answer_and_owned_retry(client, headers, database, status):
    _, item = await create_item(client, headers)
    # The schedule was prepared on a previous award day; today's report can earn2.
    async with database() as session:
        award = await session.scalar(select(ParticipationAward))
        award.day = datetime.now(timezone.utc).date() - timedelta(days=1)
        await session.commit()
    payload = report(item, status)
    first = await client.post("/medications/reports", headers=headers("patient1"), json=payload)
    assert first.status_code == 201
    saved = first.json()
    assert saved["participation"]["points"] == 2 and not saved["ingestion_verified"]
    for next_payload in [payload, {**payload, "client_request_id": str(uuid4())}]:
        response = await client.post("/medications/reports", headers=headers("patient1"), json=next_payload)
        assert response.json()["replayed"] is True and response.json()["participation"] == saved["participation"]
    path = f"/medications/reports/{saved['id']}"
    correction = {"expected_revision": 1, "status": "unknown", "reason": "Уточнённый учебный комментарий"}
    changed = await client.patch(path, headers=headers("patient1"), json=correction)
    assert changed.json()["replayed"] is False and changed.json()["participation"]["points"] == 0
    retried = await client.patch(path, headers=headers("patient1"), json=correction)
    assert retried.json()["replayed"] is True and retried.json()["participation"] == changed.json()["participation"]
    for role, expected in [("doctor", 403), ("admin", 403), ("patient2", 404)]:
        denied = await client.patch(path, headers=headers(role), json=correction)
        assert denied.status_code == expected and "participation" not in denied.json()
    assert (await client.get("/participation/points", headers=headers("patient1"))).json()["balance"] == 4
    async with database() as session:
        assert await session.scalar(select(func.count(MedicationLog.id))) == 1
        assert await session.scalar(select(func.count(ParticipationAward.id))) == 3


async def test_legacy_schedule_without_award_keeps_unknown_receipt_on_noop(client, headers, database, accounts):
    async with database() as session:
        row = MedicationItem(patient_id=1, created_by_id=accounts["patient1"].id,
                             client_request_id=str(uuid4()), initial_payload=schedule(),
                             **{**schedule(), "starts_on": datetime(2026, 1, 1).date()})
        session.add(row)
        await session.commit()
        item_id = row.id
    response = await client.put(f"/medications/items/{item_id}", headers=headers("patient1"),
                                json={**schedule(), "expected_revision": 1})
    assert response.status_code == 200
    assert response.json()["replayed"] is True and response.json()["participation"] is None
    async with database() as session:
        assert await session.scalar(select(func.count(ParticipationAward.id))) == 0


@pytest.mark.parametrize("action", ["create_item", "edit_item", "create_report", "edit_report"])
async def test_receipt_read_failure_rolls_back_medication_change_award_and_audit(client, headers, database, monkeypatch, action):
    import app.modules.adherence.medication_router as medication

    _, item = await create_item(client, headers)
    saved = None
    if action == "edit_report":
        result = await client.post("/medications/reports", headers=headers("patient1"), json=report(item))
        assert result.status_code == 201
        saved = result.json()

    async def snapshot():
        async with database() as session:
            counts = [await session.scalar(select(func.count(model.id)))
                      for model in [MedicationItem, MedicationLog, ParticipationAward, AuditEvent]]
            row = await session.get(MedicationItem, item["id"])
            log = await session.get(MedicationLog, saved["id"]) if saved else None
            return counts, row.label, row.revision, (log.status, log.reason, log.revision) if log else None

    before = await snapshot()

    async def fail(*args, **kwargs):
        raise RuntimeError("medication-receipt-read-failure")

    monkeypatch.setattr(medication, "participation_receipt", fail, raising=False)
    with pytest.raises(RuntimeError, match="medication-receipt-read-failure"):
        if action == "create_item":
            await create_item(client, headers)
        elif action == "edit_item":
            await client.put(f"/medications/items/{item['id']}", headers=headers("patient1"),
                             json={**schedule(label="Не должно сохраниться"), "expected_revision": 1})
        elif action == "create_report":
            await client.post("/medications/reports", headers=headers("patient1"), json=report(item))
        else:
            await client.patch(f"/medications/reports/{saved['id']}", headers=headers("patient1"),
                               json={"status": "not_taken", "reason": "Не должно сохраниться", "expected_revision": 1})
    assert await snapshot() == before
