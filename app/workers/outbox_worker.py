import asyncio
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from app.core.config import get_settings
from app.db.session import async_session_compass
from app.modules.assessments.models import OutboxEvent
from app.modules.messaging.models import Message, MessageStatus
from app.modules.alerts.models import Alert, ClinicalDecision
from app.modules.assessments.models import QuestionnaireResponse
from app.modules.alerts.clinical_review import create_clinical_alert
from app.modules.alerts.scenario_review import create_scenario_alert
from app.modules.alerts.escalation import route_due_urgent_alerts
from app.modules.audit.service import record_event
import app.db.models

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("app.outbox_worker")


async def _handle_event(session, event: OutboxEvent) -> None:
    logger.debug("dispatching event id=%s type=%s", event.id, event.event_type)
    if event.event_type == "telegram.send_message":
        message_id = event.payload.get("message_id")
        if type(message_id) is not int:
            raise ValueError("MissingMessageReference")
        message = await session.get(Message, message_id)
        if message is None or message.patient_id != event.payload.get("patient_id") or not message.channel.startswith("tg_"):
            raise ValueError("InvalidMessageReference")
        message.status = MessageStatus.SIMULATED
    elif event.event_type == "clinical.assessment_flagged":
        await create_clinical_alert(session, event)
    elif event.event_type == "clinical.scenario_review_requested":
        await create_scenario_alert(session,event)
    elif event.event_type == "assessment.risk_detected":
        assessment_id = event.payload.get("assessment_id")
        if type(assessment_id) is not int:
            raise ValueError("MissingAssessmentReference")
        assessment = await session.get(QuestionnaireResponse, assessment_id)
        if assessment is None or assessment.patient_id != event.payload.get("patient_id"):
            raise ValueError("InvalidAssessmentReference")
        reason = f"{assessment.form_type.upper()}: {assessment.score}. Требуется врачебная оценка результатов."
        alert = (await session.execute(insert(Alert).values(patient_id=assessment.patient_id, source_event_id=event.id,
            assessment_id=assessment.id, rule_id="assessment_flags", rule_version="backend_v0", severity="review_required",
            reason=reason, status="created").on_conflict_do_nothing(index_elements=[Alert.source_event_id]).returning(Alert))).scalar_one_or_none()
        if alert is None:
            return
        session.add(ClinicalDecision(patient_id=assessment.patient_id, alert_id=alert.id,
            status="pending_review", version=1,
            facts={"assessment_id": assessment.id, "form_type": assessment.form_type, "score": assessment.score,
                   "risk_flags": assessment.risk_flags, "source": "existing_demo_scoring"},
            missing_data=["clinical_review", "approved_clinical_rule_source"]))
        record_event(session, None, assessment.patient_id, "alert.created", "alert", alert.id,
                     {"rule_id": alert.rule_id, "rule_version": alert.rule_version})
    elif event.event_type == "patient.support_requested":
        message_id = event.payload.get("message_id")
        if type(message_id) is not int:
            raise ValueError("MissingSupportReference")
        message = await session.get(Message, message_id)
        if (message is None or message.patient_id != event.payload.get("patient_id")
                or message.sender_role != "patient" or not message.support_requested):
            raise ValueError("InvalidSupportReference")
        alert = (await session.execute(insert(Alert).values(
            patient_id=message.patient_id, source_event_id=event.id, message_id=message.id,
            source_kind="support_request", assessment_id=None, rule_id="patient_explicit_request",
            rule_version="explicit_request_v1", severity="support_requested",
            reason="Пациент явно попросил поддержку по сообщению.", status="created"
        ).on_conflict_do_nothing(index_elements=[Alert.source_event_id]).returning(Alert))).scalar_one_or_none()
        if alert is not None:
            record_event(session, None, message.patient_id, "alert.created", "alert", alert.id,
                         {"source_kind": "support_request", "message_id": message.id})
    else:
        raise ValueError("UnsupportedEventType")


async def process_pending_events() -> int:
    async with async_session_compass() as session:
        result = await session.execute(
            select(OutboxEvent).where(OutboxEvent.status == "pending", OutboxEvent.next_attempt_at <= datetime.now(timezone.utc))
            .order_by(OutboxEvent.id).limit(50).with_for_update(skip_locked=True)
        )
        events = list(result.scalars())
        processed = 0
        for event in events:
            event.attempts += 1
            try:
                async with session.begin_nested():
                    await _handle_event(session, event)
                    await session.flush()
                event.status = "processed"
                event.processed_at = datetime.now(timezone.utc)
                event.last_error = None
                processed += 1
            except Exception as error:
                event.last_error = type(error).__name__
                event.status = "failed" if event.attempts >= get_settings().outbox_max_attempts else "pending"
                event.next_attempt_at = datetime.now(timezone.utc) + timedelta(seconds=min(300, 2 ** min(event.attempts, 8)))
                logger.warning("event id=%s attempt=%s error=%s", event.id, event.attempts, event.last_error)
        try:
            async with session.begin_nested():
                await route_due_urgent_alerts(session)
        except Exception as error:
            # The clinical source is already durable. A failed operational
            # notice is eligible again next pass; it must not roll back other
            # patients' independently processed events or leave half a notice.
            logger.warning("coordinator routing failed error=%s", type(error).__name__)
        await session.commit()
        return processed


async def main() -> None:
    interval = get_settings().outbox_poll_interval_seconds
    logger.info("outbox worker started, poll interval=%ss", interval)
    while True:
        processed = 0
        try:
            processed = await process_pending_events()
            if processed:
                logger.debug("processed %s events", processed)
        except Exception as error:
            logger.error("outbox poll failed error=%s", type(error).__name__)
        # Drain available work before polling again. Sleeping after every full
        # batch limits throughput even when the handler/DB have spare capacity.
        # A zero-delay yield keeps cancellation responsive; failures retain backoff.
        await asyncio.sleep(0 if processed else interval)


if __name__ == "__main__":
    asyncio.run(main())
