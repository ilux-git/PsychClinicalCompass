"""Observed canonical coverage, always separated by immutable instrument edition."""
from datetime import datetime, timezone
from statistics import median

from sqlalchemy import and_, case, func, select

from app.modules.access.models import User
from app.modules.assessments.catalog import PHQ9_KEY, catalog
from app.modules.assessments.clinical_models import ClinicalBaseline, ClinicalResult
from app.modules.patients.models import Patient
from app.modules.surveys.models import Survey, SurveyAssignment, SurveySubmission


async def clinical_cohort(session, doctor: User, search: str = "") -> dict:
    as_of = datetime.now(timezone.utc)
    conditions = [Patient.doctor_id == doctor.id, Patient.created_at <= as_of]
    if search.strip():
        value = search.strip().replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')
        conditions.append(Patient.full_name.ilike(f'%{value}%', escape='\\'))
    cohort = select(Patient.id).where(*conditions).cte('clinical_cohort')
    patient_ids = select(cohort.c.id)
    total = await session.scalar(select(func.count()).select_from(cohort))
    definitions = catalog()
    keys = [item['key'] for item in definitions]
    assignments = {key: {'assigned_patients': patients, 'assignments': count, 'unanswered_assignments': unanswered}
        for key, patients, count, unanswered in (await session.execute(select(Survey.clinical_key,
            func.count(func.distinct(SurveyAssignment.patient_id)), func.count(SurveyAssignment.id),
            func.sum(case((SurveySubmission.id.is_(None), 1), else_=0))).join(
            SurveyAssignment, SurveyAssignment.survey_id == Survey.id).outerjoin(SurveySubmission, and_(
            SurveySubmission.assignment_id == SurveyAssignment.id, SurveySubmission.created_at <= as_of)).where(
            SurveyAssignment.patient_id.in_(patient_ids), Survey.clinical_key.in_(keys),
            SurveyAssignment.created_at <= as_of).group_by(Survey.clinical_key))).all()}
    counts = (select(ClinicalResult.instrument_key.label('key'), ClinicalResult.patient_id.label('patient_id'),
        func.count().label('count')).where(ClinicalResult.patient_id.in_(patient_ids),
        ClinicalResult.instrument_key.in_(keys), ClinicalResult.created_at <= as_of).group_by(
        ClinicalResult.instrument_key, ClinicalResult.patient_id)).subquery()
    observations = {key: {'observed_patients': int(patients), 'results': int(results), 'repeat_patients': int(repeats)}
        for key, patients, results, repeats in (await session.execute(select(counts.c.key, func.count(),
            func.sum(counts.c.count), func.sum(case((counts.c.count >= 2, 1), else_=0))).group_by(counts.c.key))).all()}
    latest = (await session.execute(select(ClinicalResult.instrument_key, ClinicalResult.score,
        ClinicalResult.result['criterion_met'].as_boolean().label('criterion_met'),
        ClinicalResult.result['triage']['severity'].as_string().label('review_severity')).where(
        ClinicalResult.patient_id.in_(patient_ids), ClinicalResult.instrument_key.in_(keys), ClinicalResult.created_at <= as_of)
        .distinct(ClinicalResult.patient_id, ClinicalResult.instrument_key).order_by(
        ClinicalResult.patient_id, ClinicalResult.instrument_key, ClinicalResult.created_at.desc(), ClinicalResult.id.desc()))).all()
    baseline_selected = await session.scalar(select(func.count()).select_from(ClinicalBaseline).where(
        ClinicalBaseline.patient_id.in_(patient_ids), ClinicalBaseline.instrument_key == PHQ9_KEY,
        ClinicalBaseline.result_id.is_not(None), ClinicalBaseline.selected_at <= as_of))
    instruments = []
    for definition in definitions:
        key = definition['key']
        rows = [row for row in latest if row.instrument_key == key]
        scores = [row.score for row in rows if row.score is not None]
        reviews = {name: 0 for name in ('urgent_review', 'review_required', 'needs_clarification', 'no_signal', 'not_calculated')}
        for row in rows:
            reviews[row.review_severity if row.review_severity in reviews else 'not_calculated'] += 1
        assigned = assignments.get(key, {'assigned_patients': 0, 'assignments': 0, 'unanswered_assignments': 0})
        observed = observations.get(key, {'observed_patients': 0, 'results': 0, 'repeat_patients': 0})
        instruments.append({**{field: definition[field] for field in ('key', 'name', 'version', 'maximum',
            'source_title', 'source_url', 'source_check', 'license', 'license_url', 'limitation')}, **assigned, **observed,
            'patients_without_results': total - observed['observed_patients'],
            'coverage_percent': round(100 * observed['observed_patients'] / assigned['assigned_patients'], 1) if assigned['assigned_patients'] else None,
            'numeric_latest_patients': len(scores), 'median_score': median(scores) if scores else None,
            'minimum_score': min(scores) if scores else None, 'maximum_score': max(scores) if scores else None,
            'baseline_selected_patients': baseline_selected if key == PHQ9_KEY else None,
            'criterion': {'met': sum(row.criterion_met is True for row in rows),
                          'not_met': sum(row.criterion_met is False for row in rows),
                          'unknown': sum(row.criterion_met is None for row in rows)} if definition['maximum'] is None else None,
            'latest_review': reviews})
    return {'as_of': as_of, 'patients_total': total, 'search': search.strip(), 'instruments': instruments,
            'unit': 'latest_result_per_patient_and_instrument_edition', 'legacy_numeric_results_included': False}
