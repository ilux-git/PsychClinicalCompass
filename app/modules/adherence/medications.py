from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import bindparam, select

from app.modules.adherence.medication_models import MedicationItem
from app.modules.integration.synthetic import mapped_snapshot
from app.modules.patients.models import Patient, PatientMapping
from app.core.clinic_time import CLINIC_ZONE, clinic_day_bounds

_INVENTORY = select(MedicationItem, PatientMapping.mis_id).select_from(Patient).outerjoin(
    PatientMapping, PatientMapping.compass_patient_id == Patient.id).outerjoin(
    MedicationItem, MedicationItem.patient_id == Patient.id).where(Patient.id == bindparam("inventory_patient_id")).order_by(MedicationItem.id)


def item_read(row: MedicationItem):
    return {"key": f"local:{row.id}", "id": row.id, "label": row.label, "instructions": row.instructions,
            "schedule_text": row.schedule_text, "schedule_kind": row.schedule_kind,
            "times": row.times, "weekdays": row.weekdays, "timezone": row.timezone,
            "starts_on": row.starts_on.isoformat(), "ends_on": row.ends_on.isoformat() if row.ends_on else None,
            "active": row.active, "revision": row.revision, "source": "patient_entered",
            "is_prescription": False, "editable": True, "created_by_id": row.created_by_id}


async def inventory(session, patient):
    rows = (await session.execute(_INVENTORY, {"inventory_patient_id": patient.id})).all()
    source = mapped_snapshot(patient.mis_id, rows[0][1] if rows else None)
    return inventory_from(source, [item for item, _ in rows if item is not None]), source


def inventory_from(source, local_rows):
    """Same source interpretation for individual screens and batched clinic metrics."""
    items = []
    for row in (source["data"] or {}).get("medications", []):
        items.append({"key": f"mis:{row['id']}", "label": row["label"], "instructions": row["instructions"],
            "schedule_text": row["schedule_text"], "schedule_kind": "fixed", "times": row["times"],
            "weekdays": row["days"], "timezone": row["timezone"], "starts_on": row.get("starts_on"),
            "ends_on": row.get("ends_on"), "active": True, "revision": row["version"],
            "source": "synthetic_mis_json", "is_prescription": True, "editable": False})
    return [*items, *[item_read(r) for r in local_rows]]


def occurrences(item, day: date):
    if not item["active"] or item["schedule_kind"] != "fixed" or day.weekday() not in item["weekdays"]:
        return []
    # Unknown start is not invented; the source can be displayed without manufacturing a denominator.
    if not item.get("starts_on") or day < date.fromisoformat(item["starts_on"]):
        return []
    if item.get("ends_on") and day > date.fromisoformat(item["ends_on"]):
        return []
    result = []
    zone = ZoneInfo(item["timezone"])
    for clock in item["times"]:
        naive = datetime.combine(day, time.fromisoformat(clock))
        candidates = [naive.replace(tzinfo=zone, fold=f) for f in (0, 1)]
        valid = [c for c in candidates if c.astimezone(timezone.utc).astimezone(zone).replace(tzinfo=None) == naive]
        instants = {c.astimezone(timezone.utc) for c in valid}
        instant = next(iter(instants)) if len(instants) == 1 else None
        result.append({"occurrence_key": f"{day.isoformat()}@{clock}/v{item['revision']}",
            "item_key": item["key"], "scheduled_for": instant, "clock": clock,
            "status": "unknown", "requires_time_confirmation": instant is None, "report": None})
    return result


def clinic_occurrences(item, day: date):
    """Display a clinic day while preserving the source schedule and report keys."""
    start, end = clinic_day_bounds(day)
    source_zone = ZoneInfo(item["timezone"])
    source_day = start.astimezone(source_zone).date()
    last_day = (end - timedelta(microseconds=1)).astimezone(source_zone).date()
    result = []
    while source_day <= last_day:
        for event in occurrences(item, source_day):
            instant = event["scheduled_for"]
            if instant is not None and not start <= instant < end:
                continue
            if instant is None and source_day != day:
                continue
            result.append({**event, "source_day": source_day.isoformat(), "source_clock": event["clock"],
                "source_timezone": item["timezone"],
                "clock": instant.astimezone(CLINIC_ZONE).strftime("%H:%M") if instant is not None else event["clock"]})
        source_day += timedelta(days=1)
    return sorted(result, key=lambda event: event["clock"])


def log_read(row):
    return {"id": row.id, "item_key": row.item_key, "occurrence_key": row.occurrence_key,
            "status": row.status, "reason": row.reason, "revision": row.revision,
            "scheduled_for": row.scheduled_for.isoformat() if row.scheduled_for else None,
            "created_at": row.created_at.isoformat(), "updated_at": row.updated_at.isoformat(),
            "source": "patient_self_report", "ingestion_verified": False}
