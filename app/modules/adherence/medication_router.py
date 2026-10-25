from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select

from app.api.deps import CompassSession, CurrentUser, patient_for_user, require_role
from app.modules.access.models import User, UserRole
from app.modules.adherence.medication_models import MedicationItem, MedicationLog
from app.modules.adherence.medication_schemas import MedicationCreate, MedicationEdit, MedicationReport, MedicationReportEdit
from app.modules.adherence.medications import inventory, item_read, log_read, occurrences
from app.modules.audit.service import record_event
from app.modules.patients.models import Patient
from app.modules.adherence.rewards import grant_points, participation_receipt

router = APIRouter(tags=["medication schedule"])
PatientUser = Depends(require_role([UserRole.patient]))


async def own_patient(session, user, lock=False):
    query = select(Patient).where(Patient.user_id == user.id)
    if lock:
        query = query.with_for_update()
    patient = await session.scalar(query)
    if patient is None:
        raise HTTPException(403, "Учётная запись не связана с пациентом")
    return patient


async def medication_response(session, patient_id, data, source_key, replayed):
    receipt = await participation_receipt(session, patient_id, "medication", source_key)
    return {**data, "replayed": replayed, "participation": receipt}


@router.get("/patients/{patient_id}/medications")
async def medication_schedule(patient_id: int, session: CompassSession, user: CurrentUser,
                              on: date | None = Query(default=None)):
    patient = await patient_for_user(session, user, patient_id)
    day = on or datetime.now(timezone.utc).date()
    items, source = await inventory(session, patient)
    logs = (await session.scalars(select(MedicationLog).where(MedicationLog.patient_id == patient.id,
        MedicationLog.occurrence_key.like(day.isoformat() + "@%")).order_by(MedicationLog.id))).all()
    by_key = {(r.item_key, r.occurrence_key): r for r in logs}
    events = []
    for item in items:
        for event in occurrences(item, day):
            report = by_key.get((event["item_key"], event["occurrence_key"]))
            if report:
                event.update(status=report.status, report=log_read(report))
            event["can_report"] = event["scheduled_for"] is not None and event["scheduled_for"] <= datetime.now(timezone.utc)
            events.append(event)
    current_keys = {(e["item_key"], e["occurrence_key"]) for e in events}
    recent = (await session.scalars(select(MedicationLog).where(MedicationLog.patient_id == patient.id)
                                   .order_by(MedicationLog.id.desc()).limit(30))).all()
    return {"day": day, "items": items, "events": events,
            "historical_reports": [log_read(r) for r in logs if (r.item_key, r.occurrence_key) not in current_keys],
            "recent_reports": [log_read(r) for r in recent],
            "source": {k: source[k] for k in ("source", "schema_version", "status", "synthetic", "read_only")},
            "delivery_mode": "in_app_simulation", "unknown_is_not_missed": True}


@router.post("/medications/items", status_code=201)
async def create_item(payload: MedicationCreate, session: CompassSession, user: User = PatientUser):
    patient = await own_patient(session, user, lock=True)
    data = payload.model_dump(mode="json", exclude={"client_request_id"})
    previous = await session.scalar(select(MedicationItem).where(MedicationItem.patient_id == patient.id,
        MedicationItem.client_request_id == str(payload.client_request_id)))
    if previous:
        if previous.initial_payload != data:
            raise HTTPException(409, "Ключ запроса уже использован с другой позицией")
        return await medication_response(session, patient.id, item_read(previous), f"item:{previous.id}:v1", True)
    row = MedicationItem(patient_id=patient.id, created_by_id=user.id,
        client_request_id=str(payload.client_request_id), initial_payload=data,
        **payload.model_dump(exclude={"client_request_id"}))
    session.add(row); await session.flush()
    record_event(session, user.id, patient.id, "medication.item_created", "medication_item", row.id,
                 {"source": "patient_entered", "mis_write": False})
    await grant_points(session, patient.id, "medication", f"item:{row.id}:v1", user.id)
    response = await medication_response(session, patient.id, item_read(row), f"item:{row.id}:v1", False)
    await session.commit()
    return response


@router.put("/medications/items/{item_id}")
async def edit_item(item_id: int, payload: MedicationEdit, session: CompassSession, user: User = PatientUser):
    patient = await own_patient(session, user, lock=True)
    row = await session.scalar(select(MedicationItem).where(MedicationItem.id == item_id,
        MedicationItem.patient_id == patient.id).with_for_update())
    if row is None:
        raise HTTPException(404, "Личная позиция не найдена")
    data = payload.model_dump(exclude={"expected_revision"})
    same = all(getattr(row, k) == v for k, v in data.items())
    if row.revision != payload.expected_revision:
        if same and row.revision == payload.expected_revision + 1:
            return await medication_response(session, patient.id, item_read(row), f"item:{row.id}:v{row.revision}", True)
        raise HTTPException(409, "Расписание уже изменено: обновите список")
    if not same:
        for k, v in data.items():
            setattr(row, k, v)
        row.revision += 1; row.updated_at = datetime.now(timezone.utc)
        record_event(session, user.id, patient.id, "medication.item_updated", "medication_item", row.id,
                     {"revision": row.revision, "mis_write": False})
        await grant_points(session, patient.id, "medication", f"item:{row.id}:v{row.revision}", user.id)
    response = await medication_response(session, patient.id, item_read(row), f"item:{row.id}:v{row.revision}", same)
    await session.commit()
    return response


@router.post("/medications/reports", status_code=201)
async def medication_report(payload: MedicationReport, session: CompassSession, user: User = PatientUser):
    patient = await own_patient(session, user, lock=True)
    previous = await session.scalar(select(MedicationLog).where(MedicationLog.patient_id == patient.id,
        MedicationLog.client_request_id == str(payload.client_request_id)))
    if previous:
        if not previous.occurrence_key.startswith(payload.day.isoformat() + "@") or (previous.item_key, previous.occurrence_key, previous.status, previous.reason) != (
            payload.item_key, payload.occurrence_key, payload.status, payload.reason.strip()):
            raise HTTPException(409, "Ключ запроса уже использован с другим самоотчётом")
        return await medication_response(session, patient.id, log_read(previous), f"log:{previous.id}", True)
    items, _ = await inventory(session, patient)
    item = next((i for i in items if i["key"] == payload.item_key), None)
    if item is None or not item["active"]:
        raise HTTPException(404, "Позиция не найдена или неактивна")
    if payload.day > datetime.now(ZoneInfo(item["timezone"])).date():
        raise HTTPException(422, "Самоотчёт о будущем дне недопустим")
    if item["schedule_kind"] == "fixed":
        event = next((e for e in occurrences(item, payload.day) if e["occurrence_key"] == payload.occurrence_key), None)
        if event is None or event["scheduled_for"] is None:
            raise HTTPException(422, "Событие не соответствует расписанию или требует уточнения времени")
        scheduled = event["scheduled_for"]
        if scheduled > datetime.now(timezone.utc):
            raise HTTPException(422, "Время события ещё не наступило")
    else:
        if payload.occurrence_key != f"{payload.day.isoformat()}@self_report/v{item['revision']}":
            raise HTTPException(422, "Укажите дневной самоотчёт для свободного расписания")
        if payload.day < date.fromisoformat(item["starts_on"]) or (
            item.get("ends_on") and payload.day > date.fromisoformat(item["ends_on"])):
            raise HTTPException(422, "День вне указанного периода")
        scheduled = None
    existing = await session.scalar(select(MedicationLog).where(MedicationLog.patient_id == patient.id,
        MedicationLog.item_key == payload.item_key, MedicationLog.occurrence_key == payload.occurrence_key))
    if existing:
        if existing.status != payload.status or existing.reason != payload.reason.strip():
            raise HTTPException(409, "Самоотчёт уже есть: исправьте существующую запись")
        return await medication_response(session, patient.id, log_read(existing), f"log:{existing.id}", True)
    row = MedicationLog(patient_id=patient.id, client_request_id=str(payload.client_request_id),
        item_key=payload.item_key, occurrence_key=payload.occurrence_key, scheduled_for=scheduled,
        status=payload.status, reason=payload.reason.strip())
    session.add(row); await session.flush()
    record_event(session, user.id, patient.id, "medication.reported", "medication_log", row.id,
                 {"status": row.status, "ingestion_verified": False})
    await grant_points(session, patient.id, "medication", f"log:{row.id}", user.id)
    response = await medication_response(session, patient.id, log_read(row), f"log:{row.id}", False)
    await session.commit()
    return response


@router.patch("/medications/reports/{report_id}")
async def edit_report(report_id: int, payload: MedicationReportEdit, session: CompassSession, user: User = PatientUser):
    patient = await own_patient(session, user, lock=True)
    row = await session.scalar(select(MedicationLog).where(MedicationLog.id == report_id,
        MedicationLog.patient_id == patient.id).with_for_update())
    if row is None:
        raise HTTPException(404, "Самоотчёт не найден")
    same = row.status == payload.status and row.reason == payload.reason.strip()
    if row.revision != payload.expected_revision:
        if same and row.revision == payload.expected_revision + 1:
            source_key = f"log:{row.id}" if row.revision == 1 else f"log:{row.id}:v{row.revision}"
            return await medication_response(session, patient.id, log_read(row), source_key, True)
        raise HTTPException(409, "Самоотчёт уже изменён")
    if not same:
        row.status, row.reason = payload.status, payload.reason.strip()
        row.revision += 1; row.updated_at = datetime.now(timezone.utc)
        record_event(session, user.id, patient.id, "medication.report_corrected", "medication_log", row.id,
                     {"status": row.status, "revision": row.revision})
        await grant_points(session, patient.id, "medication", f"log:{row.id}:v{row.revision}", user.id)
    source_key = f"log:{row.id}" if row.revision == 1 else f"log:{row.id}:v{row.revision}"
    response = await medication_response(session, patient.id, log_read(row), source_key, same)
    await session.commit()
    return response
