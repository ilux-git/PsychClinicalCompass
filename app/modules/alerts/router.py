from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, func, select
from sqlalchemy.dialects.postgresql import insert

from app.api.deps import CompassSession, patient_for_user, require_role
from app.modules.access.models import User, UserRole
from app.modules.alerts.models import Alert, AlertPresentation, ClinicalDecision
from app.modules.assessments.models import OutboxEvent
from app.modules.audit.service import record_event
from app.modules.patients.models import Patient

from app.modules.alerts.schemas import DecisionWrite

router = APIRouter(tags=["alerts"])
Doctor = Depends(require_role([UserRole.doctor]))


def elapsed_seconds(start: datetime | None, end: datetime | None) -> float | None:
    if start is None or end is None or end < start:
        return None
    return round((end - start).total_seconds(), 3)


def decision_read(row: ClinicalDecision) -> dict:
    return {"id": row.id, "patient_id": row.patient_id, "alert_id": row.alert_id, "status": row.status,
            "version": row.version, "facts": row.facts, "missing_data": row.missing_data,
            "confirmed_by": row.confirmed_by, "confirmed_at": row.confirmed_at, "reason": row.reason,
            "requires_doctor_approval": True, "mis_write_performed": False}


@router.get("/alerts/inbox")
async def inbox(session: CompassSession, doctor: User = Doctor,
                before_id: int | None = Query(default=None, ge=1),
                limit: int = Query(default=20, ge=1, le=100)) -> dict:
    presentation = and_(AlertPresentation.alert_id == Alert.id, AlertPresentation.doctor_id == doctor.id)
    scope = (Patient.doctor_id == doctor.id, Alert.status != "closed")
    counts = (await session.execute(select(
        func.count(Alert.id), func.count(Alert.id).filter(AlertPresentation.id.is_(None))
    ).join(Patient, Patient.id == Alert.patient_id).outerjoin(AlertPresentation, presentation).where(*scope))).one()
    query = select(Alert, Patient, OutboxEvent.created_at, AlertPresentation.presented_at).join(
        Patient, Patient.id == Alert.patient_id).join(OutboxEvent, OutboxEvent.id == Alert.source_event_id).outerjoin(
        AlertPresentation, presentation).where(*scope)
    if before_id is not None:
        query = query.where(Alert.id < before_id)
    rows = (await session.execute(query.order_by(Alert.id.desc()).limit(limit + 1))).all()
    items = [{"id": a.id, "patient_id": p.id, "patient_name": p.full_name, "reason": a.reason,
              "severity": a.severity, "status": a.status, "rule_id": a.rule_id, "rule_version": a.rule_version,
              "event_created_at": event_at, "created_at": a.created_at, "presented_at": presented_at,
              "acknowledged_at": a.acknowledged_at,
              "latency_seconds": {"event_to_alert": elapsed_seconds(event_at, a.created_at),
                                  "event_to_presentation": elapsed_seconds(event_at, presented_at),
                                  "event_to_acknowledgement": elapsed_seconds(event_at, a.acknowledged_at)}}
             for a, p, event_at, presented_at in rows[:limit]]
    return {"total_open": counts[0], "not_presented": counts[1], "items": items,
            "next_before_id": items[-1]["id"] if len(rows) > limit else None,
            "delivery_channel": "in_app", "external_delivery_performed": False}


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


@router.post("/alerts/{alert_id}/presented")
async def presented(alert_id: int, session: CompassSession, doctor: User = Doctor) -> dict:
    row = await owned_alert(session, doctor, alert_id)
    inserted = await session.scalar(insert(AlertPresentation).values(alert_id=row.id, doctor_id=doctor.id).on_conflict_do_nothing(
        constraint="uq_alert_presentation_doctor").returning(AlertPresentation.id))
    if inserted is not None:
        record_event(session, doctor.id, row.patient_id, "alert.presented", "alert", row.id,
                     {"channel": "in_app", "human_read_confirmed": False})
    receipt = await session.scalar(select(AlertPresentation).where(
        AlertPresentation.alert_id == row.id, AlertPresentation.doctor_id == doctor.id))
    await session.commit()
    return {"alert_id": row.id, "presented_at": receipt.presented_at,
            "channel": "in_app", "human_read_confirmed": False, "external_delivery_performed": False}


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
