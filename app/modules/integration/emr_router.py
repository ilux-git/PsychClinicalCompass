import hmac

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import SQLAlchemyError

from app.api.deps import CompassSession, patient_for_user, require_role
from app.modules.access.models import User, UserRole
from app.modules.audit.service import record_event
from app.modules.integration.emr_models import EmrDemoDocument, EmrDemoReceipt
from app.modules.integration.emr_schemas import EmrApproval, ExactContentConfirmation
from app.modules.integration.emr_service import accept_by_simulator, document_is_current, document_read, task_content
from app.modules.patients.models import Patient

router = APIRouter(tags=["emr-demo"])
Doctor = Depends(require_role([UserRole.doctor]))


async def locked_patient(session, doctor, patient_id):
    patient = await session.scalar(select(Patient).where(Patient.id == patient_id,
        Patient.doctor_id == doctor.id).with_for_update())
    if patient is None:
        raise HTTPException(404, "Пациент не найден или недоступен")
    return patient


@router.get("/patients/{patient_id}/tasks/{task_id}/emr-preview")
async def preview(patient_id: int, task_id: int, session: CompassSession, doctor: User = Doctor):
    patient = await patient_for_user(session, doctor, patient_id)
    task, content, fingerprint = await task_content(session, patient, task_id)
    latest = await session.scalar(select(EmrDemoDocument).where(EmrDemoDocument.patient_id == patient.id,
        EmrDemoDocument.doctor_id == doctor.id, EmrDemoDocument.task_id == task.id).order_by(EmrDemoDocument.id.desc()).limit(1))
    return {"task_id":task.id, "task_revision":task.revision, "patient_name":patient.full_name,
        "content":content, "content_hash":fingerprint,
        "latest_document":await document_read(session, latest, is_current=latest.content_hash == fingerprint) if latest else None}


@router.post("/patients/{patient_id}/emr-documents", status_code=201)
async def approve(patient_id: int, payload: EmrApproval, session: CompassSession, doctor: User = Doctor):
    patient = await locked_patient(session, doctor, patient_id)
    request_id = str(payload.client_request_id)
    existing = await session.scalar(select(EmrDemoDocument).where(
        EmrDemoDocument.doctor_id == doctor.id, EmrDemoDocument.client_request_id == request_id))
    if existing:
        if (existing.patient_id, existing.task_id, existing.task_revision, existing.content_hash) != (
                patient.id, payload.task_id, payload.expected_task_revision, payload.content_hash):
            raise HTTPException(409, "Ключ одобрения уже использован для другого содержимого")
        return await document_read(session, existing,
            is_current=await document_is_current(session, patient, existing), replayed=True)
    task, content, fingerprint = await task_content(session, patient, payload.task_id, lock=True)
    if payload.expected_task_revision != task.revision or not hmac.compare_digest(payload.content_hash, fingerprint):
        raise HTTPException(409, "Сведения изменились. Откройте новый предпросмотр перед одобрением")
    statement = insert(EmrDemoDocument).values(patient_id=patient.id, doctor_id=doctor.id, task_id=task.id,
        task_revision=task.revision, client_request_id=request_id, content_hash=fingerprint, content=content)
    created_id = await session.scalar(statement.on_conflict_do_nothing(
        constraint="uq_emr_demo_approval_request").returning(EmrDemoDocument.id))
    if created_id is None:
        # A conflicting request for another patient may hold a different patient row lock.
        raise HTTPException(409, "Ключ одобрения уже использован для другого содержимого")
    document = await session.get(EmrDemoDocument, created_id)
    record_event(session, doctor.id, patient.id, "emr_demo.approved", "emr_demo_document", document.id,
        {"task_id":task.id, "task_revision":task.revision, "content_hash":fingerprint, "legally_valid_signature":False, "mis_write":False})
    await session.commit()
    return await document_read(session, document)


@router.post("/patients/{patient_id}/emr-documents/{document_id}/simulate-transfer")
async def transfer(patient_id: int, document_id: int, payload: ExactContentConfirmation,
                   session: CompassSession, doctor: User = Doctor):
    patient = await locked_patient(session, doctor, patient_id)
    document = await session.scalar(select(EmrDemoDocument).where(EmrDemoDocument.id == document_id,
        EmrDemoDocument.patient_id == patient.id, EmrDemoDocument.doctor_id == doctor.id).with_for_update())
    if document is None:
        raise HTTPException(404, "Одобренный документ не найден или недоступен")
    if not hmac.compare_digest(document.content_hash, payload.content_hash):
        raise HTTPException(409, "Не совпадает содержимое одобренного документа")
    if await session.scalar(select(EmrDemoReceipt.id).where(EmrDemoReceipt.document_id == document.id)):
        return await document_read(session, document,
            is_current=await document_is_current(session, patient, document), replayed=True)
    _, _, fingerprint = await task_content(session, patient, document.task_id, lock=True)
    if not hmac.compare_digest(document.content_hash, fingerprint):
        raise HTTPException(409, "Сведения изменились после одобрения. Нужен новый предпросмотр и одобрение")
    try:
        receipt = await accept_by_simulator(session, document)
        record_event(session, doctor.id, patient.id, "emr_demo.accepted", "emr_demo_document", document.id,
            {"receipt_id":receipt.id, "content_hash":document.content_hash, "external_delivery":False, "mis_write":False})
        await session.commit()
    except SQLAlchemyError:
        await session.rollback()
        raise HTTPException(503, "Симулятор временно недоступен. Одобрение сохранено, передачу можно повторить") from None
    return await document_read(session, document)
