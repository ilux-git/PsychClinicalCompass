"""Explicit, append-only demo initialization through the existing clinical services.

Default CLI mode is a read-only preview. This never runs during application startup.
"""
import argparse
import asyncio
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
from uuid import NAMESPACE_URL, uuid5

from sqlalchemy import select, text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.db.session import async_session_compass, dispose_engines
from app.modules.access.models import User, UserRole
from app.modules.assessments.catalog import GAD7_KEY, PANIC_KEY, PHQ9_KEY, calculate, instrument
from app.modules.assessments.clinical_models import ClinicalResult
from app.modules.assessments.clinical_service import ensure_clinical_survey, survey_definition
from app.modules.audit.service import record_event
from app.modules.care.models import TreatmentStatusChange
from app.modules.integration.synthetic import snapshot
from app.modules.patients.models import Patient, PatientMapping
from app.modules.surveys.models import Survey, SurveyAssignment, SurveyDraft, SurveySubmission
from app.modules.surveys.schemas import AssignSurvey
from app.modules.surveys.service import assign_survey, owned_survey, submit_assignment, validate_answers

FIXTURE = Path(__file__).with_name('fixtures') / 'clinical_v1.json'
VERSION = 'synthetic-clinical/1'
INSTRUMENTS = {'panic': PANIC_KEY, 'phq9': PHQ9_KEY, 'gad7': GAD7_KEY}


def fixture_data() -> dict:
    raw = FIXTURE.read_bytes()
    data = json.loads(raw)
    if data.get('synthetic') is not True or data.get('schema_version') != VERSION:
        raise ValueError('Expected the explicit synthetic clinical dataset')
    cases = data['cases']
    ids = [case['mis_id'] for case in cases]
    if ids != list(range(1, 11)):
        raise ValueError('Expected exactly the ten known synthetic MIS profiles')
    scenarios = {case['mis_id']: case['scenario']['code'] for case in snapshot().patients}
    for case in cases:
        if case['scenario'] != scenarios.get(case['mis_id']):
            raise ValueError('Clinical demo profile differs from the synthetic MIS source')
        normalized = {}
        for name, values in case['responses'].items():
            if name not in INSTRUMENTS or not isinstance(values, list) or any(type(value) is not int for value in values):
                raise ValueError('Expected explicit integer answers for a known instrument')
            spec = instrument(INSTRUMENTS[name])
            sample = Survey(doctor_id=0, clinical_key=spec['key'], title=spec['name'], description=spec['instructions'],
                            questions=spec['questions'], version=1, published_at=datetime.now(timezone.utc))
            normalized[spec['key']] = validate_answers(sample, {f'q{i}': f'n{value}' for i, value in enumerate(values, 1)})
        case['answers'] = normalized
    return {**data, 'sha256': hashlib.sha256(raw).hexdigest()}


def request_key(mis_id: int, instrument_key: str) -> str:
    return str(uuid5(NAMESPACE_URL, f'limbus/{VERSION}/{mis_id}/{instrument_key}'))


def validate_environment(settings: Settings) -> None:
    url = make_url(settings.compass_database_url)
    if (settings.data_mode != 'synthetic_demo' or settings.telegram_enabled or settings.load_test_mode or
            url.host != '127.0.0.1' or not url.database or
            not (url.database.endswith(('_dev', '_test')) or url.database == 'compass_ui_flow_qa')):
        raise ValueError('Clinical demo initialization requires an isolated local synthetic environment')


async def seed_clinical(session: AsyncSession, *, apply: bool = False) -> dict:
    """Caller owns the transaction; all additions and provenance commit together."""
    data = fixture_data()
    if apply:
        # Serialize this explicit initializer, without locking ordinary app reads.
        await session.execute(text('SELECT pg_advisory_xact_lock(77102641)'))
    plan = []
    for case in data['cases']:
        patient_query = select(Patient).where(Patient.mis_id == case['mis_id'])
        if apply:
            patient_query = patient_query.with_for_update()
        patient = await session.scalar(patient_query)
        if patient is None:
            plan.append({'mis_id': case['mis_id'], 'action': 'skip', 'reason': 'patient_not_present'})
            continue
        account = await session.get(User, patient.user_id) if patient.user_id else None
        doctor = await session.get(User, patient.doctor_id)
        mapping = await session.scalar(select(PatientMapping).where(PatientMapping.compass_patient_id == patient.id))
        if (account is None or account.role != UserRole.patient or account.username != f"patient{case['mis_id']}" or
                doctor is None or doctor.role != UserRole.doctor or doctor.username not in {'doctor', 'doctor2'} or
                mapping is None or mapping.mis_id != patient.mis_id):
            raise ValueError('Existing account or patient mapping is not a known synthetic profile')
        status = await session.scalar(select(TreatmentStatusChange.status).where(
            TreatmentStatusChange.patient_id == patient.id).order_by(TreatmentStatusChange.created_at.desc(), TreatmentStatusChange.id.desc()).limit(1))
        if status != 'in_progress' or not case['answers']:
            plan.append({'mis_id': case['mis_id'], 'patient_id': patient.id, 'action': 'skip',
                         'reason': f'care_{status or "unknown"}' if status != 'in_progress' else 'preserve_missing_profile'})
            continue
        for key, answers in case['answers'].items():
            request = request_key(case['mis_id'], key)
            assignments = (await session.scalars(select(SurveyAssignment).join(Survey, Survey.id == SurveyAssignment.survey_id).where(
                SurveyAssignment.patient_id == patient.id, Survey.clinical_key == key))).all()
            existing = next((row for row in assignments if row.client_request_id == request), None)
            entry = {'mis_id': case['mis_id'], 'patient_id': patient.id, 'instrument_key': key, 'action': 'create',
                     'expected_score': calculate(key, answers)[0]}
            if any(row.client_request_id != request for row in assignments):
                plan.append({**entry, 'action': 'skip', 'reason': 'existing_clinical_assignment'})
                continue
            if existing is not None:
                submission = await session.scalar(select(SurveySubmission).where(SurveySubmission.assignment_id == existing.id))
                if submission is not None:
                    result = await session.scalar(select(ClinicalResult).where(ClinicalResult.submission_id == submission.id))
                    provenance = result.result.get('synthetic_provenance', {}) if result else {}
                    if submission.answers != answers or provenance.get('fixture_sha256') != data['sha256']:
                        raise ValueError('Existing demo answer has different content or provenance; nothing will be overwritten')
                    plan.append({**entry, 'action': 'replay', 'assignment_id': existing.id, 'result_id': result.id})
                    continue
                if existing.first_opened_at or await session.get(SurveyDraft, existing.id):
                    plan.append({**entry, 'action': 'skip', 'reason': 'existing_patient_interaction'})
                    continue
            plan.append(entry)

    # Preflight above validates every existing identity before any write.
    created = 0
    if apply:
        cases = {case['mis_id']: case for case in data['cases']}
        for entry in plan:
            if entry['action'] != 'create':
                continue
            patient = await session.get(Patient, entry['patient_id'])
            doctor = await session.get(User, patient.doctor_id)
            account = await session.get(User, patient.user_id)
            survey = await ensure_clinical_survey(session, doctor, entry['instrument_key'])
            survey = await owned_survey(session, doctor, survey.id, lock=True)
            survey_definition(survey)
            assigned = await assign_survey(session, doctor, survey, AssignSurvey(
                patient_ids=[patient.id], client_request_id=request_key(patient.mis_id, entry['instrument_key'])))
            submission, replayed = await submit_assignment(session, account, assigned[0],
                cases[patient.mis_id]['answers'][entry['instrument_key']], expected_draft_revision=0)
            if replayed:
                raise ValueError('Unexpected concurrent completion; initializer rolled back')
            result = await session.scalar(select(ClinicalResult).where(ClinicalResult.submission_id == submission.id))
            provenance = {'generated': True, 'dataset_version': VERSION, 'fixture_sha256': data['sha256'],
                          'scenario': cases[patient.mis_id]['scenario'], 'measurement': 'generated_current'}
            result.result = {**result.result, 'synthetic_provenance': provenance}
            record_event(session, None, patient.id, 'demo.clinical_answer_generated', 'clinical_result', result.id, provenance)
            entry.update(assignment_id=assigned[0], result_id=result.id)
            created += 1
        await session.flush()
    return {'dataset_version': VERSION, 'fixture_sha256': data['sha256'], 'synthetic': True, 'applied': apply,
            'created_results': created, 'would_create_results': sum(entry['action'] == 'create' for entry in plan),
            'replayed_results': sum(entry['action'] == 'replay' for entry in plan), 'plan': plan,
            'limitations': ['Current generated examples, not actual observations or historical trends.',
                           'Opening time stays unknown; generation latency is not patient completion time.',
                           'No baseline, physician decision, contact, clinical task completion or MIS write is generated.']}


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='Append the previewed synthetic answers to the local demo database')
    args = parser.parse_args()
    validate_environment(get_settings())
    try:
        async with async_session_compass() as session, session.begin():
            if not args.apply:
                await session.execute(text('SET TRANSACTION READ ONLY'))
            report = await seed_clinical(session, apply=args.apply)
        print(json.dumps(report, ensure_ascii=False, indent=2))
    finally:
        await dispose_engines()


if __name__ == '__main__':
    try:
        asyncio.run(main())
    except Exception as error:
        print(f'Clinical demo initialization stopped: {type(error).__name__}; connection details suppressed')
        raise SystemExit(1)
