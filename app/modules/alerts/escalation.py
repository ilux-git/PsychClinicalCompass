from datetime import datetime, timezone

from sqlalchemy import or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.modules.access.models import User, UserRole
from app.modules.alerts.escalation_models import CoordinatorNotice, DoctorEscalationRoute
from app.modules.alerts.models import Alert
from app.modules.audit.service import record_event
from app.modules.patients.models import Patient


async def route_due_urgent_alerts(session: AsyncSession, *, now: datetime | None = None) -> int:
    """Materialize one durable in-app notice per unaccepted urgent clinical event.

    The configured recipient is explicit. Busy is not unavailable. An operational
    receipt never acknowledges a clinical alert or changes its medical deadline.
    Caller owns the transaction, including the notice and its audit entry.
    """
    now = now or datetime.now(timezone.utc)
    recipient = aliased(User)
    rows = (await session.execute(select(Alert, Patient.doctor_id,
        DoctorEscalationRoute.coordinator_id, DoctorEscalationRoute.revision).join(
        Patient, Patient.id == Alert.patient_id).join(User, User.id == Patient.doctor_id).join(
        DoctorEscalationRoute, DoctorEscalationRoute.doctor_id == User.id).join(
        recipient, recipient.id == DoctorEscalationRoute.coordinator_id).outerjoin(
        CoordinatorNotice, CoordinatorNotice.alert_id == Alert.id).where(
        Alert.source_kind == "clinical_assessment", Alert.severity == "urgent_review",
        Alert.status == "created", Alert.acknowledged_at.is_(None),
        Alert.acknowledgement_due_at.is_not(None), CoordinatorNotice.id.is_(None),
        User.role == UserRole.doctor, recipient.role == UserRole.coordinator,
        or_(User.availability.in_(("offline", "on_leave")), Alert.acknowledgement_due_at < now)
    ).order_by(Alert.id).limit(100).with_for_update(of=Alert, skip_locked=True))).all()
    created = 0
    for alert, doctor_id, coordinator_id, revision in rows:
        reason = "acknowledgement_overdue" if alert.acknowledgement_due_at < now else "doctor_unavailable"
        notice_id = await session.scalar(insert(CoordinatorNotice).values(
            alert_id=alert.id, patient_id=alert.patient_id, doctor_id=doctor_id,
            coordinator_id=coordinator_id, route_revision=revision, reason=reason, created_at=now
        ).on_conflict_do_nothing(index_elements=[CoordinatorNotice.alert_id]).returning(CoordinatorNotice.id))
        if notice_id is None:
            continue
        record_event(session, None, alert.patient_id, "coordination.urgent_routed", "coordinator_notice", notice_id,
                     {"alert_id": alert.id, "coordinator_id": coordinator_id, "route_revision": revision,
                      "reason": reason, "external_delivery_performed": False})
        created += 1
    return created


def notice_state(notice: CoordinatorNotice, alert: Alert) -> str:
    if alert.status == "closed":
        return "closed_by_doctor"
    if alert.acknowledged_at is not None:
        return "accepted_by_doctor"
    return "accepted_by_coordinator" if notice.acknowledged_at else "pending"
