from datetime import datetime, timezone

import pytest
from sqlalchemy import func, select

from app.db.base import Base
from app.db.seed_cohort import seed_cohort
from app.modules.access.models import User, UserRole
from app.modules.adherence.models import AdherenceReport
from app.modules.adherence.schemas import AdherenceWrite
from app.modules.analytics.admin import clinic_summary
from app.modules.analytics.service import engagement
from app.modules.notes.models import DoctorTask
from app.modules.patients.models import Patient, PatientMapping
from app.modules.surveys.models import Survey


async def test_cohort_populates_funnel_without_treating_generated_times_as_measurements(accounts, database):
    async with database() as session:
        result = await seed_cohort(session, now=datetime(2026, 10, 27, 12, tzinfo=timezone.utc))
        await session.commit()
    assert result == {"cohort": "demo-cohort-v1", "patients_created": 200, "patients_preserved": 0,
        "assignments_created": 480, "opened_created": 408, "submissions_created": 336,
        "tasks_created": 60, "mis_writes": 0, "retroactive_awards": 0}
    async with database() as session:
        report = await clinic_summary(session, 5)
        assert report["journey"]["suppressed"] is False
        funnel = report["journey"]["values"]
        assert (funnel["assigned"], funnel["opened"], funnel["completed"]) == (480, 408, 336)
        assert (funnel["not_opened_not_completed"], funnel["opened_not_completed"]) == (72, 72)
        assert funnel["timing_excluded_generated"] == 336 and funnel["timing_eligible_completed"] == 0
        assert funnel["open_to_completion"]["median_seconds"] is None
        assert all(not d["suppressed"] for d in report["dimensions"])
        assert await session.scalar(select(func.count(PatientMapping.id))) == 3
        patients = (await session.scalars(select(Patient).where(Patient.user_id > accounts["patient3"].id))).all()
        assert len(patients) == 200 and all(patient.mis_id is None for patient in patients)
        assert sum(patient.doctor_id == accounts["doctor"].id for patient in patients) == 100
        reports = (await session.scalars(select(AdherenceReport))).all()
        assert len(reports) == 200
        assert {row.status for row in reports} == {"followed", "not_applicable", "not_followed", "unknown"}
        for row in reports:
            AdherenceWrite(client_request_id=row.client_request_id, recommendation=row.recommendation,
                status=row.status, reason=row.reason)
        for doctor in (accounts["doctor"], accounts["doctor2"]):
            values = await engagement(session, doctor)
            assert values["collection"]["journey"]["timing_excluded_generated"] == 168


async def test_repeat_cohort_preserves_existing_data_and_manual_changes(accounts, database):
    async with database() as session:
        original = await session.get(Patient, 1)
        original_name = original.full_name
        await seed_cohort(session)
        task = await session.scalar(select(DoctorTask).order_by(DoctorTask.id))
        task.title = "Врач отредактировал импортированную задачу"
        await session.commit()
        counts = {table.name: await session.scalar(select(func.count()).select_from(table)) for table in Base.metadata.sorted_tables}
        result = await seed_cohort(session)
        await session.commit()
        assert result["patients_created"] == 0 and result["patients_preserved"] == 200
        assert counts == {table.name: await session.scalar(select(func.count()).select_from(table)) for table in Base.metadata.sorted_tables}
        assert (await session.get(Patient, 1)).full_name == original_name
        assert (await session.get(DoctorTask, task.id)).title == "Врач отредактировал импортированную задачу"


async def test_cohort_refuses_to_take_over_an_existing_account(accounts, database):
    async with database() as session:
        session.add(User(username="cohort_patient001", display_name="Существующий пользователь",
            role=UserRole.patient, hashed_password=accounts["patient1"].hashed_password))
        await session.commit()
        with pytest.raises(RuntimeError, match="unrelated account"):
            await seed_cohort(session)
        await session.rollback()
        assert await session.scalar(select(func.count(Survey.id))) == 0
