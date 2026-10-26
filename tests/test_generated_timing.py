from datetime import datetime, timedelta, timezone
import json
from uuid import uuid4

import pytest
from sqlalchemy import select

from app.core.config import get_settings
from app.db.seed_clinical import seed_clinical
from app.modules.access.models import User
from app.modules.assessments.catalog import GAD7_KEY, PHQ9_KEY
from app.modules.assessments.clinical_models import ClinicalResult
from app.modules.assessments.clinical_service import ensure_clinical_survey
from app.modules.patients.models import Patient
from app.modules.surveys.models import SurveyAssignment, SurveySubmission
from app.modules.surveys.schemas import AssignSurvey
from app.modules.surveys.service import assign_survey, submit_assignment
from tests.test_clinical_demo_seed import demo_profiles  # explicit synthetic setup fixture
from tests.test_clinical_instruments import assigned, values


@pytest.mark.parametrize('with_observed_answer', [False, True])
async def test_generated_answers_keep_completion_counts_but_never_become_human_timing(client, headers, database, demo_profiles, monkeypatch, with_observed_answer):
    async with database() as session, session.begin():
        await seed_clinical(session, apply=True)
    if with_observed_answer:
        _, assignment_id = await assigned(client, headers, PHQ9_KEY)
        response = await client.post(f'/survey-assignments/{assignment_id}/submit', headers=headers('patient1'), json={'answers': values(9, 0)})
        assert response.status_code == 200
        start = datetime(2026, 1, 1, tzinfo=timezone.utc)
        async with database() as session:
            assignment = await session.get(SurveyAssignment, assignment_id)
            assignment.created_at = start
            assignment.first_opened_at = start + timedelta(seconds=20)
            submission = await session.scalar(select(SurveySubmission).where(SurveySubmission.assignment_id == assignment_id))
            submission.created_at = start + timedelta(seconds=100)
            await session.commit()
    expected_eligible = int(with_observed_answer)
    doctor = (await client.get('/analytics/engagement', headers=headers('doctor'))).json()['collection']['journey']
    # The shared test setup deliberately keeps patient 2 assigned to doctor2.
    assert doctor['completed'] == doctor['assigned'] == 12 + expected_eligible
    assert doctor['timing_excluded_generated'] == 12 and doctor['timing_eligible_completed'] == expected_eligible
    assert doctor['assignment_to_completion'] == {'known': expected_eligible, 'unknown': 0, 'median_seconds': 100.0 if with_observed_answer else None}
    assert doctor['open_to_completion'] == {'known': expected_eligible, 'unknown': 0, 'median_seconds': 80.0 if with_observed_answer else None}
    other = (await client.get('/analytics/engagement', headers=headers('doctor2'))).json()['collection']['journey']
    assert other['timing_excluded_generated'] == 9 and other['timing_eligible_completed'] == 0
    monkeypatch.setattr(get_settings(), 'admin_analytics_min_group_size', 1)  # disposable test policy only
    report = (await client.get('/analytics/clinic', headers=headers('admin'))).json()
    clinic = report['journey']['values']
    assert clinic['completed'] == 21 + expected_eligible
    assert clinic['timing_excluded_generated'] == 21 and clinic['timing_eligible_completed'] == expected_eligible
    assert clinic['assignment_to_completion']['median_seconds'] == (100.0 if with_observed_answer else None)
    assert 'fixture_sha256' not in json.dumps(report) and 'synthetic_provenance' not in json.dumps(report)


async def test_a_small_generation_timing_subset_suppresses_the_whole_admin_bundle(client, headers, database, demo_profiles, monkeypatch):
    start = datetime(2026, 1, 1, tzinfo=timezone.utc)
    async with database() as session, session.begin():
        patients = (await session.scalars(select(Patient).order_by(Patient.id))).all()
        for patient in patients:
            doctor = await session.get(User, patient.doctor_id)
            account = await session.get(User, patient.user_id)
            survey = await ensure_clinical_survey(session, doctor, GAD7_KEY)
            ids = await assign_survey(session, doctor, survey, AssignSurvey(patient_ids=[patient.id], client_request_id=uuid4()))
            submission, _ = await submit_assignment(session, account, ids[0], values(7, 0))
            assignment = await session.get(SurveyAssignment, ids[0])
            assignment.created_at = start
            assignment.first_opened_at = start + timedelta(seconds=20)
            submission.created_at = start + timedelta(seconds=100)
    monkeypatch.setattr(get_settings(), 'admin_analytics_min_group_size', 2)
    before = (await client.get('/analytics/clinic', headers=headers('admin'))).json()['journey']
    assert not before['suppressed'] and before['values']['timing_eligible_completed'] == 10
    async with database() as session:
        one = await session.scalar(select(ClinicalResult).order_by(ClinicalResult.id).limit(1))
        one.result = {**one.result, 'synthetic_provenance': {'generated': True}}
        await session.commit()
    after = (await client.get('/analytics/clinic', headers=headers('admin'))).json()['journey']
    assert after['suppressed'] and after['values'] is None
