from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, text

from app.api.deps import CompassSession, patient_for_user, require_role
from app.modules.access.models import User, UserRole
from app.modules.adherence.models import AdherenceReport, DiaryEntry
from app.modules.adherence.medication_models import MedicationLog
from app.modules.alerts.models import Alert
from app.modules.assessments.models import QuestionnaireResponse
from app.modules.audit.service import record_event
from app.modules.messaging.models import Message
from app.modules.notes.models import DoctorNote, DoctorTask
from app.modules.patients.models import Patient
from app.modules.surveys.models import SurveySubmission

from app.modules.notes.schemas import NoteWrite, TaskWrite, TaskStatus, TaskVerification

router = APIRouter(tags=["notes"])
Doctor = Depends(require_role([UserRole.doctor]))


def note_read(note: DoctorNote) -> dict:
    return {"id": note.id, "patient_id": note.patient_id, "doctor_id": note.doctor_id, "text": note.text,
            "source_type": note.source_type, "source_id": note.source_id, "dimension": note.dimension,
            "source": "doctor_observation", "created_at": note.created_at}


def task_read(task: DoctorTask, operational: bool = False) -> dict:
    data = {"id": task.id, "patient_id": task.patient_id, "doctor_id": task.doctor_id, "title": task.title,
            "status": task.status, "due_at": task.due_at, "created_at": task.created_at, "completed_at": task.completed_at,
            "assigned_to_id": task.assigned_to_id or task.doctor_id, "kind": task.kind,
            "action_result": task.action_result, "follow_up_at": task.follow_up_at,
            "verification_status": task.verification_status}
    if not operational:
        data.update(source_type=task.source_type, source_id=task.source_id,
                    verification_comment=task.verification_comment, verified_at=task.verified_at,
                    verified_by_id=task.verified_by_id)
    return data


async def validate_task_source(session, patient_id, source_type, source_id):
    if source_id is None:
        return
    model = {"message": Message, "assessment": QuestionnaireResponse, "survey_submission": SurveySubmission,
             "adherence_report": AdherenceReport, "alert": Alert, "doctor_note": DoctorNote,
             "medication_log": MedicationLog, "diary_entry": DiaryEntry}[source_type]
    source = await session.get(model, source_id)
    if source is None or source.patient_id != patient_id or (source_type == "diary_entry" and not source.shared_with_doctor):
        raise HTTPException(404, "Источник не найден в карточке пациента")


@router.get("/patients/{patient_id}/notes")
async def notes(patient_id: int, session: CompassSession, doctor: User = Doctor) -> list[dict]:
    await patient_for_user(session, doctor, patient_id)
    rows = (await session.execute(select(DoctorNote, User.display_name).join(User, User.id == DoctorNote.doctor_id).where(
        DoctorNote.patient_id == patient_id).order_by(DoctorNote.created_at.desc(), DoctorNote.id.desc()))).all()
    return [{**note_read(note), "doctor_name": name} for note, name in rows]


@router.post("/patients/{patient_id}/notes", status_code=201)
async def add_note(patient_id: int, payload: NoteWrite, session: CompassSession, doctor: User = Doctor) -> dict:
    await patient_for_user(session, doctor, patient_id)
    await validate_task_source(session, patient_id, payload.source_type, payload.source_id)
    note = DoctorNote(patient_id=patient_id, doctor_id=doctor.id, **payload.model_dump())
    session.add(note)
    await session.flush()
    record_event(session, doctor.id, patient_id, "doctor.note_created", "doctor_note", note.id)
    await session.commit()
    return {**note_read(note), "doctor_name": doctor.display_name}


@router.get("/patients/{patient_id}/tasks")
async def tasks(patient_id: int, session: CompassSession, doctor: User = Doctor) -> list[dict]:
    await patient_for_user(session, doctor, patient_id)
    return [task_read(t) for t in (await session.scalars(select(DoctorTask).where(DoctorTask.patient_id == patient_id)
                                                        .order_by(DoctorTask.created_at.desc(), DoctorTask.id.desc()))).all()]


@router.post("/patients/{patient_id}/tasks", status_code=201)
async def add_task(patient_id: int, payload: TaskWrite, session: CompassSession, doctor: User = Doctor) -> dict:
    await session.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": 847000 + doctor.id})
    patient = await session.scalar(select(Patient).where(Patient.id == patient_id, Patient.doctor_id == doctor.id).with_for_update())
    if patient is None:
        raise HTTPException(404, "Пациент не найден или недоступен")
    await validate_task_source(session, patient_id, payload.source_type, payload.source_id)
    assignee = await session.get(User, payload.assigned_to_id or doctor.id)
    if assignee is None or (assignee.id != doctor.id and assignee.role != UserRole.coordinator):
        raise HTTPException(422, "Выберите лечащего врача или координатора")
    if payload.kind == "clinical" and assignee.id != doctor.id:
        raise HTTPException(422, "Клиническую задачу выполняет лечащий врач")
    data = payload.model_dump(exclude={"client_request_id"})
    data["assigned_to_id"] = assignee.id
    if payload.client_request_id:
        previous = await session.scalar(select(DoctorTask).where(DoctorTask.doctor_id == doctor.id,
            DoctorTask.client_request_id == str(payload.client_request_id)))
        if previous:
            if previous.patient_id != patient_id or any(getattr(previous, k) != v for k, v in data.items()):
                raise HTTPException(409, "Ключ запроса уже использован для другой задачи")
            return task_read(previous)
    task = DoctorTask(patient_id=patient_id, doctor_id=doctor.id,
                      client_request_id=str(payload.client_request_id) if payload.client_request_id else None, **data)
    session.add(task)
    await session.flush()
    record_event(session, doctor.id, patient_id, "doctor.task_created", "doctor_task", task.id)
    await session.commit()
    return task_read(task)


@router.patch("/tasks/{task_id}")
async def update_task(task_id: int, payload: TaskStatus, session: CompassSession,
                      doctor: User = Depends(require_role([UserRole.doctor, UserRole.coordinator]))) -> dict:
    scope = Patient.doctor_id == doctor.id if doctor.role == UserRole.doctor else (
        (DoctorTask.assigned_to_id == doctor.id) & (DoctorTask.kind == "organization"))
    task = await session.scalar(select(DoctorTask).join(Patient, Patient.id == DoctorTask.patient_id).where(
        DoctorTask.id == task_id, scope).with_for_update(of=DoctorTask))
    if task is None:
        raise HTTPException(404, "Задача не найдена или недоступна")
    if task.verification_status != "pending" and (task.status != payload.status or (
        payload.action_result is not None and task.action_result != payload.action_result.strip())):
        raise HTTPException(409, "Результат уже проверен врачом; создайте новую задачу")
    changed = task.status != payload.status or (payload.action_result is not None and task.action_result != payload.action_result.strip())
    if changed:
        task.status = payload.status
        if payload.action_result is not None:
            task.action_result = payload.action_result.strip()
        task.completed_at = (task.completed_at or datetime.now(timezone.utc)) if task.status == "done" else None
        record_event(session, doctor.id, task.patient_id, "doctor.task_updated", "doctor_task", task.id,
                     {"status": task.status, "action_result": task.action_result})
    await session.commit()
    return task_read(task, operational=doctor.role == UserRole.coordinator)


@router.post("/tasks/{task_id}/verify")
async def verify_task(task_id: int, payload: TaskVerification, session: CompassSession, doctor: User = Doctor):
    task = await session.scalar(select(DoctorTask).join(Patient, Patient.id == DoctorTask.patient_id).where(
        DoctorTask.id == task_id, Patient.doctor_id == doctor.id).with_for_update(of=DoctorTask))
    if task is None:
        raise HTTPException(404, "Задача не найдена или недоступна")
    if task.status != "done":
        raise HTTPException(409, "Сначала зафиксируйте выполненное действие")
    if task.verification_status != "pending":
        if task.verification_status != payload.status or task.verification_comment != payload.comment:
            raise HTTPException(409, "Проверка уже сохранена; для нового наблюдения создайте задачу")
        return task_read(task)
    task.verification_status, task.verification_comment = payload.status, payload.comment
    task.verified_at, task.verified_by_id = datetime.now(timezone.utc), doctor.id
    record_event(session, doctor.id, task.patient_id, "task.result_verified", "doctor_task", task.id,
                 {"verification_status": payload.status})
    await session.commit()
    return task_read(task)


@router.get("/coordination/team")
async def team(session: CompassSession, doctor: User = Doctor):
    rows = (await session.scalars(select(User).where(
        (User.id == doctor.id) | (User.role == UserRole.coordinator)).order_by(User.id))).all()
    return [{"id": u.id, "name": u.display_name, "role": u.role.value} for u in rows]


@router.get("/coordination/tasks")
async def coordination_tasks(session: CompassSession,
        user: User = Depends(require_role([UserRole.doctor, UserRole.coordinator]))):
    scope = Patient.doctor_id == user.id if user.role == UserRole.doctor else (
        (DoctorTask.assigned_to_id == user.id) & (DoctorTask.kind == "organization"))
    rows = (await session.execute(select(DoctorTask, Patient.full_name).join(
        Patient, Patient.id == DoctorTask.patient_id).where(scope).order_by(DoctorTask.id.desc()))).all()
    return [{**task_read(task, operational=user.role == UserRole.coordinator), "patient_name": name} for task, name in rows]
