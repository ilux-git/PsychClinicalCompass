from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select

from app.api.deps import CompassSession, patient_for_user, require_role
from app.modules.access.models import User, UserRole
from app.modules.audit.service import record_event
from app.modules.care.models import TreatmentStatusChange
from app.modules.care.schemas import TreatmentWrite
from app.modules.care.categories import REFUSAL_CATEGORIES
from app.modules.integration.synthetic import linked_snapshot
from app.modules.patients.models import Patient

router = APIRouter(tags=["care"])
Doctor = Depends(require_role([UserRole.doctor]))


def status_read(row):
    if row is None:
        return {"status": "unknown", "revision": 0, "source": None}
    return {"status": row.status, "revision": row.id, "doctor_id": row.doctor_id,
            "reason": row.reason, "reason_category":row.reason_category, "created_at": row.created_at, "source": row.source}


@router.get("/patients/{patient_id}/care")
async def care(patient_id: int, session: CompassSession, doctor: User = Doctor):
    patient = await patient_for_user(session, doctor, patient_id)
    rows = (await session.scalars(select(TreatmentStatusChange).where(
        TreatmentStatusChange.patient_id == patient.id).order_by(TreatmentStatusChange.id.desc()))).all()
    return {"treatment": status_read(rows[0] if rows else None), "history": [status_read(r) for r in rows],
            "refusal_categories":[{"code":code,"label":label} for code,label in REFUSAL_CATEGORIES.items()],
            "mis": await linked_snapshot(session, patient)}


@router.post("/patients/{patient_id}/treatment-status", status_code=201)
async def change_status(patient_id: int, payload: TreatmentWrite, session: CompassSession, doctor: User = Doctor):
    # Lock the patient, including the first change where there is no status row to lock yet.
    patient = await session.scalar(select(Patient).where(Patient.id == patient_id, Patient.doctor_id == doctor.id).with_for_update())
    if patient is None:
        raise HTTPException(404, "Пациент не найден или недоступен")
    previous = await session.scalar(select(TreatmentStatusChange).where(
        TreatmentStatusChange.patient_id == patient_id,
        TreatmentStatusChange.client_request_id == str(payload.client_request_id)))
    if previous:
        if previous.status != payload.status or previous.reason != payload.reason.strip() or previous.reason_category != payload.reason_category:
            raise HTTPException(409, "Ключ запроса уже использован с другим исходом")
        return {**status_read(previous), "replayed": True}
    latest = await session.scalar(select(TreatmentStatusChange).where(
        TreatmentStatusChange.patient_id == patient_id).order_by(TreatmentStatusChange.id.desc()).limit(1))
    if payload.expected_revision != (latest.id if latest else 0):
        raise HTTPException(409, "Исход уже изменён: обновите карточку")
    row = TreatmentStatusChange(patient_id=patient_id, doctor_id=doctor.id,
        client_request_id=str(payload.client_request_id), status=payload.status, reason=payload.reason.strip(), reason_category=payload.reason_category)
    session.add(row)
    await session.flush()
    record_event(session, doctor.id, patient_id, "treatment.status_changed", "treatment_status", row.id,
                 {"status": row.status, "reason_category":row.reason_category,
                  "previous_revision": latest.id if latest else 0, "mis_write": False})
    await session.commit()
    return {**status_read(row), "replayed": False}
