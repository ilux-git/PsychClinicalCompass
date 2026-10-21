from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select

from app.api.deps import CompassSession, CurrentUser, require_role
from app.modules.access.models import User, UserRole
from app.modules.audit.service import record_event
from app.modules.patients.models import Patient
from app.modules.surveys.models import Survey, SurveyAssignment, SurveySubmission
from app.modules.surveys.schemas import AssignSurvey, SubmitSurvey, SurveyWrite
from app.modules.surveys.service import assign_survey, create_survey, owned_survey, submit_assignment, survey_read

router = APIRouter(tags=["surveys"])
Doctor = Depends(require_role([UserRole.doctor]))
PatientUser = Depends(require_role([UserRole.patient]))


@router.get("/surveys")
async def list_surveys(session: CompassSession, doctor: User = Doctor) -> list[dict]:
    surveys = (await session.scalars(select(Survey).where(Survey.doctor_id == doctor.id).order_by(Survey.id.desc()))).all()
    return [survey_read(s) for s in surveys]


@router.post("/surveys", status_code=201)
async def new_survey(payload: SurveyWrite, session: CompassSession, doctor: User = Doctor) -> dict:
    survey = await create_survey(session, doctor, payload)
    await session.commit()
    return survey_read(survey)


@router.put("/surveys/{survey_id}")
async def edit_survey(survey_id: int, payload: SurveyWrite, session: CompassSession, doctor: User = Doctor) -> dict:
    survey = await owned_survey(session, doctor, survey_id, lock=True)
    if survey.published_at:
        raise HTTPException(409, "Опубликованный опрос неизменяем. Создайте новую версию")
    for key, value in payload.model_dump(mode="json").items():
        setattr(survey, key, value)
    record_event(session, doctor.id, None, "survey.edited", "survey", survey.id)
    await session.commit()
    return survey_read(survey)


@router.post("/surveys/{survey_id}/publish")
async def publish_survey(survey_id: int, session: CompassSession, doctor: User = Doctor) -> dict:
    survey = await owned_survey(session, doctor, survey_id, lock=True)
    if not survey.published_at:
        survey.published_at = datetime.now(timezone.utc)
        record_event(session, doctor.id, None, "survey.published", "survey", survey.id)
    await session.commit()
    return survey_read(survey)


@router.post("/surveys/{survey_id}/copy", status_code=201)
async def copy_survey(survey_id: int, session: CompassSession, doctor: User = Doctor) -> dict:
    previous = await owned_survey(session, doctor, survey_id)
    survey = await create_survey(session, doctor, SurveyWrite.model_validate(survey_read(previous)), previous=previous)
    await session.commit()
    return survey_read(survey)


@router.post("/surveys/{survey_id}/assign", status_code=201)
async def assign(survey_id: int, payload: AssignSurvey, session: CompassSession, doctor: User = Doctor) -> dict:
    survey = await owned_survey(session, doctor, survey_id, lock=True)
    ids = await assign_survey(session, doctor, survey, payload)
    await session.commit()
    return {"assignment_ids": ids}


@router.get("/survey-assignments")
async def assignments(session: CompassSession, user: CurrentUser, patient_id: int | None = None) -> list[dict]:
    if user.role == UserRole.admin:
        raise HTTPException(403, "Нет клинического доступа")
    query = select(SurveyAssignment, Survey, Patient, SurveySubmission).join(Survey, Survey.id == SurveyAssignment.survey_id).join(
        Patient, Patient.id == SurveyAssignment.patient_id).outerjoin(SurveySubmission, SurveySubmission.assignment_id == SurveyAssignment.id)
    query = query.where(Patient.doctor_id == user.id) if user.role == UserRole.doctor else query.where(Patient.user_id == user.id)
    if patient_id is not None:
        # Scope is applied to the filtered list as well as object endpoints.
        from app.api.deps import patient_for_user
        await patient_for_user(session, user, patient_id)
        query = query.where(Patient.id == patient_id)
    rows = (await session.execute(query.order_by(SurveyAssignment.created_at.desc(), SurveyAssignment.id.desc()))).all()
    return [{"id": a.id, "patient_id": p.id, "patient_name": p.full_name, "status": a.status,
             "due_at": a.due_at, "created_at": a.created_at, "survey": survey_read(s),
             "submission": {"id": r.id, "answers": r.answers, "created_at": r.created_at} if r else None}
            for a, s, p, r in rows]


@router.post("/survey-assignments/{assignment_id}/submit")
async def submit(assignment_id: int, payload: SubmitSurvey, session: CompassSession, patient: User = PatientUser) -> dict:
    response, replayed = await submit_assignment(session, patient, assignment_id, payload.answers)
    await session.commit()
    return {"id": response.id, "assignment_id": response.assignment_id, "created_at": response.created_at,
            "replayed": replayed, "message": "Спасибо! Ваши ответы сохранены и доступны лечащему врачу."}
