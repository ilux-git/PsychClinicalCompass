from collections import Counter, defaultdict
from datetime import datetime, timezone

from sqlalchemy import select

from app.modules.adherence.medication_models import MedicationLog
from app.modules.adherence.medications import inventory, occurrences
from app.modules.care.models import TreatmentStatusChange
from app.modules.integration.synthetic import linked_snapshot, snapshot
from app.modules.notes.models import DoctorTask
from app.modules.surveys.models import SurveyAssignment, SurveySubmission


def instant(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def fraction(n, d):
    return {"numerator": n, "denominator": d, "percent": round(100*n/d, 1) if d else None}


async def workflow_metrics(session, patients):
    ids = [p.id for p in patients]
    now = datetime.now(timezone.utc)
    source_as_of = instant(snapshot().as_of)
    groups = defaultdict(set)
    latest = {}
    for row in (await session.scalars(select(TreatmentStatusChange).where(
        TreatmentStatusChange.patient_id.in_(ids)).order_by(TreatmentStatusChange.id.desc()))).all():
        latest.setdefault(row.patient_id, row.status)
    statuses = Counter()
    for p in patients:
        status = latest.get(p.id, "unknown")
        statuses[status] += 1; groups[f"status:{status}"].add(p.id)

    assignments = (await session.execute(select(SurveyAssignment, SurveySubmission).outerjoin(
        SurveySubmission, SurveySubmission.assignment_id == SurveyAssignment.id).where(
        SurveyAssignment.patient_id.in_(ids)))).all()
    mature = [(a,r) for a,r in assignments if a.due_at and a.due_at <= now]
    timely = [(a,r) for a,r in mature if r is not None and r.created_at <= a.due_at]
    groups["survey_mature"] = {a.patient_id for a,_ in mature}
    groups["survey_timely"] = {a.patient_id for a,_ in timely}
    groups["survey_without_due"] = {a.patient_id for a,_ in assignments if a.due_at is None}

    tasks = (await session.scalars(select(DoctorTask).where(DoctorTask.patient_id.in_(ids)))).all()
    task_counts = Counter(t.status for t in tasks)
    verifications = Counter(t.verification_status for t in tasks)
    followups = [t for t in tasks if t.follow_up_at and t.follow_up_at <= now]
    checked = [t for t in followups if t.verification_status != "pending"]
    for t in tasks:
        groups[f"task:{t.status}"].add(t.patient_id)
        groups[f"verified:{t.verification_status}"].add(t.patient_id)
        if t.source_type != "manual": groups["task_linked"].add(t.patient_id)
        if t.follow_up_at is None: groups["task_no_followup"].add(t.patient_id)
    groups["followup_due"] = {t.patient_id for t in followups}
    groups["followup_checked"] = {t.patient_id for t in checked}

    visits = Counter(); observed_windows = 0; met_windows = 0; windows_not_mature = 0; missing_window_data = 0
    due_events = 0; documented_events = 0; medication_states = Counter(); without_mis = 0
    for p in patients:
        source = await linked_snapshot(session, p)
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
        items, _ = await inventory(session, p)
        reports = (await session.scalars(select(MedicationLog).where(MedicationLog.patient_id == p.id))).all()
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
        "survey_on_time": {**fraction(len(timely), len(mature)), "without_due": sum(a.due_at is None for a,_ in assignments)},
        "tasks": {"total": len(tasks), "open": task_counts["open"], "action_done": task_counts["done"],
                  "with_source": sum(t.source_type != "manual" for t in tasks), "verification": dict(verifications),
                  "without_followup_date": sum(t.follow_up_at is None for t in tasks),
                  "recheck_coverage": fraction(len(checked), len(followups))},
        "visits": {"attended": visits["attended"], "no_show": visits["no_show"], "cancelled": visits["cancelled"],
                   "rescheduled": visits["rescheduled"], "clinic_changed": visits["clinic_changed"],
                   "source_missing_patients": without_mis, "no_show_fraction": fraction(visits["no_show"], visits["no_show"]+visits["attended"]),
                   "contact_in_window": fraction(met_windows, observed_windows), "windows_not_mature": windows_not_mature,
                   "windows_without_data_or_plan": missing_window_data},
        "medication": {"self_reports": sum(medication_states.values()), "statuses": dict(medication_states),
                       "documentation_today": fraction(documented_events, due_events), "ingestion_verified": False,
                       "denominator": "due_events_of_current_regimen_version_on_each_item_local_day"}}
    return value, list(groups.values())
