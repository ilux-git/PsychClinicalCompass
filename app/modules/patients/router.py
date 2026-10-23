from fastapi import APIRouter, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from app.api.deps import CompassSession, CurrentUser, patient_for_user
from app.db.session import async_session_mis
from app.modules.access.models import User, UserRole
from app.modules.assessments.models import QuestionnaireResponse
from app.modules.audit.models import AuditEvent
from app.modules.integration.mis_models import MISPatient
from app.modules.patients.models import Patient, PatientMapping
from app.modules.care.models import TreatmentStatusChange
from app.modules.integration.synthetic import linked_snapshot

router = APIRouter(prefix="/patients", tags=["patients"])


def patient_summary(patient: Patient) -> dict:
    return {"id": patient.id, "full_name": patient.full_name, "mis_id": patient.mis_id,
            "doctor_id": patient.doctor_id, "created_at": patient.created_at}


@router.get("")
async def patients(session: CompassSession, user: CurrentUser) -> list[dict]:
    if user.role not in {UserRole.doctor, UserRole.patient}:
        raise HTTPException(403, "Нет клинического доступа")
    query = select(Patient).order_by(Patient.id)
    query = query.where(Patient.doctor_id == user.id) if user.role == UserRole.doctor else query.where(Patient.user_id == user.id)
    rows = (await session.scalars(query)).all()
    result = [patient_summary(p) for p in rows]
    if user.role == UserRole.doctor:
        latest = {}
        for row in (await session.scalars(select(TreatmentStatusChange).where(
            TreatmentStatusChange.patient_id.in_([p.id for p in rows])).order_by(TreatmentStatusChange.id.desc()))).all():
            latest.setdefault(row.patient_id, row.status)
        for item, patient in zip(result, rows):
            fixture = await linked_snapshot(session, patient)
            item["demo_scenario"] = fixture["data"]["scenario"]["title"] if fixture["data"] else None
            item["treatment_status"] = latest.get(patient.id, "unknown")
    return result


@router.get("/{patient_id}")
async def card(patient_id: int, session: CompassSession, user: CurrentUser) -> dict:
    patient = await patient_for_user(session, user, patient_id)
    mapping = await session.scalar(select(PatientMapping).where(PatientMapping.compass_patient_id == patient.id))
    mis: dict = {"source": "MIS", "status": "not_linked", "diagnoses": [], "prescriptions": []}
    if mapping is not None and mapping.mis_id != patient.mis_id:
        mis["status"] = "mapping_conflict"
    elif mapping is not None:
        try:
            async with async_session_mis() as mis_session:
                source = await mis_session.get(MISPatient, mapping.mis_id)
                mis["status"] = "available" if source else "missing"
                if source:
                    mis.update(full_name=source.full_name, diagnoses=source.diagnoses, prescriptions=source.prescriptions)
        except (SQLAlchemyError, OSError, TimeoutError):
            mis["status"] = "unavailable"
    doctor = await session.get(User, patient.doctor_id)
    return {**patient_summary(patient), "mis": mis,
            "doctor": {"name": doctor.display_name, "availability": doctor.availability} if doctor else None}


@router.get("/{patient_id}/assessments")
async def assessments(patient_id: int, session: CompassSession, user: CurrentUser) -> list[dict]:
    await patient_for_user(session, user, patient_id)
    rows = (await session.scalars(select(QuestionnaireResponse).where(QuestionnaireResponse.patient_id == patient_id)
                                  .order_by(QuestionnaireResponse.created_at, QuestionnaireResponse.id))).all()
    return [{"id": r.id, "form_type": r.form_type, "form_version": r.form_version, "answers": r.answers, "score": r.score,
             "risk_flags": r.risk_flags, "created_at": r.created_at} for r in rows]


@router.get("/{patient_id}/timeline")
async def timeline(patient_id: int, session: CompassSession, user: CurrentUser) -> list[dict]:
    await patient_for_user(session, user, patient_id)
    # Private clinical work is not included in the patient's view.
    if user.role != UserRole.doctor:
        raise HTTPException(403, "История действий доступна врачу")
    events = (await session.scalars(select(AuditEvent).where(AuditEvent.patient_id == patient_id)
                                    .order_by(AuditEvent.created_at.desc(), AuditEvent.id.desc()).limit(100))).all()
    return [{"id": e.id, "event_type": e.event_type, "object_type": e.object_type,
             "object_id": e.object_id, "actor_id": e.actor_id, "created_at": e.created_at} for e in events]
