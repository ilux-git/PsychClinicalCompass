from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.alerts.models import Alert, AlertHandling, ClinicalDecision
from app.modules.assessments.catalog import GAD7_KEY, PANIC_KEY, PHQ9_KEY
from app.modules.assessments.clinical_models import ClinicalResult
from app.modules.assessments.models import OutboxEvent
from app.modules.assessments.triage import RULE_VERSION
from app.modules.audit.service import record_event
from app.modules.notes.models import DoctorTask


async def create_clinical_alert(session: AsyncSession, event: OutboxEvent) -> None:
    reference = event.payload.get("clinical_result_id")
    if type(reference) is not int:
        raise ValueError("MissingClinicalResultReference")
    row = await session.get(ClinicalResult, reference)
    if row is None or row.patient_id != event.payload.get("patient_id"):
        raise ValueError("InvalidClinicalResultReference")
    triage = row.result.get("triage", {})
    if (row.instrument_key not in {PHQ9_KEY, GAD7_KEY, PANIC_KEY} or
            triage.get("rule_version") != RULE_VERSION or
            triage.get("severity") not in {"urgent_review", "review_required", "needs_clarification"} or
            not triage.get("grounds")):
        raise ValueError("InvalidClinicalReviewSnapshot")
    now = datetime.now(timezone.utc)
    due_hours = triage["action_due_hours"]
    if due_hours not in {None, 16, 48}:
        raise ValueError("UnapprovedClinicalActionDeadline")
    # Acceptance starts with a durable in-app event. The medical action clock
    # starts with the source result, so outbox delays cannot extend its deadline.
    alert = (await session.execute(insert(Alert).values(
        patient_id=row.patient_id, source_event_id=event.id, clinical_result_id=row.id,
        source_kind="clinical_assessment", rule_id="clinical_review", rule_version=RULE_VERSION,
        severity=triage["severity"], status="created", created_at=now,
        acknowledgement_due_at=now + timedelta(hours=2) if triage["severity"] == "urgent_review" else None,
        action_due_at=row.created_at + timedelta(hours=due_hours) if due_hours is not None else None,
        reason=row.definition["name"] + ": " + "; ".join(item["label"] for item in triage["grounds"]),
    ).on_conflict_do_nothing(index_elements=[Alert.source_event_id]).returning(Alert))).scalar_one_or_none()
    if alert is None:
        return
    session.add(ClinicalDecision(patient_id=row.patient_id, alert_id=alert.id, status="pending_review", version=1,
        facts={"clinical_result_id": row.id, "submission_id": row.submission_id,
               "form_type": "phq9" if row.instrument_key == PHQ9_KEY else "gad7" if row.instrument_key == GAD7_KEY else "phq_panic",
               "score": row.score, "risk_flags": [item["code"] for item in triage["grounds"]],
               "instrument_name": row.definition["name"], "instrument_version": row.definition["version"],
               "source_url": row.definition["source_url"], "source_title": row.definition["source_title"],
               "source": "physician_review_workflow", "triage": triage},
        missing_data=["Требуется врачебная оценка", *triage["missing_data"]]))
    record_event(session, None, row.patient_id, "alert.created", "alert", alert.id,
                 {"rule_id": alert.rule_id, "rule_version": alert.rule_version,
                  "clinical_result_id": row.id, "source_kind": alert.source_kind})


async def completed_action_times(session: AsyncSession, alert_ids: list[int]) -> dict[int, datetime]:
    if not alert_ids:
        return {}
    rows = (await session.execute(select(AlertHandling.alert_id, func.min(DoctorTask.completed_at)).join(
        DoctorTask, DoctorTask.id == AlertHandling.task_id).where(
        AlertHandling.alert_id.in_(alert_ids), DoctorTask.kind == "clinical", DoctorTask.status == "done",
        DoctorTask.completed_at.is_not(None), func.length(func.trim(DoctorTask.action_result)) > 0
    ).group_by(AlertHandling.alert_id))).all()
    return dict(rows)


def review_timing(alert: Alert, action_completed_at: datetime | None, now: datetime) -> dict:
    acknowledgement = None
    if alert.acknowledgement_due_at is not None:
        acknowledgement = ("late" if alert.acknowledged_at > alert.acknowledgement_due_at else "accepted") if alert.acknowledged_at else (
            "overdue" if now > alert.acknowledgement_due_at and alert.status != "closed" else "pending")
    return {"acknowledgement_due_at": alert.acknowledgement_due_at,
            "acknowledgement_state": acknowledgement, "action_due_at": alert.action_due_at,
            "action_completed_at": action_completed_at,
            "action_overdue": bool(alert.action_due_at and action_completed_at is None and
                                   alert.status != "closed" and now > alert.action_due_at), "as_of": now}
