from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, StrictInt
from sqlalchemy import func, select, text

from app.api.deps import CompassSession, require_role
from app.modules.access.models import User, UserRole
from app.modules.alerts.escalation import notice_state
from app.modules.alerts.escalation_models import CoordinatorNotice, DoctorEscalationRoute
from app.modules.alerts.models import Alert
from app.modules.audit.service import record_event
from app.modules.patients.models import Patient

router = APIRouter(tags=["coordination"])
Doctor = Depends(require_role([UserRole.doctor]))
Coordinator = Depends(require_role([UserRole.coordinator]))


class RouteWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")
    coordinator_id: StrictInt | None = Field(gt=0)
    expected_revision: StrictInt = Field(ge=0)


def route_read(row: DoctorEscalationRoute | None) -> dict:
    return {"coordinator_id": row.coordinator_id if row else None,
            "revision": row.revision if row else 0, "updated_at": row.updated_at if row else None}


@router.get("/doctors/me/escalation-route")
async def get_route(session: CompassSession, doctor: User = Doctor) -> dict:
    row = await session.get(DoctorEscalationRoute, doctor.id)
    options = (await session.scalars(select(User).where(User.role == UserRole.coordinator).order_by(User.id))).all()
    waiting = await session.scalar(select(func.count(Alert.id)).join(Patient, Patient.id == Alert.patient_id).where(
        Patient.doctor_id == doctor.id, Alert.source_kind == "clinical_assessment", Alert.severity == "urgent_review",
        Alert.status == "created", Alert.acknowledged_at.is_(None), Alert.acknowledgement_due_at.is_not(None)))
    notices = (await session.execute(select(CoordinatorNotice, Alert).join(Alert, Alert.id == CoordinatorNotice.alert_id).join(
        Patient, Patient.id == Alert.patient_id).where(CoordinatorNotice.doctor_id == doctor.id,
        Patient.doctor_id == doctor.id).order_by(CoordinatorNotice.id.desc()).limit(5))).all()
    return {**route_read(row), "coordinators": [{"id": item.id, "name": item.display_name} for item in options],
            "waiting_urgent": waiting, "recent_notices": [
                {"id": notice.id, "patient_id": notice.patient_id, "coordinator_id": notice.coordinator_id,
                 "created_at": notice.created_at, "acknowledged_at": notice.acknowledged_at,
                 "state": notice_state(notice, alert)} for notice, alert in notices],
            "external_delivery_performed": False}


@router.put("/doctors/me/escalation-route")
async def put_route(payload: RouteWrite, session: CompassSession, doctor: User = Doctor) -> dict:
    await session.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": 912000 + doctor.id})
    row = await session.scalar(select(DoctorEscalationRoute).where(
        DoctorEscalationRoute.doctor_id == doctor.id).with_for_update())
    if payload.coordinator_id is not None:
        recipient = await session.get(User, payload.coordinator_id)
        if recipient is None or recipient.role != UserRole.coordinator:
            raise HTTPException(422, "Выберите координатора из доступного списка")
    if (row.coordinator_id if row else None) == payload.coordinator_id:
        return {**route_read(row), "replayed": True}
    if payload.expected_revision != (row.revision if row else 0):
        raise HTTPException(409, "Резервный маршрут изменён. Обновите данные и сохраните выбор ещё раз")
    now = datetime.now(timezone.utc)
    if row is None:
        row = DoctorEscalationRoute(doctor_id=doctor.id, coordinator_id=payload.coordinator_id, revision=1, updated_at=now)
        session.add(row)
    else:
        row.coordinator_id, row.revision, row.updated_at = payload.coordinator_id, row.revision + 1, now
    record_event(session, doctor.id, None, "coordination.route_changed", "user", doctor.id,
                 {"coordinator_id": payload.coordinator_id, "revision": row.revision})
    await session.commit()
    return {**route_read(row), "replayed": False}


@router.get("/coordination/urgent-notices")
async def notices(session: CompassSession, coordinator: User = Coordinator,
                  before_id: int | None = Query(default=None, gt=0), limit: int = Query(default=20, ge=1, le=100),
                  view: Literal["active", "all"] = "active") -> dict:
    base = select(CoordinatorNotice, Alert, User.display_name).join(Alert, Alert.id == CoordinatorNotice.alert_id).join(
        User, User.id == CoordinatorNotice.doctor_id).where(CoordinatorNotice.coordinator_id == coordinator.id)
    if view == "active":
        base = base.where(Alert.status == "created", Alert.acknowledged_at.is_(None))
    if before_id is not None:
        base = base.where(CoordinatorNotice.id < before_id)
    rows = (await session.execute(base.order_by(CoordinatorNotice.id.desc()).limit(limit + 1))).all()
    pending = await session.scalar(select(func.count(CoordinatorNotice.id)).join(Alert, Alert.id == CoordinatorNotice.alert_id).where(
        CoordinatorNotice.coordinator_id == coordinator.id, CoordinatorNotice.acknowledged_at.is_(None),
        Alert.status == "created", Alert.acknowledged_at.is_(None)))
    active = await session.scalar(select(func.count(CoordinatorNotice.id)).join(Alert, Alert.id == CoordinatorNotice.alert_id).where(
        CoordinatorNotice.coordinator_id == coordinator.id, Alert.status == "created", Alert.acknowledged_at.is_(None)))
    # An allowlist, not a redacted clinical DTO: no reason text, source answers,
    # patient name, score, diagnosis, clinical alert URL or private observation.
    return {"pending": pending, "active": active, "next_before_id": rows[limit - 1][0].id if len(rows) > limit else None,
            "items": [{"id": notice.id, "patient_id": notice.patient_id, "doctor_id": notice.doctor_id,
                       "doctor_name": doctor_name, "reason": notice.reason, "created_at": notice.created_at,
                       "acknowledged_at": notice.acknowledged_at, "state": notice_state(notice, alert),
                       "original_acknowledgement_due_at": alert.acknowledgement_due_at}
                      for notice, alert, doctor_name in rows[:limit]], "external_delivery_performed": False}


@router.post("/coordination/urgent-notices/{notice_id}/acknowledge")
async def acknowledge_notice(notice_id: int, session: CompassSession, coordinator: User = Coordinator) -> dict:
    row = await session.scalar(select(CoordinatorNotice).where(
        CoordinatorNotice.id == notice_id, CoordinatorNotice.coordinator_id == coordinator.id).with_for_update())
    if row is None:
        raise HTTPException(404, "Уведомление не найдено или недоступно")
    if row.acknowledged_at is None:
        row.acknowledged_at = datetime.now(timezone.utc)
        record_event(session, coordinator.id, row.patient_id, "coordination.urgent_acknowledged", "coordinator_notice", row.id)
    await session.commit()
    return {"id": row.id, "acknowledged_at": row.acknowledged_at, "clinical_alert_acknowledged": False}
