from collections import Counter, defaultdict
from datetime import datetime, timezone
from statistics import median

from sqlalchemy import select

from app.modules.adherence.medication_models import MedicationItem, MedicationLog
from app.modules.adherence.medications import inventory_from, occurrences
from app.modules.care.models import TreatmentStatusChange
from app.modules.care.categories import REFUSAL_CATEGORIES
from app.modules.integration.synthetic import patient_snapshot, snapshot
from app.modules.notes.models import DoctorTask
from app.modules.surveys.models import SurveyAssignment, SurveySubmission
from app.modules.patients.models import PatientMapping
from app.modules.messaging.models import Message
from app.modules.alerts.models import Alert, AlertHandling


def instant(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def fraction(n, d):
    return {"numerator": n, "denominator": d, "percent": round(100*n/d, 1) if d else None}


async def workflow_metrics(session, patients, *, assignment_rows=None):
    ids = [p.id for p in patients]
    now = datetime.now(timezone.utc)
    source_as_of = instant(snapshot().as_of)
    groups = defaultdict(set)
    latest = {}; refusal_reasons = Counter()
    for row in (await session.execute(select(TreatmentStatusChange.patient_id, TreatmentStatusChange.status,
        TreatmentStatusChange.reason_category).where(
        TreatmentStatusChange.patient_id.in_(ids)).order_by(TreatmentStatusChange.id.desc()))).all():
        latest.setdefault(row.patient_id, row)
    statuses = Counter()
    for p in patients:
        decision = latest.get(p.id)
        status = decision.status if decision else "unknown"
        statuses[status] += 1; groups[f"status:{status}"].add(p.id)
        if status == "refused":
            category = decision.reason_category or "unknown"
            refusal_reasons[category] += 1
            groups[f"refusal_reason:{category}"].add(p.id)

    assignments = assignment_rows if assignment_rows is not None else (await session.execute(
        select(SurveyAssignment, SurveySubmission).outerjoin(SurveySubmission,
        SurveySubmission.assignment_id == SurveyAssignment.id).where(SurveyAssignment.patient_id.in_(ids)))).all()
    mature = [(a,r) for a,r in assignments if a.due_at and a.due_at <= now]
    timely = [(a,r) for a,r in mature if r is not None and r.created_at <= a.due_at]
    groups["survey_mature"] = {a.patient_id for a,_ in mature}
    groups["survey_timely"] = {a.patient_id for a,_ in timely}
    groups["survey_without_due"] = {a.patient_id for a,_ in assignments if a.due_at is None}

    tasks = (await session.execute(select(DoctorTask.patient_id, DoctorTask.status, DoctorTask.verification_status,
        DoctorTask.follow_up_at, DoctorTask.source_type).where(DoctorTask.patient_id.in_(ids)))).all()
    task_counts = Counter(t.status for t in tasks)
    verifications = Counter(t.verification_status for t in tasks)
    followups = [t for t in tasks if t.follow_up_at and t.follow_up_at <= now]
    checked = [t for t in followups if t.verification_status != "pending"]
    for t in tasks:
        groups[f"task:{t.status}"].add(t.patient_id)
        groups[f"verified:{t.verification_status}"].add(t.patient_id)
        if t.status == "done":
            groups["task_awaiting_check" if t.verification_status == "pending" else "task_checked"].add(t.patient_id)
        if t.source_type != "manual": groups["task_linked"].add(t.patient_id)
        if t.follow_up_at is None: groups["task_no_followup"].add(t.patient_id)
    groups["followup_due"] = {t.patient_id for t in followups}
    groups["followup_checked"] = {t.patient_id for t in checked}

    # Aggregates need timestamps and linkage, never message text or private task comments.
    support_rows = (await session.execute(select(Message.patient_id, Message.created_at.label("message_created_at"),
        Alert.id.label("alert_id"), Alert.acknowledged_at).outerjoin(
        Alert, Alert.message_id == Message.id).where(Message.patient_id.in_(ids), Message.support_requested.is_(True)))).all()
    support_alert_ids = [row.alert_id for row in support_rows if row.alert_id is not None]
    planned, replies = set(), {}
    for alert_id, reply_at in (await session.execute(select(AlertHandling.alert_id, Message.created_at).outerjoin(
        Message, Message.id == AlertHandling.reply_message_id).where(AlertHandling.alert_id.in_(support_alert_ids)))).all():
        planned.add(alert_id)
        if reply_at is not None:
            replies[alert_id] = min(replies.get(alert_id, reply_at), reply_at)
    support_counts = Counter(); acknowledgement_times, response_times, waiting = [], [], []
    for row in support_rows:
        groups["support_requests"].add(row.patient_id)
        state = "queued" if row.alert_id is None else "acknowledged" if row.acknowledged_at else "awaiting_review"
        support_counts[state] += 1; groups[f"support:{state}"].add(row.patient_id)
        if row.acknowledged_at and row.acknowledged_at >= row.message_created_at:
            acknowledgement_times.append((row.acknowledged_at-row.message_created_at).total_seconds())
            groups["support_ack_interval"].add(row.patient_id)
        elif not row.acknowledged_at:
            waiting.append(max(0, (now-row.message_created_at).total_seconds()))
            groups["support_waiting_interval"].add(row.patient_id)
        if row.alert_id in planned:
            support_counts["with_task"] += 1; groups["support_with_task"].add(row.patient_id)
        if row.alert_id in replies:
            support_counts["with_linked_reply"] += 1; groups["support_with_reply"].add(row.patient_id)
            if replies[row.alert_id] >= row.message_created_at:
                response_times.append((replies[row.alert_id]-row.message_created_at).total_seconds())
                groups["support_reply_interval"].add(row.patient_id)

    visits = Counter(); observed_windows = 0; met_windows = 0; windows_not_mature = 0; missing_window_data = 0
    due_events = 0; documented_events = 0; medication_states = Counter(); without_mis = 0
    mappings = {m.compass_patient_id: m.mis_id for m in (await session.scalars(
        select(PatientMapping).where(PatientMapping.compass_patient_id.in_(ids)))).all()}
    local_items, all_reports = defaultdict(list), defaultdict(list)
    for item in (await session.scalars(select(MedicationItem).where(MedicationItem.patient_id.in_(ids)))).all():
        local_items[item.patient_id].append(item)
    for report in (await session.scalars(select(MedicationLog).where(MedicationLog.patient_id.in_(ids)))).all():
        all_reports[report.patient_id].append(report)
    for p in patients:
        source = patient_snapshot(p.mis_id if mappings.get(p.id) == p.mis_id else None)
        data = source["data"]
        if data:
            for visit in data.get("visits", []):
                if instant(visit["scheduled_at"]) > source_as_of: continue
                status = visit["status"]
                visits[status] += 1; groups[f"visit:{status}"].add(p.id)
                if status in {"cancelled", "rescheduled"} and visit.get("initiator") == "clinic":
                    visits["clinic_changed"] += 1; groups["visit:clinic_changed"].add(p.id)
            window = data.get("recommended_contact")
            if window:
                start, end = instant(window["start"]), instant(window["end"])
                complete = data.get("visits_complete_through")
                if end > source_as_of:
                    windows_not_mature += 1; groups["window_not_mature"].add(p.id)
                elif not complete or instant(complete) < end:
                    missing_window_data += 1; groups["window_missing_data"].add(p.id)
                else:
                    observed_windows += 1; groups["window_observed"].add(p.id)
                    if any(v["status"] == "attended" and v.get("occurred_at") and start <= instant(v["occurred_at"]) <= end for v in data["visits"]):
                        met_windows += 1; groups["window_met"].add(p.id)
            else:
                missing_window_data += 1; groups["window_missing_data"].add(p.id)
        else:
            without_mis += 1; groups["mis_missing"].add(p.id)
        items = inventory_from(source, local_items[p.id])
        reports = all_reports[p.id]
        for report in reports:
            medication_states[report.status] += 1; groups[f"medication:{report.status}"].add(p.id)
        by_key = {(r.item_key, r.occurrence_key): r for r in reports}
        for item in items:
            # Each regimen uses its declared local day. This is a current-version snapshot, not historic adherence.
            from zoneinfo import ZoneInfo
            day = now.astimezone(ZoneInfo(item["timezone"])).date()
            for event in occurrences(item, day):
                if event["scheduled_for"] is not None and event["scheduled_for"] <= now:
                    due_events += 1; groups["medication_due"].add(p.id)
                    if (item["key"], event["occurrence_key"]) in by_key:
                        documented_events += 1; groups["medication_documented"].add(p.id)
    value = {"as_of": now, "mis_snapshot_as_of": source_as_of,
        "treatment": {"in_progress": statuses["in_progress"], "completed": statuses["completed"],
                      "refused": statuses["refused"], "unknown": statuses["unknown"], "source": "doctor_decision"},
        "refusal_reasons":{"patients":statuses["refused"], "with_specific_reason":sum(n for code,n in refusal_reasons.items() if code not in {"unknown","not_disclosed"}),
            "categories":[{"code":code,"label":label,"patients":refusal_reasons[code]} for code,label in REFUSAL_CATEGORIES.items()],
            "source":"current_doctor_coded_reported_reason", "inferred_from_nonresponse":False},
        "survey_on_time": {**fraction(len(timely), len(mature)), "without_due": sum(a.due_at is None for a,_ in assignments)},
        "tasks": {"total": len(tasks), "open": task_counts["open"], "in_progress": task_counts["in_progress"], "action_done": task_counts["done"],
                  "with_source": sum(t.source_type != "manual" for t in tasks), "verification": dict(verifications),
                  "without_followup_date": sum(t.follow_up_at is None for t in tasks),
                  "recheck_coverage": fraction(len(checked), len(followups))},
        "visits": {"attended": visits["attended"], "no_show": visits["no_show"], "cancelled": visits["cancelled"],
                   "rescheduled": visits["rescheduled"], "clinic_changed": visits["clinic_changed"],
                   "source_missing_patients": without_mis, "no_show_fraction": fraction(visits["no_show"], visits["no_show"]+visits["attended"]),
                   "contact_in_window": fraction(met_windows, observed_windows), "windows_not_mature": windows_not_mature,
                   "windows_without_data_or_plan": missing_window_data},
        "support_requests": {"total":len(support_rows), "queued":support_counts["queued"],
            "awaiting_review":support_counts["awaiting_review"], "acknowledged":support_counts["acknowledged"],
            "with_task":support_counts["with_task"], "with_linked_reply":support_counts["with_linked_reply"],
            "acknowledgement_coverage":fraction(support_counts["acknowledged"],len(support_rows)),
            "median_to_acknowledgement_seconds":round(median(acknowledgement_times),3) if acknowledgement_times else None,
            "median_to_linked_reply_seconds":round(median(response_times),3) if response_times else None,
            "oldest_unacknowledged_seconds":round(max(waiting),3) if waiting else None,
            "acknowledgement_intervals":len(acknowledgement_times), "linked_reply_intervals":len(response_times),
            "source":"explicit_patient_control", "external_delivery_performed":False},
        "medication": {"self_reports": sum(medication_states.values()), "statuses": dict(medication_states),
                       "documentation_today": fraction(documented_events, due_events), "ingestion_verified": False,
                       "denominator": "due_events_of_current_regimen_version_on_each_item_local_day"}}
    return value, list(groups.values())
