from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import bindparam, select, true

from app.api.deps import CompassSession, patient_for_user, require_role
from app.modules.access.models import User, UserRole
from app.modules.audit.service import record_event
from app.modules.care.models import TreatmentStatusChange
from app.modules.care.schemas import PatientCareProgress, TreatmentWrite
from app.modules.care.categories import REFUSAL_CATEGORIES
from app.modules.integration.synthetic import linked_snapshot, mapped_snapshot
from app.modules.patients.models import Patient, PatientMapping

router = APIRouter(tags=["care"])
Doctor = Depends(require_role([UserRole.doctor]))
_LATEST_TREATMENT = select(TreatmentStatusChange.status, TreatmentStatusChange.created_at).where(
    TreatmentStatusChange.patient_id == Patient.id).order_by(TreatmentStatusChange.id.desc()).limit(1).correlate(Patient).lateral("latest_treatment")
_CARE_PROGRESS = select(Patient.mis_id, PatientMapping.mis_id.label("mapped_mis_id"),
    _LATEST_TREATMENT.c.status, _LATEST_TREATMENT.c.created_at).select_from(Patient).outerjoin(
    PatientMapping, PatientMapping.compass_patient_id == Patient.id).outerjoin(
    _LATEST_TREATMENT, true()).where(Patient.user_id == bindparam("scope_user_id"))


def visit_progress(source: dict, now: datetime) -> dict:
    """Only explicit visit facts; a missing/past scheduled time is not attendance."""
    def timestamp(value):
        if not isinstance(value, str):
            return None
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
        return parsed if parsed.tzinfo is not None else None

    data = source.get("data")
    available = source.get("status") == "available" and isinstance(data, dict) and isinstance(data.get("visits"), list)
    visits = data["visits"] if available else []
    completed, scheduled = [], []
    undated = False
    for visit in visits:
        if visit.get("status") == "attended":
            at = timestamp(visit.get("occurred_at"))
            if at is not None and at <= now:
                completed.append(at)
            else:
                undated = True
        elif visit.get("status") == "scheduled":
            at = timestamp(visit.get("scheduled_at"))
            if at is None:
                undated = True
            elif at > now:
                scheduled.append(at)
    return {"status": source.get("status", "unavailable") if available or source.get("status") != "available" else "unavailable", "source": source.get("source", "synthetic_mis_json"),
            "synthetic": source.get("synthetic", True), "source_as_of": source.get("as_of"),
            "known_completed_count": len(completed) if available else None,
            "latest_completed_at": max(completed) if completed else None,
            "next_scheduled_at": min(scheduled) if scheduled else None,
            "has_undated_visits": undated}


@router.get("/participation/care-progress", response_model=PatientCareProgress)
async def patient_care_progress(session: CompassSession,
                                user: User = Depends(require_role([UserRole.patient]))):
    row = (await session.execute(_CARE_PROGRESS, {"scope_user_id": user.id})).one_or_none()
    if row is None:
        raise HTTPException(403, "Учётная запись не связана с пациентом")
    now = datetime.now(timezone.utc)
    return {"as_of": now,
            "treatment": {"status": row.status if row.status is not None else "unknown", "recorded_at": row.created_at},
            "visits": visit_progress(mapped_snapshot(row.mis_id, row.mapped_mis_id), now)}


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
