from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select

from app.api.deps import CompassSession, patient_for_user, require_role
from app.modules.access.models import User, UserRole
from app.modules.adherence.models import AdherenceReport
from app.modules.alerts.models import Alert
from app.modules.assessments.models import QuestionnaireResponse
from app.modules.audit.service import record_event
from app.modules.messaging.models import Message
from app.modules.notes.models import DoctorNote, DoctorTask
from app.modules.patients.models import Patient
from app.modules.surveys.models import SurveySubmission

from app.modules.notes.schemas import NoteWrite, TaskWrite, TaskStatus

router = APIRouter(tags=["notes"])
Doctor = Depends(require_role([UserRole.doctor]))


def note_read(note: DoctorNote) -> dict:
    return {"id": note.id, "patient_id": note.patient_id, "doctor_id": note.doctor_id, "text": note.text,
            "source_type": note.source_type, "source_id": note.source_id, "created_at": note.created_at}


def task_read(task: DoctorTask) -> dict:
    return {"id": task.id, "patient_id": task.patient_id, "doctor_id": task.doctor_id, "title": task.title,
            "status": task.status, "due_at": task.due_at, "created_at": task.created_at, "completed_at": task.completed_at}


@router.get("/patients/{patient_id}/notes")
async def notes(patient_id: int, session: CompassSession, doctor: User = Doctor) -> list[dict]:
    await patient_for_user(session, doctor, patient_id)
    return [note_read(n) for n in (await session.scalars(select(DoctorNote).where(DoctorNote.patient_id == patient_id)
                                                        .order_by(DoctorNote.created_at.desc(), DoctorNote.id.desc()))).all()]


@router.post("/patients/{patient_id}/notes", status_code=201)
async def add_note(patient_id: int, payload: NoteWrite, session: CompassSession, doctor: User = Doctor) -> dict:
    await patient_for_user(session, doctor, patient_id)
    if payload.source_id is not None:
        model = {"message": Message, "assessment": QuestionnaireResponse, "survey_submission": SurveySubmission,
                 "adherence_report": AdherenceReport, "alert": Alert}[payload.source_type]
        source = await session.get(model, payload.source_id)
        if source is None or source.patient_id != patient_id:
            raise HTTPException(404, "Источник не найден в карточке пациента")
    note = DoctorNote(patient_id=patient_id, doctor_id=doctor.id, **payload.model_dump())
    session.add(note)
    await session.flush()
    record_event(session, doctor.id, patient_id, "doctor.note_created", "doctor_note", note.id)
    await session.commit()
    return note_read(note)


@router.get("/patients/{patient_id}/tasks")
async def tasks(patient_id: int, session: CompassSession, doctor: User = Doctor) -> list[dict]:
    await patient_for_user(session, doctor, patient_id)
    return [task_read(t) for t in (await session.scalars(select(DoctorTask).where(DoctorTask.patient_id == patient_id)
                                                        .order_by(DoctorTask.created_at.desc(), DoctorTask.id.desc()))).all()]


@router.post("/patients/{patient_id}/tasks", status_code=201)
async def add_task(patient_id: int, payload: TaskWrite, session: CompassSession, doctor: User = Doctor) -> dict:
    await patient_for_user(session, doctor, patient_id)
    task = DoctorTask(patient_id=patient_id, doctor_id=doctor.id, **payload.model_dump())
    session.add(task)
    await session.flush()
    record_event(session, doctor.id, patient_id, "doctor.task_created", "doctor_task", task.id)
    await session.commit()
    return task_read(task)


@router.patch("/tasks/{task_id}")
async def update_task(task_id: int, payload: TaskStatus, session: CompassSession, doctor: User = Doctor) -> dict:
    task = await session.scalar(select(DoctorTask).join(Patient, Patient.id == DoctorTask.patient_id).where(
        DoctorTask.id == task_id, Patient.doctor_id == doctor.id).with_for_update(of=DoctorTask))
    if task is None:
        raise HTTPException(404, "Задача не найдена или недоступна")
    if task.status != payload.status:
        task.status = payload.status
        task.completed_at = datetime.now(timezone.utc) if task.status == "done" else None
        record_event(session, doctor.id, task.patient_id, "doctor.task_updated", "doctor_task", task.id, {"status": task.status})
    await session.commit()
    return task_read(task)
