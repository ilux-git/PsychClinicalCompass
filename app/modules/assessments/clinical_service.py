from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.access.models import User
from app.modules.assessments.catalog import PHQ9_KEY, calculate, instrument
from app.modules.assessments.clinical_models import ClinicalBaseline, ClinicalResult
from app.modules.assessments.models import OutboxEvent
from app.modules.assessments.alert_protocol import assess_current_review
from app.modules.audit.service import record_event
from app.modules.patients.models import Patient
from app.modules.surveys.models import Survey, SurveySubmission


def survey_definition(survey: Survey) -> dict | None:
    if survey.clinical_key is None:
        return None
    spec = instrument(survey.clinical_key)
    if (survey.questions != spec["questions"] or survey.title != spec["name"] or
            survey.description != spec["instructions"] or survey.version != 1 or not survey.published_at):
        raise HTTPException(409, "Содержание клинической формы не совпадает с зафиксированной версией")
    return spec


async def ensure_clinical_survey(session: AsyncSession, doctor: User, key: str) -> Survey:
    spec = instrument(key)
    # Concurrent retries create a single immutable edition in this doctor's library.
    survey_id = await session.scalar(insert(Survey).values(
        doctor_id=doctor.id, clinical_key=key, title=spec["name"], description=spec["instructions"],
        questions=spec["questions"], purpose="clinical", version=1, published_at=datetime.now(timezone.utc),
    ).on_conflict_do_nothing(constraint="uq_survey_doctor_clinical_key").returning(Survey.id))
    if survey_id is not None:
        record_event(session, doctor.id, None, "clinical_survey.added", "survey", survey_id, {"instrument_key": key})
    survey = await session.scalar(select(Survey).where(Survey.doctor_id == doctor.id, Survey.clinical_key == key))
    survey_definition(survey)
    return survey


async def save_clinical_result(session: AsyncSession, survey: Survey, submission: SurveySubmission,
                               actor_id: int) -> ClinicalResult | None:
    spec = survey_definition(survey)
    if spec is None:
        return None
    score, result = calculate(spec["key"], submission.answers)
    previous = await session.scalar(select(ClinicalResult).where(
        ClinicalResult.patient_id == submission.patient_id, ClinicalResult.instrument_key == spec["key"]
    ).order_by(ClinicalResult.id.desc()).limit(1)) if spec["key"] == PHQ9_KEY else None
    baseline = await session.scalar(select(ClinicalResult).join(
        ClinicalBaseline, ClinicalBaseline.result_id == ClinicalResult.id).where(
        ClinicalBaseline.patient_id == submission.patient_id, ClinicalBaseline.instrument_key == spec["key"]
    )) if spec["key"] == PHQ9_KEY else None
    result["triage"] = assess_current_review(spec["key"], score, result,
                                     previous=reference_read(previous), baseline=reference_read(baseline))
    row = ClinicalResult(patient_id=submission.patient_id, submission_id=submission.id,
                         instrument_key=spec["key"], definition=spec, score=score, result=result,
                         created_at=datetime.now(timezone.utc))
    session.add(row)
    await session.flush()
    record_event(session, actor_id, submission.patient_id, "clinical_assessment.completed", "clinical_result",
                 row.id, {"instrument_key": row.instrument_key, "submission_id": submission.id})
    if result["triage"]["grounds"]:
        session.add(OutboxEvent(event_type="clinical.assessment_flagged",
                                payload={"clinical_result_id": row.id, "patient_id": row.patient_id}))
    return row


def reference_read(row: ClinicalResult | None) -> dict | None:
    if row is None:
        return None
    return {"result_id": row.id, "score": row.score, "created_at": row.created_at.isoformat()}


def baseline_read(row: ClinicalBaseline | None, key: str) -> dict:
    return {"instrument_key": key, "result_id": row.result_id if row else None,
            "revision": row.revision if row else 0, "selected_by": row.selected_by if row else None,
            "selected_at": row.selected_at if row else None, "reason": row.reason if row else ""}


async def select_baseline(session: AsyncSession, doctor: User, patient_id: int, key: str,
                          result_id: int | None, expected_revision: int, reason: str) -> dict:
    if key != PHQ9_KEY:
        raise HTTPException(422, "Согласованное сравнение с исходным измерением доступно для выбранной версии PHQ-9")
    patient = await session.scalar(select(Patient).where(
        Patient.id == patient_id, Patient.doctor_id == doctor.id).with_for_update())
    if patient is None:
        raise HTTPException(404, "Пациент не найден или недоступен")
    reference = await session.scalar(select(ClinicalResult).where(
        ClinicalResult.id == result_id, ClinicalResult.patient_id == patient_id,
        ClinicalResult.instrument_key == key)) if result_id is not None else None
    if result_id is not None and reference is None:
        raise HTTPException(404, "Исходное измерение этой версии не найдено или недоступно")
    row = await session.scalar(select(ClinicalBaseline).where(
        ClinicalBaseline.patient_id == patient_id, ClinicalBaseline.instrument_key == key))
    revision = row.revision if row else 0
    if row and row.result_id == result_id and row.reason == reason and expected_revision <= revision:
        return {**baseline_read(row, key), "replayed": True}
    if revision != expected_revision:
        raise HTTPException(409, "Выбор исходного измерения изменился. Обновите его перед сохранением")
    now = datetime.now(timezone.utc)
    if row is None:
        row = ClinicalBaseline(patient_id=patient_id, instrument_key=key, result_id=result_id,
                               selected_by=doctor.id, selected_at=now, reason=reason, revision=1)
        session.add(row)
    else:
        row.result_id, row.selected_by, row.selected_at, row.reason = result_id, doctor.id, now, reason
        row.revision += 1
    await session.flush()
    record_event(session, doctor.id, patient_id, "clinical_baseline.selected", "clinical_baseline", row.id,
                 {"instrument_key": key, "result_id": result_id, "revision": row.revision})
    return {**baseline_read(row, key), "replayed": False}


def result_read(row: ClinicalResult, submission: SurveySubmission) -> dict:
    return {"id": row.id, "patient_id": row.patient_id, "submission_id": row.submission_id,
            "instrument_key": row.instrument_key, "definition": row.definition,
            "score": row.score, "result": row.result, "answers": submission.answers,
            "created_at": row.created_at}
