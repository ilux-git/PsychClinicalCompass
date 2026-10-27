from datetime import date, datetime, timezone
from uuid import uuid4

import pytest
from sqlalchemy import select

from app.core.clinic_time import clinic_day, clinic_day_bounds
from app.modules.adherence.rewards import ParticipationAward
from app.modules.adherence.medications import clinic_occurrences


@pytest.mark.parametrize("instant,expected", [
    ("2026-10-27T20:59:59+00:00", date(2026, 10, 27)),
    ("2026-10-27T21:00:00+00:00", date(2026, 10, 28)),
    ("2026-10-28T04:00:00+07:00", date(2026, 10, 28)),
])
def test_clinic_calendar_uses_moscow_midnight(instant, expected):
    assert clinic_day(datetime.fromisoformat(instant)) == expected
    start, end = clinic_day_bounds(expected)
    assert start.isoformat() == f"2026-10-{expected.day - 1}T21:00:00+00:00"
    assert end.isoformat() == f"2026-10-{expected.day}T21:00:00+00:00"


def test_clinic_calendar_rejects_unspecified_timezone():
    with pytest.raises(ValueError, match="timezone-aware"):
        clinic_day(datetime(2026, 10, 27))


def test_medication_moscow_day_retains_source_dates_across_midnight():
    item = {"key": "local:1", "active": True, "schedule_kind": "fixed", "weekdays": list(range(7)),
            "timezone": "UTC", "starts_on": "2026-01-01", "ends_on": None, "revision": 1,
            "times": ["00:01", "20:59", "21:00", "23:00"]}
    events = clinic_occurrences(item, date(2026, 10, 28))
    assert [(row["clock"], row["occurrence_key"]) for row in events] == [
        ("00:00", "2026-10-27@21:00/v1"), ("02:00", "2026-10-27@23:00/v1"),
        ("03:01", "2026-10-28@00:01/v1"), ("23:59", "2026-10-28@20:59/v1")]
    assert {row["source_timezone"] for row in events} == {"UTC"}
    assert events[0]["source_day"] == "2026-10-27" and events[0]["source_clock"] == "21:00"
    ambiguous = clinic_occurrences({**item, "timezone": "Europe/Berlin", "times": ["02:30"]}, date(2026, 10, 25))
    assert len(ambiguous) == 1 and ambiguous[0]["scheduled_for"] is None and ambiguous[0]["requires_time_confirmation"]


async def test_moscow_medication_view_preserves_reports_and_legacy_api(client, headers):
    item = (await client.post("/medications/items", headers=headers("patient1"), json={
        "label": "Проверка пересчёта времени", "instructions": "Исходная запись", "schedule_text": "По расписанию источника",
        "schedule_kind": "fixed", "times": ["22:00"], "weekdays": list(range(7)), "timezone": "UTC",
        "starts_on": "2026-01-01", "ends_on": None, "active": True, "client_request_id": str(uuid4())})).json()
    path = "/patients/1/medications"
    clinic = await client.get(path + "?on=2026-10-21&calendar=clinic", headers=headers("patient1"))
    assert clinic.status_code == 200 and clinic.json()["day_timezone"] == "Europe/Moscow"
    event = next(row for row in clinic.json()["events"] if row["item_key"] == item["key"])
    assert event["clock"] == "01:00" and event["source_day"] == "2026-10-20"
    payload = {"item_key": item["key"], "day": event["source_day"], "occurrence_key": event["occurrence_key"],
               "status": "unknown", "reason": "Не помню", "client_request_id": str(uuid4())}
    saved = await client.post("/medications/reports", headers=headers("patient1"), json=payload)
    assert saved.status_code == 201
    again = (await client.get(path + "?on=2026-10-21&calendar=clinic", headers=headers("doctor"))).json()
    assert next(row for row in again["events"] if row["item_key"] == item["key"])["report"]["id"] == saved.json()["id"]
    legacy = (await client.get(path + "?on=2026-10-20", headers=headers("patient1"))).json()
    old_event = next(row for row in legacy["events"] if row["item_key"] == item["key"])
    assert old_event["clock"] == "22:00" and old_event["report"]["id"] == saved.json()["id"]
    denied = await client.get(path + "?on=2026-10-21&calendar=clinic", headers=headers("patient2"))
    assert denied.status_code == 404


async def test_free_medication_report_uses_moscow_day_at_midnight(client, headers, monkeypatch):
    import app.modules.adherence.medication_router as medication

    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            instant = datetime(2026, 10, 27, 21, 30, tzinfo=timezone.utc)
            return instant.astimezone(tz) if tz else instant.replace(tzinfo=None)

    monkeypatch.setattr(medication, "datetime", Clock)
    item = (await client.post("/medications/items", headers=headers("patient1"), json={
        "label": "Дневной самоотчёт", "instructions": "Личное наблюдение", "schedule_text": "По потребности",
        "schedule_kind": "as_needed", "times": [], "weekdays": [], "timezone": "UTC",
        "starts_on": "2026-01-01", "ends_on": None, "active": True, "client_request_id": str(uuid4())})).json()
    payload = {"item_key": item["key"], "day": "2026-10-28", "occurrence_key": "2026-10-28@self_report/v1",
               "status": "not_applicable", "client_request_id": str(uuid4())}
    assert (await client.post("/medications/reports", headers=headers("patient1"), json=payload)).status_code == 201
    future = {**payload, "day": "2026-10-29", "occurrence_key": "2026-10-29@self_report/v1", "client_request_id": str(uuid4())}
    assert (await client.post("/medications/reports", headers=headers("patient1"), json=future)).status_code == 422


async def test_legacy_awards_share_moscow_daily_cap_without_rewriting_history(client, headers, database, monkeypatch):
    import app.modules.adherence.rewards as rewards

    class Clock(datetime):
        instant = datetime(2026, 10, 27, 21, 30, tzinfo=timezone.utc)

        @classmethod
        def now(cls, tz=None):
            return cls.instant.astimezone(tz) if tz else cls.instant.replace(tzinfo=None)

    monkeypatch.setattr(rewards, "datetime", Clock)
    async with database() as session:
        for key, created in (("before-midnight", "2026-10-27T20:59:00+00:00"),
                             ("legacy-after-midnight", "2026-10-27T21:05:00+00:00")):
            session.add(ParticipationAward(patient_id=1, kind="diary", source_key=key,
                policy_version="demo-effort-v1", points=3, day=date(2026, 10, 27),
                created_at=datetime.fromisoformat(created)))
        await session.commit()

    payload = {"text": "Наблюдение после московской полуночи", "client_request_id": str(uuid4())}
    first = await client.post("/diary/entries", headers=headers("patient1"), json=payload)
    assert first.status_code == 201 and first.json()["participation"]["points"] == 7
    summary = (await client.get("/participation/points", headers=headers("patient1"))).json()
    assert summary["day_timezone"] == "Europe/Moscow"
    assert datetime.fromisoformat(summary["next_reset_at"]) == datetime(2026, 10, 28, 21, tzinfo=timezone.utc)
    assert summary["balance"] == summary["earned_total"] == 13
    days = {row["day"]: row for row in summary["activity"]}
    assert days["2026-10-27"] == {"day": "2026-10-27", "actions": 1, "points": 3}
    assert days["2026-10-28"] == {"day": "2026-10-28", "actions": 2, "points": 10}
    assert next(row for row in summary["rules"] if row["kind"] == "diary")["earned_today"] == 10

    Clock.instant = datetime(2026, 10, 28, 21, tzinfo=timezone.utc)
    replay = await client.post("/diary/entries", headers=headers("patient1"), json=payload)
    assert replay.status_code == 201 and replay.json()["replayed"]
    fresh = await client.post("/diary/entries", headers=headers("patient1"), json={**payload, "client_request_id": str(uuid4())})
    assert fresh.status_code == 201 and fresh.json()["participation"]["points"] == 10
    async with database() as session:
        rows = (await session.scalars(select(ParticipationAward).order_by(ParticipationAward.id))).all()
        assert len(rows) == 4
        assert [(row.day, row.points, row.policy_version) for row in rows[:2]] == [(date(2026, 10, 27), 3, "demo-effort-v1")] * 2
        assert [(row.day, row.points) for row in rows[2:]] == [(date(2026, 10, 28), 7), (date(2026, 10, 29), 10)]
