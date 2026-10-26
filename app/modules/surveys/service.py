from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.access.models import User
from app.modules.audit.service import record_event
from app.modules.adherence.rewards import CLINICAL_POLICY_VERSION, grant_points
from app.modules.patients.models import Patient
from app.modules.surveys.models import Survey, SurveyAssignment, SurveySubmission, SurveyDraft
from app.modules.surveys.schemas import AssignSurvey, SurveyWrite
from app.modules.assessments.catalog import visible_questions
from app.modules.assessments.clinical_service import save_clinical_result, survey_definition


def survey_read(survey: Survey) -> dict:
    definition = survey_definition(survey)
    return {"id": survey.id, "title": survey.title, "description": survey.description,
            "purpose": survey.purpose, "questions": survey.questions, "version": survey.version,
            "previous_version_id": survey.previous_version_id, "published_at": survey.published_at,
            "created_at": survey.created_at, "is_clinical_scale": definition is not None,
            "clinical_instrument": definition}


async def owned_survey(session: AsyncSession, doctor: User, survey_id: int, lock: bool = False) -> Survey:
    query = select(Survey).where(Survey.id == survey_id, Survey.doctor_id == doctor.id)
    if lock:
        query = query.with_for_update()
    survey = await session.scalar(query)
    if survey is None:
        raise HTTPException(404, "Опрос не найден или недоступен")
    return survey


async def create_survey(session: AsyncSession, doctor: User, payload: SurveyWrite,
                        previous: Survey | None = None) -> Survey:
    data = payload.model_dump(mode="json")
    survey = Survey(doctor_id=doctor.id, **data, version=previous.version + 1 if previous else 1,
                    previous_version_id=previous.id if previous else None)
    session.add(survey)
    await session.flush()
    record_event(session, doctor.id, None, "survey.created", "survey", survey.id)
    return survey


async def assign_survey(session: AsyncSession, doctor: User, survey: Survey, payload: AssignSurvey) -> list[int]:
    if survey.published_at is None:
        raise HTTPException(409, "Сначала опубликуйте опрос")
    patients = (await session.scalars(select(Patient).where(Patient.id.in_(payload.patient_ids), Patient.doctor_id == doctor.id))).all()
    if len(patients) != len(payload.patient_ids):
        raise HTTPException(404, "Один из пациентов не найден или недоступен")
    # The caller locks this survey, serializing creation of one request batch.
    previous_batch = (await session.scalars(select(SurveyAssignment).where(
        SurveyAssignment.survey_id == survey.id,
        SurveyAssignment.client_request_id == str(payload.client_request_id)))).all()
    if previous_batch:
        if {a.patient_id for a in previous_batch} != set(payload.patient_ids) or any(
            a.due_at != payload.due_at for a in previous_batch
        ):
            raise HTTPException(409, "Ключ запроса уже использован с другим составом пациентов или сроком")
        return [a.id for a in sorted(previous_batch, key=lambda a: a.patient_id)]
    result_ids: list[int] = []
    for patient in sorted(patients, key=lambda p: p.id):
        statement = insert(SurveyAssignment).values(survey_id=survey.id, patient_id=patient.id,
                  client_request_id=str(payload.client_request_id), due_at=payload.due_at, status="assigned")
        result = await session.execute(statement.on_conflict_do_nothing(constraint="uq_survey_assignment_request").returning(SurveyAssignment.id))
        assignment_id = result.scalar_one_or_none()
        if assignment_id is None:
            previous = await session.scalar(select(SurveyAssignment).where(SurveyAssignment.survey_id == survey.id,
                 SurveyAssignment.patient_id == patient.id, SurveyAssignment.client_request_id == str(payload.client_request_id)))
            if previous.due_at != payload.due_at:
                raise HTTPException(409, "Ключ запроса уже использован с другим сроком")
            assignment_id = previous.id
        else:
            record_event(session, doctor.id, patient.id, "survey.assigned", "survey_assignment", assignment_id)
        result_ids.append(assignment_id)
    return result_ids


def validate_answers(survey: Survey, answers: dict, *, partial: bool = False) -> dict:
    clinical = survey_definition(survey)
    questions = {q["id"]: q for q in survey.questions}
    if set(answers) - set(questions):
        raise HTTPException(422, "В ответах есть неизвестный вопрос")
    if clinical:
        visible = {q["id"] for q in visible_questions(survey.questions, answers)}
        if set(answers) - visible:
            raise HTTPException(422, "Ответы на скрытые вопросы не принимаются. Проверьте первый ответ")
        questions = {key: q for key, q in questions.items() if key in visible}
    normalized: dict = {}
    for qid, question in questions.items():
        value = answers.get(qid)
        empty = value is None or value == "" or value == [] or (isinstance(value, str) and not value.strip())
        if empty:
            if question["required"] and not partial:
                raise HTTPException(422, f"Нужен ответ: {question['prompt']}")
            continue
        kind = question["kind"]
        options = {o["id"] for o in question["options"]}
        valid = False
        if kind == "single":
            valid = isinstance(value, str) and value in options
        elif kind == "multiple":
            valid = isinstance(value, list) and all(isinstance(v, str) for v in value)
            valid = valid and len(set(value)) == len(value) and set(value) <= options
            if valid and len(value) > 1 and any(o.get("exclusive") and o["id"] in value for o in question["options"]):
                valid = False
        elif kind == "text":
            valid = isinstance(value, str) and len(value) <= 4000
            if valid:
                value = value.strip()
        elif kind == "scale":
            valid = type(value) is int and question["minimum"] <= value <= question["maximum"]
        if not valid:
            raise HTTPException(422, f"Недопустимый ответ: {question['prompt']}")
        normalized[qid] = value
    return normalized


async def owned_assignment(session: AsyncSession, user: User, assignment_id: int,
                           *, lock: bool = False) -> SurveyAssignment:
    query = select(SurveyAssignment).join(Patient, Patient.id == SurveyAssignment.patient_id).where(
        SurveyAssignment.id == assignment_id, Patient.user_id == user.id)
    if lock:
        query = query.with_for_update(of=SurveyAssignment)
    assignment = await session.scalar(query)
    if assignment is None:
        raise HTTPException(404, "Назначение не найдено или недоступно")
    return assignment


def draft_read(assignment_id: int, draft: SurveyDraft | None, *, completed: bool = False) -> dict:
    return {"assignment_id": assignment_id, "answers": draft.answers if draft else {},
            "revision": draft.revision if draft else 0, "updated_at": draft.updated_at if draft else None,
            "already_completed": completed}


async def save_draft(session: AsyncSession, user: User, assignment_id: int,
                     answers: dict, expected_revision: int) -> dict:
    # The same assignment lock serializes draft writes and final submission.
    assignment = await owned_assignment(session, user, assignment_id, lock=True)
    if await session.scalar(select(SurveySubmission.id).where(SurveySubmission.assignment_id == assignment.id)):
        raise HTTPException(409, "Ответ уже отправлен. Обновите список опросов")
    survey = await session.get(Survey, assignment.survey_id)
    normalized = validate_answers(survey, answers, partial=True)
    draft = await session.get(SurveyDraft, assignment.id)
    current_revision = draft.revision if draft else 0
    if normalized == (draft.answers if draft else {}) and expected_revision <= current_revision:
        return {**draft_read(assignment.id, draft), "replayed": True}
    if expected_revision != current_revision:
        raise HTTPException(409, "Черновик изменён в другом окне. Загрузите сохранённую версию перед новой записью")
    if draft is None:
        draft = SurveyDraft(assignment_id=assignment.id, answers=normalized, revision=1)
        session.add(draft)
    else:
        draft.answers = normalized
        draft.revision += 1
        draft.updated_at = datetime.now(timezone.utc)
    await session.flush()
    # Audit metadata never contains private working answers.
    record_event(session, user.id, assignment.patient_id, "survey.draft_saved", "survey_assignment",
                 assignment.id, {"revision": draft.revision, "answered_questions": len(normalized)})
    return {**draft_read(assignment.id, draft), "replayed": False}


async def submit_assignment(session: AsyncSession, user: User, assignment_id: int, answers: dict,
                            expected_draft_revision: int | None = None) -> tuple[SurveySubmission, bool]:
    assignment = await owned_assignment(session, user, assignment_id, lock=True)
    survey = await session.get(Survey, assignment.survey_id)
    normalized = validate_answers(survey, answers)
    previous = await session.scalar(select(SurveySubmission).where(SurveySubmission.assignment_id == assignment.id))
    if previous:
        if previous.answers != normalized:
            raise HTTPException(409, "Ответ уже отправлен. Для нового ответа врач назначает новый опрос")
        return previous, True
    draft = await session.get(SurveyDraft, assignment.id)
    current_revision = draft.revision if draft else 0
    if (draft is not None and expected_draft_revision is None) or (
        expected_draft_revision is not None and expected_draft_revision != current_revision
    ):
        raise HTTPException(409, "Черновик изменён в другом окне. Загрузите сохранённую версию перед отправкой")
    await session.scalar(select(Patient).where(Patient.id == assignment.patient_id).with_for_update())
    submission = SurveySubmission(assignment_id=assignment.id, patient_id=assignment.patient_id, answers=normalized)
    session.add(submission)
    assignment.status = "completed"
    if draft is not None:
        await session.delete(draft)
    await session.flush()
    record_event(session, user.id, assignment.patient_id, "survey.completed", "survey_submission", submission.id)
    clinical_result = await save_clinical_result(session, survey, submission, user.id)
    units = sum(2 if q["kind"] == "text" else 1 for q in survey.questions if q["id"] in normalized)
    if clinical_result is not None:
        # A positive screening answer must never buy a larger award than a negative one.
        await grant_points(session, assignment.patient_id, "survey", f"survey_submission:{submission.id}", user.id,
                           len(survey.questions), policy_version=CLINICAL_POLICY_VERSION)
    else:
        await grant_points(session, assignment.patient_id, "survey", f"survey_submission:{submission.id}", user.id, units)
    return submission, False
