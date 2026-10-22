from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select

from app.api.deps import CompassSession, patient_for_user, require_role
from app.modules.access.models import User, UserRole
from app.modules.alerts.models import Alert, ClinicalDecision
from app.modules.audit.service import record_event
from app.modules.patients.models import Patient

from app.modules.alerts.schemas import DecisionWrite

router = APIRouter(tags=["alerts"])
Doctor = Depends(require_role([UserRole.doctor]))


def decision_read(row: ClinicalDecision) -> dict:
    return {"id": row.id, "patient_id": row.patient_id, "alert_id": row.alert_id, "status": row.status,
            "version": row.version, "facts": row.facts, "missing_data": row.missing_data,
            "confirmed_by": row.confirmed_by, "confirmed_at": row.confirmed_at, "reason": row.reason,
            "requires_doctor_approval": True, "mis_write_performed": False}


@router.get("/alerts")
async def alerts(session: CompassSession, doctor: User = Doctor, patient_id: int | None = None) -> list[dict]:
    query = select(Alert, Patient, ClinicalDecision).join(Patient, Patient.id == Alert.patient_id).outerjoin(
        ClinicalDecision, ClinicalDecision.alert_id == Alert.id).where(Patient.doctor_id == doctor.id)
    if patient_id is not None:
        await patient_for_user(session, doctor, patient_id)
        query = query.where(Patient.id == patient_id)
    rows = (await session.execute(query.order_by(Alert.created_at.desc(), Alert.id.desc()))).all()
    return [{"id": a.id, "patient_id": p.id, "patient_name": p.full_name, "rule_id": a.rule_id,
             "rule_version": a.rule_version, "severity": a.severity, "reason": a.reason, "status": a.status,
             "acknowledged_at": a.acknowledged_at, "closed_at": a.closed_at, "created_at": a.created_at,
             "decision": decision_read(d) if d else None} for a, p, d in rows]


async def owned_alert(session: CompassSession, doctor: User, alert_id: int) -> Alert:
    row = await session.scalar(select(Alert).join(Patient, Patient.id == Alert.patient_id).where(
        Alert.id == alert_id, Patient.doctor_id == doctor.id).with_for_update(of=Alert))
    if row is None:
        raise HTTPException(404, "Предупреждение не найдено или недоступно")
    return row


@router.post("/alerts/{alert_id}/acknowledge")
async def acknowledge(alert_id: int, session: CompassSession, doctor: User = Doctor) -> dict:
    row = await owned_alert(session, doctor, alert_id)
    if row.status == "created":
        row.status = "acknowledged"
        row.acknowledged_by = doctor.id
        row.acknowledged_at = datetime.now(timezone.utc)
        record_event(session, doctor.id, row.patient_id, "alert.acknowledged", "alert", row.id)
    await session.commit()
    return {"id": row.id, "status": row.status}


@router.post("/alerts/{alert_id}/close")
async def close(alert_id: int, session: CompassSession, doctor: User = Doctor) -> dict:
    row = await owned_alert(session, doctor, alert_id)
    decision = await session.scalar(select(ClinicalDecision).where(ClinicalDecision.alert_id == row.id))
    if decision is None or decision.status == "pending_review":
        raise HTTPException(409, "Сначала зафиксируйте решение врача")
    if row.status != "closed":
        row.status = "closed"
        row.closed_by = doctor.id
        row.closed_at = datetime.now(timezone.utc)
        record_event(session, doctor.id, row.patient_id, "alert.closed", "alert", row.id)
    await session.commit()
    return {"id": row.id, "status": row.status}


@router.post("/clinical-decisions/{decision_id}/confirm")
async def confirm(decision_id: int, payload: DecisionWrite, session: CompassSession, doctor: User = Doctor) -> dict:
    row = await session.scalar(select(ClinicalDecision).join(Patient, Patient.id == ClinicalDecision.patient_id).where(
        ClinicalDecision.id == decision_id, Patient.doctor_id == doctor.id).with_for_update(of=ClinicalDecision))
    if row is None:
        raise HTTPException(404, "Решение не найдено или недоступно")
    if row.status != "pending_review":
        if row.status == payload.action and row.reason == payload.reason:
            return decision_read(row)
        raise HTTPException(409, "Решение уже зафиксировано")
    if row.version != payload.expected_version:
        raise HTTPException(409, "Решение изменилось; обновите карточку")
    row.status, row.reason = payload.action, payload.reason
    row.confirmed_by, row.confirmed_at = doctor.id, datetime.now(timezone.utc)
    row.version += 1
    record_event(session, doctor.id, row.patient_id, "doctor.decision_recorded", "clinical_decision", row.id,
                 {"status": row.status, "version": row.version})
    await session.commit()
    return decision_read(row)
