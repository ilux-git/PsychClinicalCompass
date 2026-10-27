import asyncio
from datetime import date, datetime, timedelta, timezone
from uuid import uuid4

import pytest
from sqlalchemy import func, select

from app.modules.adherence.medication_models import MedicationItem, MedicationLog
from app.modules.adherence.medications import occurrences


@pytest.mark.parametrize("calendar", ["source", "clinic"])
async def test_old_requested_day_is_not_truncated_by_recent_history(client, headers, database, calendar):
    old_day = date(2026, 10, 1)
    recent_day = date(2026, 10, 25)
    async with database() as session:
        rows = [MedicationLog(patient_id=1, client_request_id=str(uuid4()), item_key=f"archived:{i}",
            occurrence_key=f"{old_day if i < 40 else recent_day}@08:00@UTC:{i}",
            status="unknown", reason="Не могу уточнить.", scheduled_for=None) for i in range(75)]
        session.add_all(rows)
        await session.commit()
        old_ids = [row.id for row in rows[:40]]
        latest_ids = [row.id for row in rows[-30:]][::-1]
    response = await client.get(f"/patients/1/medications?on={old_day}&calendar={calendar}", headers=headers("patient1"))
    assert response.status_code == 200
    body = response.json()
    assert [row["id"] for row in body["historical_reports"]] == old_ids
    assert [row["id"] for row in body["recent_reports"]] == latest_ids
    assert all(row["status"] == "unknown" and row["scheduled_for"] is None for row in body["historical_reports"])


def content(**changes):
    return {"label": "Моя произвольная позиция", "instructions": "Личное описание", "schedule_text": "По моему плану",
            "schedule_kind": "fixed", "times": ["09:00"], "weekdays": list(range(7)), "timezone": "UTC",
            "starts_on": "2026-01-01", "ends_on": None, "active": True, **changes}


async def test_personal_schedule_source_scope_replay_and_edit(client, headers, database):
    payload = {**content(), "client_request_id": str(uuid4())}
    result = await asyncio.gather(*[client.post("/medications/items", headers=headers("patient1"), json=payload) for _ in range(3)])
    assert all(r.status_code == 201 for r in result)
    row = result[0].json()
    assert {r.json()["id"] for r in result} == {row["id"]}
    assert not row["is_prescription"] and row["source"] == "patient_entered"
    assert (await client.post("/medications/items", headers=headers("patient1"), json={**payload, "label": "Другое"})).status_code == 409
    for name, code in [("doctor", 403), ("admin", 403)]:
        assert (await client.post("/medications/items", headers=headers(name), json=payload)).status_code == code
    for name, code in [("doctor2", 404), ("patient2", 404), ("admin", 403)]:
        assert (await client.get("/patients/1/medications", headers=headers(name))).status_code == code
    edited = {**content(label="Исправлено", times=["10:00"]), "expected_revision": 1}
    path = f"/medications/items/{row['id']}"
    assert (await client.put(path, headers=headers("patient2"), json=edited)).status_code == 404
    assert (await client.put(path, headers=headers("patient1"), json=edited)).json()["revision"] == 2
    assert (await client.put(path, headers=headers("patient1"), json=edited)).status_code == 200
    assert (await client.put(path, headers=headers("patient1"), json={**edited, "label": "Конфликт"})).status_code == 409
    schedule = (await client.get("/patients/1/medications?on=2026-10-20", headers=headers("doctor"))).json()
    local = next(i for i in schedule["items"] if i["source"] == "patient_entered")
    event = next(e for e in schedule["events"] if e["item_key"] == local["key"])
    assert event["status"] == "unknown" and event["report"] is None
    async with database() as session:
        assert await session.scalar(select(func.count(MedicationItem.id))) == 1


async def test_fixed_medication_self_report_is_explicit_and_correctable(client, headers, database):
    item = (await client.post("/medications/items", headers=headers("patient1"), json={**content(), "client_request_id": str(uuid4())})).json()
    day = (datetime.now(timezone.utc) - timedelta(days=1)).date().isoformat()
    schedule = (await client.get(f"/patients/1/medications?on={day}", headers=headers("patient1"))).json()
    event = next(e for e in schedule["events"] if e["item_key"] == item["key"])
    data = {"client_request_id": str(uuid4()), "item_key": item["key"], "day": day,
            "occurrence_key": event["occurrence_key"], "status": "not_taken", "reason": "Забыл(а)"}
    result = await asyncio.gather(*[client.post("/medications/reports", headers=headers("patient1"), json=data) for _ in range(3)])
    assert all(r.status_code == 201 for r in result)
    row = result[0].json()
    assert {r.json()["id"] for r in result} == {row["id"]} and not row["ingestion_verified"]
    assert (await client.post("/medications/reports", headers=headers("patient1"), json={**data, "status": "taken"})).status_code == 409
    assert (await client.post("/medications/reports", headers=headers("patient2"), json={**data, "client_request_id": str(uuid4())})).status_code == 404
    assert (await client.post("/medications/reports", headers=headers("doctor"), json=data)).status_code == 403
    path = f"/medications/reports/{row['id']}"
    corrected = {"status": "unknown", "reason": "Уточнил(а): не помню", "expected_revision": 1}
    assert (await client.patch(path, headers=headers("patient1"), json=corrected)).json()["revision"] == 2
    assert (await client.patch(path, headers=headers("patient1"), json=corrected)).status_code == 200
    assert (await client.patch(path, headers=headers("patient1"), json={**corrected, "status": "taken"})).status_code == 409
    schedule = (await client.get(f"/patients/1/medications?on={day}", headers=headers("doctor"))).json()
    current = next(e for e in schedule["events"] if e["item_key"] == item["key"])
    assert current["report"]["status"] == "unknown" and current["report"]["revision"] == 2
    async with database() as session:
        assert await session.scalar(select(func.count(MedicationLog.id))) == 1


async def test_free_schedule_has_no_invented_due_events_or_missed_doses(client, headers):
    item = (await client.post("/medications/items", headers=headers("patient1"), json={
        **content(schedule_kind="as_needed", times=[], weekdays=[]), "client_request_id": str(uuid4())})).json()
    schedule = (await client.get("/patients/1/medications?on=2026-10-20", headers=headers("patient1"))).json()
    assert not [e for e in schedule["events"] if e["item_key"] == item["key"]]
    report = {"client_request_id": str(uuid4()), "item_key": item["key"], "day": "2026-10-20",
              "occurrence_key": "2026-10-20@self_report/v1", "status": "not_applicable"}
    assert (await client.post("/medications/reports", headers=headers("patient1"), json=report)).status_code == 201
    future = "2099-01-01"
    assert (await client.post("/medications/reports", headers=headers("patient1"), json={**report,
        "client_request_id": str(uuid4()), "day": future, "occurrence_key": future + "@self_report/v1"})).status_code == 422


@pytest.mark.parametrize("changes", [{"timezone": "Invalid/Zone"}, {"times": ["25:00"]}, {"times": []},
    {"weekdays": [True]}, {"weekdays": [1,1]}, {"ends_on": "2025-12-31"},
    {"schedule_kind": "description", "times": ["08:00"], "weekdays": []}])
async def test_invalid_regimen_is_rejected(client, headers, changes):
    response = await client.post("/medications/items", headers=headers("patient1"), json={**content(**changes), "client_request_id": str(uuid4())})
    assert response.status_code == 422


def test_nonexistent_or_ambiguous_dst_clock_is_not_a_fake_instant():
    item = {**content(timezone="Europe/Berlin", times=["02:30"]), "key": "local:1", "revision": 1}
    for day in (date(2026,3,29), date(2026,10,25)):
        event = occurrences(item, day)[0]
        assert event["scheduled_for"] is None and event["requires_time_confirmation"]
