import asyncio
import json
from uuid import uuid4

import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy import func, select

from app.core.config import get_settings
from app.db import seed_clinical as initializer
from app.modules.access.models import User, UserRole
from app.modules.adherence.rewards import ParticipationAward
from app.modules.assessments.catalog import GAD7_KEY, PHQ9_KEY
from app.modules.assessments.clinical_models import ClinicalBaseline, ClinicalResult
from app.modules.assessments.models import OutboxEvent, QuestionnaireResponse
from app.modules.audit.models import AuditEvent
from app.modules.care.models import TreatmentStatusChange
from app.modules.alerts.models import ClinicalDecision
from app.modules.patients.models import Patient, PatientMapping
from app.modules.surveys.models import Survey, SurveyAssignment, SurveyDraft, SurveySubmission
from tests.conftest import TEST_HASH
from tests.test_clinical_instruments import assigned, values


@pytest_asyncio.fixture
async def demo_profiles(database, accounts):
    async with database() as session:
        for mis_id in range(1, 11):
            patient = await session.scalar(select(Patient).where(Patient.mis_id == mis_id))
            if patient is None:
                user = User(username=f'patient{mis_id}', display_name=f'Synthetic {mis_id}', role=UserRole.patient, hashed_password=TEST_HASH)
                session.add(user)
                await session.flush()
                patient = Patient(id=mis_id, mis_id=mis_id, full_name=f'Synthetic {mis_id}', user_id=user.id,
                                  doctor_id=accounts['doctor' if mis_id < 9 else 'doctor2'].id)
                session.add(patient)
                await session.flush()
                session.add(PatientMapping(compass_patient_id=patient.id, mis_id=mis_id))
            if mis_id != 8:
                session.add(TreatmentStatusChange(patient_id=patient.id, doctor_id=patient.doctor_id,
                    client_request_id=str(uuid4()), status='completed' if mis_id == 6 else 'refused' if mis_id == 7 else 'in_progress',
                    source='synthetic_doctor_fixture', reason='Synthetic setup, not a real physician decision'))
        old = QuestionnaireResponse(patient_id=1, form_type='phq9', form_version='demo_numeric_v1',
                                    answers=[1]*9, score=9, risk_flags=[])
        session.add(old)
        await session.commit()
        return {'legacy_id': old.id, 'legacy_at': old.created_at}


async def counts(session):
    return {model.__tablename__: await session.scalar(select(func.count()).select_from(model))
            for model in [ClinicalResult, ClinicalBaseline, Survey, SurveyAssignment, SurveySubmission,
                          ParticipationAward, OutboxEvent, ClinicalDecision, AuditEvent, TreatmentStatusChange]}


async def run_seed(database, *, apply):
    async with database() as session, session.begin():
        return await initializer.seed_clinical(session, apply=apply)


async def test_preview_is_read_only_and_apply_replays_without_rewriting_history_or_creating_physician_actions(database, demo_profiles):
    async with database() as session:
        before = await counts(session)
    preview = await run_seed(database, apply=False)
    assert preview['would_create_results'] == 21 and preview['created_results'] == 0
    async with database() as session:
        assert await counts(session) == before
    first = await run_seed(database, apply=True)
    assert first['created_results'] == 21
    async with database() as session:
        after = await counts(session)
        rows = (await session.scalars(select(ClinicalResult))).all()
        assert {row.patient_id for row in rows} == {1, 2, 3, 4, 5, 9, 10}
        assert all(row.result['synthetic_provenance']['fixture_sha256'] == preview['fixture_sha256'] for row in rows)
        assert all(row.result['synthetic_provenance']['measurement'] == 'generated_current' for row in rows)
        assert after['clinical_baselines'] == after['clinical_decisions'] == 0
        assert after['treatment_status_changes'] == before['treatment_status_changes']
        assert not await session.scalar(select(SurveyAssignment.id).where(SurveyAssignment.first_opened_at.is_not(None)).limit(1))
        legacy = await session.get(QuestionnaireResponse, demo_profiles['legacy_id'])
        assert legacy.score == 9 and legacy.answers == [1]*9 and legacy.created_at == demo_profiles['legacy_at']
        assert await session.scalar(select(func.count(AuditEvent.id)).where(AuditEvent.event_type == 'demo.clinical_answer_generated')) == 21
        awards = (await session.scalars(select(ParticipationAward))).all()
        assert all(row.policy_version == 'demo-clinical-completion-v1' for row in awards)
    second = await run_seed(database, apply=True)
    assert second['created_results'] == 0 and second['replayed_results'] == 21
    async with database() as session:
        assert await counts(session) == after


async def test_concurrent_explicit_initializers_create_one_dataset(database, demo_profiles):
    results = await asyncio.gather(run_seed(database, apply=True), run_seed(database, apply=True))
    assert sorted(row['created_results'] for row in results) == [0, 21]
    assert sorted(row['replayed_results'] for row in results) == [0, 21]
    async with database() as session:
        assert await session.scalar(select(func.count(ClinicalResult.id))) == 21
        assert await session.scalar(select(func.count(SurveyAssignment.id))) == 21


async def test_existing_clinical_answers_and_patient_drafts_are_preserved(client, headers, database, demo_profiles):
    _, completed_id = await assigned(client, headers, PHQ9_KEY)
    response = await client.post(f'/survey-assignments/{completed_id}/submit', headers=headers('patient1'), json={'answers': values(9, 0)})
    assert response.status_code == 200
    _, draft_id = await assigned(client, headers, GAD7_KEY, 3)
    response = await client.put(f'/survey-assignments/{draft_id}/draft', headers=headers('patient3'), json={'answers': {'q1': 'n1'}, 'expected_revision': 0})
    assert response.status_code == 200
    result = await run_seed(database, apply=True)
    assert result['created_results'] == 19
    assert sum(row.get('reason') == 'existing_clinical_assignment' for row in result['plan']) == 2
    async with database() as session:
        old = await session.scalar(select(ClinicalResult).join(SurveySubmission, SurveySubmission.id == ClinicalResult.submission_id).where(SurveySubmission.assignment_id == completed_id))
        assert old.score == 0 and 'synthetic_provenance' not in old.result
        draft = await session.get(SurveyDraft, draft_id)
        assert draft.answers == {'q1': 'n1'} and draft.revision == 1
        assert not await session.scalar(select(SurveySubmission.id).where(SurveySubmission.assignment_id == draft_id))


async def test_generation_provenance_failure_rolls_back_answers_awards_and_outbox(database, demo_profiles, monkeypatch):
    async with database() as session:
        before = await counts(session)
    def reject_provenance(*args, **kwargs):
        raise RuntimeError('Controlled provenance audit failure')
    monkeypatch.setattr(initializer, 'record_event', reject_provenance)
    with pytest.raises(RuntimeError, match='Controlled provenance'):
        await run_seed(database, apply=True)
    async with database() as session:
        assert await counts(session) == before


@pytest.mark.parametrize('conflict', ['account_role', 'mapping'])
async def test_identity_conflicts_abort_before_any_generation(database, demo_profiles, conflict):
    async with database() as session:
        patient = await session.get(Patient, 3)
        if conflict == 'account_role':
            account = await session.get(User, patient.user_id)
            account.role = UserRole.admin
        else:
            mapping = await session.scalar(select(PatientMapping).where(PatientMapping.compass_patient_id == 3))
            mapping.mis_id = 103
        await session.commit()
        before = await counts(session)
    with pytest.raises(ValueError, match='known synthetic profile'):
        await run_seed(database, apply=True)
    async with database() as session:
        assert await counts(session) == before


@pytest.mark.parametrize('changes', [
    {'compass_database_url': 'postgresql+asyncpg://unused@203.0.113.1/compass_dev'},
    {'compass_database_url': 'postgresql+asyncpg://unused@127.0.0.1/compass_production'},
    {'telegram_enabled': True}, {'load_test_mode': True}, {'data_mode': 'real'},
])
def test_cli_refuses_nonlocal_real_or_external_delivery_environments(changes):
    with pytest.raises(ValueError, match='isolated local synthetic'):
        initializer.validate_environment(get_settings().model_copy(update=changes))


@pytest.mark.parametrize('bad', ['unknown_instrument', 'hidden_panic_answers', 'boolean_numeric_answer'])
def test_fixture_validation_uses_the_immutable_clinical_answer_contract(tmp_path, monkeypatch, bad):
    data = json.loads(initializer.FIXTURE.read_text(encoding='utf-8'))
    if bad == 'unknown_instrument':
        data['cases'][0]['responses']['unverified'] = [0]
    elif bad == 'hidden_panic_answers':
        data['cases'][0]['responses']['panic'] = [0]*15
    else:
        data['cases'][0]['responses']['phq9'][0] = True
    path = tmp_path/'clinical.json'
    path.write_text(json.dumps(data), encoding='utf-8')
    monkeypatch.setattr(initializer, 'FIXTURE', path)
    with pytest.raises((ValueError, HTTPException)):
        initializer.fixture_data()
