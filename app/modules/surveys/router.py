from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import literal, select

from app.api.deps import CompassSession, CurrentUser, require_role
from app.modules.access.models import User, UserRole
from app.modules.audit.service import record_event
from app.modules.patients.models import Patient
from app.modules.surveys.models import Survey, SurveyAssignment, SurveySubmission, SurveyDraft
from app.modules.surveys.schemas import AssignSurvey, SubmitSurvey, SurveyWrite, SaveSurveyDraft
from app.modules.surveys.service import assign_survey, create_survey, owned_survey, submit_assignment, survey_read, draft_read, save_draft

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
    if user.role not in {UserRole.doctor, UserRole.patient}:
        raise HTTPException(403, "Нет клинического доступа")
    draft_time = SurveyDraft.updated_at if user.role == UserRole.patient else literal(None)
    query = select(SurveyAssignment, Survey, Patient, SurveySubmission, draft_time).join(Survey, Survey.id == SurveyAssignment.survey_id).join(
        Patient, Patient.id == SurveyAssignment.patient_id).outerjoin(SurveySubmission, SurveySubmission.assignment_id == SurveyAssignment.id)
    if user.role == UserRole.patient:
        query = query.outerjoin(SurveyDraft, SurveyDraft.assignment_id == SurveyAssignment.id)
    query = query.where(Patient.doctor_id == user.id) if user.role == UserRole.doctor else query.where(Patient.user_id == user.id)
    if patient_id is not None:
        # Scope is applied to the filtered list as well as object endpoints.
        from app.api.deps import patient_for_user
        await patient_for_user(session, user, patient_id)
        query = query.where(Patient.id == patient_id)
    rows = (await session.execute(query.order_by(SurveyAssignment.created_at.desc(), SurveyAssignment.id.desc()))).all()
    return [{"id": a.id, "patient_id": p.id, "patient_name": p.full_name, "status": a.status,
             "due_at": a.due_at, "created_at": a.created_at, "first_opened_at": a.first_opened_at, "survey": survey_read(s),
             "submission": {"id": r.id, "answers": r.answers, "created_at": r.created_at} if r else None,
             **({"draft_updated_at": updated_at} if user.role == UserRole.patient else {})}
            for a, s, p, r, updated_at in rows]


@router.post("/survey-assignments/{assignment_id}/open")
async def open_assignment(assignment_id: int, session: CompassSession, patient: User = PatientUser) -> dict:
    assignment = await session.scalar(select(SurveyAssignment).join(Patient, Patient.id == SurveyAssignment.patient_id).where(
        SurveyAssignment.id == assignment_id, Patient.user_id == patient.id).with_for_update(of=SurveyAssignment))
    if assignment is None:
        raise HTTPException(404, "Назначение не найдено или недоступно")
    completed = await session.scalar(select(SurveySubmission.id).where(SurveySubmission.assignment_id == assignment.id))
    # Reading completed history cannot manufacture a historical start time.
    if assignment.first_opened_at is None and completed is None:
        assignment.first_opened_at = datetime.now(timezone.utc)
        record_event(session, patient.id, assignment.patient_id, "survey.opened", "survey_assignment", assignment.id,
                     {"source": "visible_patient_form"})
    await session.commit()
    return {"assignment_id": assignment.id, "first_opened_at": assignment.first_opened_at,
            "already_completed": completed is not None}


@router.post("/survey-assignments/{assignment_id}/submit")
async def submit(assignment_id: int, payload: SubmitSurvey, session: CompassSession, patient: User = PatientUser) -> dict:
    response, replayed = await submit_assignment(session, patient, assignment_id, payload.answers,
                                                payload.expected_draft_revision)
    await session.commit()
    return {"id": response.id, "assignment_id": response.assignment_id, "created_at": response.created_at,
            "replayed": replayed, "message": "Спасибо! Ваши ответы сохранены и доступны лечащему врачу."}


@router.get("/survey-assignments/{assignment_id}/draft")
async def get_patient_draft(assignment_id: int, session: CompassSession, patient: User = PatientUser) -> dict:
    row = (await session.execute(select(SurveyAssignment, SurveyDraft, SurveySubmission.id).join(
        Patient, Patient.id == SurveyAssignment.patient_id).outerjoin(
        SurveyDraft, SurveyDraft.assignment_id == SurveyAssignment.id).outerjoin(
        SurveySubmission, SurveySubmission.assignment_id == SurveyAssignment.id).where(
        SurveyAssignment.id == assignment_id, Patient.user_id == patient.id))).one_or_none()
    if row is None:
        raise HTTPException(404, "Назначение не найдено или недоступно")
    assignment, draft, submission_id = row
    return draft_read(assignment.id, draft, completed=submission_id is not None)


@router.put("/survey-assignments/{assignment_id}/draft")
async def put_patient_draft(assignment_id: int, payload: SaveSurveyDraft, session: CompassSession,
                            patient: User = PatientUser) -> dict:
    result = await save_draft(session, patient, assignment_id, payload.answers, payload.expected_revision)
    await session.commit()
    return result
