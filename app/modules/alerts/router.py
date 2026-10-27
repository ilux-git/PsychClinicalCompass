from datetime import datetime, timezone
from hashlib import sha256
import json
from collections import defaultdict
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, case, func, or_, select, text
from sqlalchemy.dialects.postgresql import insert

from app.api.deps import CompassSession, CurrentUser, patient_for_user, require_role
from app.modules.access.models import User, UserRole
from app.modules.alerts.models import Alert, AlertHandling, AlertPresentation, ClinicalDecision
from app.modules.alerts.clinical_review import completed_action_times, review_timing
from app.modules.assessments.models import OutboxEvent
from app.modules.audit.service import record_event
from app.modules.patients.models import Patient
from app.modules.messaging.models import Message
from app.modules.messaging.service import send_message
from app.modules.notes.router import create_task
from app.modules.notes.schemas import TaskWrite
from app.modules.notes.models import DoctorTask

from app.modules.alerts.schemas import AlertActionWrite, DecisionWrite

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
                priority: Literal["all", "urgent"] = "all",
                limit: int = Query(default=20, ge=1, le=100)) -> dict:
    presentation = and_(AlertPresentation.alert_id == Alert.id, AlertPresentation.doctor_id == doctor.id)
    urgency = case((Alert.severity == "critical_review", 0), (Alert.severity == "urgent_review", 1), else_=2)
    urgent_severities = ("critical_review", "urgent_review")
    scope = (Patient.doctor_id == doctor.id, Alert.status != "closed")
    counts = (await session.execute(select(
        func.count(Alert.id), func.count(Alert.id).filter(AlertPresentation.id.is_(None)),
        func.count(Alert.id).filter(Alert.severity.in_(urgent_severities))
    ).join(Patient, Patient.id == Alert.patient_id).outerjoin(AlertPresentation, presentation).where(*scope))).one()
    query = select(Alert, Patient, OutboxEvent.created_at, AlertPresentation.presented_at).join(
        Patient, Patient.id == Alert.patient_id).join(OutboxEvent, OutboxEvent.id == Alert.source_event_id).outerjoin(
        AlertPresentation, presentation).where(*scope)
    if before_id is not None:
        cursor = (await session.execute(select(Alert.id, urgency).join(Patient, Patient.id == Alert.patient_id).where(
            Alert.id == before_id, Patient.doctor_id == doctor.id))).first()
        if cursor is None:
            raise HTTPException(400, "Курсор очереди недоступен. Обновите список")
        query = query.where(or_(urgency > cursor[1], and_(urgency == cursor[1], Alert.id < before_id)))
    if priority == "urgent":
        query = query.where(Alert.severity.in_(urgent_severities))
    rows = (await session.execute(query.order_by(urgency, Alert.id.desc()).limit(limit + 1))).all()
    action_times = await completed_action_times(session, [a.id for a, _, _, _ in rows[:limit] if a.clinical_result_id or a.scenario_episode_id])
    as_of = datetime.now(timezone.utc)
    items = [{"id": a.id, "patient_id": p.id, "patient_name": p.full_name, "reason": a.reason,
              "severity": a.severity, "status": a.status, "rule_id": a.rule_id, "rule_version": a.rule_version,
              "source_kind": a.source_kind,
              "event_created_at": event_at, "created_at": a.created_at, "presented_at": presented_at,
              "acknowledged_at": a.acknowledged_at,
              "review_timing": review_timing(a, action_times.get(a.id), as_of),
              "latency_seconds": {"event_to_alert": elapsed_seconds(event_at, a.created_at),
                                  "event_to_presentation": elapsed_seconds(event_at, presented_at),
                                  "event_to_acknowledgement": elapsed_seconds(event_at, a.acknowledged_at)}}
             for a, p, event_at, presented_at in rows[:limit]]
    return {"total_open": counts[0], "not_presented": counts[1], "items": items,
            "urgent_open": counts[2], "selected_priority": priority,
            "next_before_id": items[-1]["id"] if len(rows) > limit else None,
            "delivery_channel": "in_app", "external_delivery_performed": False}


@router.get("/alerts")
async def alerts(session: CompassSession, doctor: User = Doctor, patient_id: int | None = None) -> list[dict]:
    query = select(Alert, Patient, ClinicalDecision, Message).join(Patient, Patient.id == Alert.patient_id).outerjoin(
        ClinicalDecision, ClinicalDecision.alert_id == Alert.id).outerjoin(
        Message, Message.id == Alert.message_id).where(Patient.doctor_id == doctor.id)
    if patient_id is not None:
        await patient_for_user(session, doctor, patient_id)
        query = query.where(Patient.id == patient_id)
    rows = (await session.execute(query.order_by(Alert.created_at.desc(), Alert.id.desc()))).all()
    action_times = await completed_action_times(session, [a.id for a, _, _, _ in rows if a.clinical_result_id or a.scenario_episode_id])
    as_of = datetime.now(timezone.utc)
    actions = defaultdict(list)
    for handling, task in (await session.execute(select(AlertHandling, DoctorTask).join(
        DoctorTask, DoctorTask.id == AlertHandling.task_id).where(
        AlertHandling.alert_id.in_([a.id for a, _, _, _ in rows])).order_by(AlertHandling.id))).all():
        actions[handling.alert_id].append({"task_id": task.id, "title": task.title, "status": task.status,
                                          "reply_message_id": handling.reply_message_id, "created_at": handling.created_at})
    return [{"id": a.id, "patient_id": p.id, "patient_name": p.full_name, "rule_id": a.rule_id,
             "rule_version": a.rule_version, "severity": a.severity, "reason": a.reason, "status": a.status,
             "source_kind": a.source_kind, "source_message": {"id": m.id, "text": m.text, "created_at": m.created_at} if m else None,
             "actions": actions[a.id],
             "acknowledged_at": a.acknowledged_at, "closed_at": a.closed_at, "created_at": a.created_at,
             "review_timing": review_timing(a, action_times.get(a.id), as_of),
             "decision": decision_read(d) if d else None} for a, p, d, m in rows]


@router.get("/patients/{patient_id}/support-requests")
async def support_requests(patient_id: int, session: CompassSession, user: CurrentUser,
                           limit: int = Query(default=20, ge=1, le=100)) -> list[dict]:
    await patient_for_user(session, user, patient_id)
    rows = (await session.execute(select(Message, Alert).outerjoin(Alert, Alert.message_id == Message.id).where(
        Message.patient_id == patient_id, Message.support_requested.is_(True)
    ).order_by(Message.id.desc()).limit(limit))).all()
    return [{"message_id": message.id, "text": message.text, "created_at": message.created_at,
             "status": alert.status if alert else "queued", "acknowledged_at": alert.acknowledged_at if alert else None,
             "external_delivery_performed": False} for message, alert in rows]


@router.post("/alerts/{alert_id}/actions", status_code=201)
async def handle_alert(alert_id: int, payload: AlertActionWrite, session: CompassSession, doctor: User = Doctor):
    alert = await owned_alert(session, doctor, alert_id)
    # Same lock as task creation: a request key cannot produce two commands,
    # including simultaneous requests referring to different alerts.
    await session.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": 847000 + doctor.id})
    fingerprint = sha256(json.dumps({"alert_id": alert_id, **payload.model_dump(mode="json")},
                                    sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    previous = await session.scalar(select(AlertHandling).where(
        AlertHandling.doctor_id == doctor.id, AlertHandling.client_request_id == str(payload.client_request_id)))
    if previous:
        if previous.request_hash != fingerprint:
            raise HTTPException(409, "Ключ запроса уже использован для другого действия")
        return {"id": previous.id, "alert_id": previous.alert_id, "task_id": previous.task_id,
                "reply_message_id": previous.reply_message_id, "mis_write_performed": False}
    if alert.status == "closed":
        raise HTTPException(409, "Событие уже закрыто; создайте отдельную задачу из карточки")
    task = await create_task(alert.patient_id, TaskWrite(
        title=payload.title, kind=payload.kind, assigned_to_id=payload.assigned_to_id,
        due_at=payload.due_at, follow_up_at=payload.follow_up_at, source_type="alert", source_id=alert.id,
        client_request_id=payload.client_request_id), session, doctor)
    reply = None
    if payload.reply.strip():
        reply = await send_message(session, alert.patient_id, doctor, payload.reply.strip(), payload.reply_channel,
                                   str(payload.client_request_id))
    if alert.status == "created":
        alert.status, alert.acknowledged_by = "acknowledged", doctor.id
        alert.acknowledged_at = datetime.now(timezone.utc)
        record_event(session, doctor.id, alert.patient_id, "alert.acknowledged", "alert", alert.id)
    handling = AlertHandling(doctor_id=doctor.id, alert_id=alert.id, client_request_id=str(payload.client_request_id),
                             request_hash=fingerprint, task_id=task.id, reply_message_id=reply.id if reply else None)
    session.add(handling)
    await session.flush()
    record_event(session, doctor.id, alert.patient_id, "alert.action_planned", "alert_handling", handling.id,
                 {"alert_id": alert.id, "task_id": task.id, "reply_message_id": handling.reply_message_id})
    await session.commit()
    return {"id": handling.id, "alert_id": alert.id, "task_id": task.id,
            "reply_message_id": handling.reply_message_id, "mis_write_performed": False}


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
    if (row.clinical_result_id or row.scenario_episode_id) and row.status != "closed" and row.id not in await completed_action_times(session, [row.id]):
        raise HTTPException(409, "Сначала зафиксируйте выполненное клиническое действие в связанной задаче. Принятие уведомления не завершает работу с пациентом")
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
    if row.facts.get("source")=="clinical_scenario" and not payload.reason.strip():
        raise HTTPException(422,"Одобрите исходную гипотезу или сохраните исправленный вывод врача")
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
