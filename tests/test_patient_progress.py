from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import func, select

from app.core.security import create_access_token
from app.modules.access.models import User, UserRole
from app.modules.audit.models import AuditEvent
from app.modules.care.models import TreatmentStatusChange
from app.modules.care.router import visit_progress
from app.modules.patients.models import PatientMapping


async def test_patient_progress_only_returns_own_public_facts(client, headers, database, accounts):
    async with database() as session:
        for patient_id, doctor_name, status in [(1, "doctor", "in_progress"), (2, "doctor2", "completed")]:
            session.add(TreatmentStatusChange(patient_id=patient_id, doctor_id=accounts[doctor_name].id,
                client_request_id=str(uuid4()), status=status, reason="PRIVATE clinician reasoning"))
        coordinator = User(username="progress-coordinator", display_name="Coordinator", role=UserRole.coordinator,
                           hashed_password=accounts["doctor"].hashed_password)
        session.add(coordinator)
        await session.commit()
        coordinator_token = create_access_token(coordinator.id, "coordinator")
        before = await session.scalar(select(func.count(AuditEvent.id)))

    first = await client.get("/participation/care-progress?patient_id=2", headers=headers("patient1"))
    assert first.status_code == 200
    body = first.json()
    assert set(body) == {"as_of", "treatment", "visits"}
    assert body["treatment"]["status"] == "in_progress"
    assert set(body["treatment"]) == {"status", "recorded_at"}
    assert "PRIVATE" not in first.text and "scenario" not in first.text and "reason" not in first.text
    assert body["visits"]["synthetic"] and body["visits"]["known_completed_count"] == 0
    second = (await client.get("/participation/care-progress", headers=headers("patient2"))).json()
    assert second["treatment"]["status"] == "completed"
    assert second["visits"]["known_completed_count"] == 1
    unknown = (await client.get("/participation/care-progress", headers=headers("patient3"))).json()
    assert unknown["treatment"] == {"status": "unknown", "recorded_at": None}
    for role in ("doctor", "doctor2", "admin"):
        assert (await client.get("/participation/care-progress", headers=headers(role))).status_code == 403
    assert (await client.get("/participation/care-progress", headers={"Authorization": "Bearer " + coordinator_token})).status_code == 403
    assert (await client.get("/participation/care-progress")).status_code == 401
    # The old clinician-only source endpoint remains closed to patients.
    assert (await client.get("/patients/1/care", headers=headers("patient1"))).status_code == 403
    async with database() as session:
        assert await session.scalar(select(func.count(AuditEvent.id))) == before


async def test_missing_mapping_is_unknown_rather_than_zero_visits(client, headers, database):
    async with database() as session:
        mapping = await session.scalar(select(PatientMapping).where(PatientMapping.compass_patient_id == 1))
        await session.delete(mapping)
        await session.commit()
    body = (await client.get("/participation/care-progress", headers=headers("patient1"))).json()
    assert body["visits"]["status"] == "not_linked"
    assert body["visits"]["known_completed_count"] is None
    assert body["visits"]["next_scheduled_at"] is None
    assert body["treatment"]["status"] == "unknown"


def test_only_explicit_attendance_and_future_scheduled_dates_are_progress():
    now = datetime(2026, 10, 24, tzinfo=timezone.utc)
    source = {"status": "available", "synthetic": True, "data": {"visits": [
        {"status": "attended", "occurred_at": "2026-10-20T09:00:00+07:00"},
        {"status": "attended", "occurred_at": None},
        {"status": "attended", "occurred_at": "2026-10-21T09:00:00"},
        {"status": "attended", "occurred_at": "2026-11-01T00:00:00Z"},
        {"status": "scheduled", "scheduled_at": "2026-10-19T00:00:00Z"},
        {"status": "scheduled", "scheduled_at": "2026-10-28T00:00:00Z"},
        {"status": "scheduled", "scheduled_at": "2026-10-26T00:00:00Z"},
        {"status": "cancelled", "scheduled_at": "2026-10-25T00:00:00Z"},
        {"status": "scheduled", "scheduled_at": "invalid"},
    ]}}
    result = visit_progress(source, now)
    assert result["known_completed_count"] == 1 and result["has_undated_visits"]
    assert result["latest_completed_at"].isoformat() == "2026-10-20T09:00:00+07:00"
    assert result["next_scheduled_at"].isoformat() == "2026-10-26T00:00:00+00:00"
    unavailable = visit_progress({"status": "available", "data": {}}, now)
    assert unavailable["known_completed_count"] is None and unavailable["status"] == "unavailable"
