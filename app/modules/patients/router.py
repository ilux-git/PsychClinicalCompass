from fastapi import APIRouter, HTTPException, Query
from datetime import datetime,timedelta
from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError

from app.api.deps import CompassSession, CurrentUser, patient_for_user, patient_read_queries, patient_read_rows
from app.db.session import async_session_mis
from app.modules.access.models import User, UserRole
from app.modules.assessments.models import QuestionnaireResponse
from app.modules.assessments.clinical_models import ClinicalResult
from app.modules.assessments.catalog import PHQ9_KEY, GAD7_KEY, PANIC_KEY
from app.modules.assessments.scenarios import scenario_label, scenario_for_mis
from app.modules.audit.models import AuditEvent
from app.modules.integration.mis_models import MISPatient
from app.modules.patients.models import Patient, PatientMapping
from app.modules.care.models import TreatmentStatusChange
from app.modules.integration.synthetic import patient_snapshot
from app.modules.notes.models import DoctorTask
from app.modules.alerts.models import Alert

router = APIRouter(prefix="/patients", tags=["patients"])
_CARD_READ = patient_read_queries(select(Patient, PatientMapping.mis_id.label("mapped_mis_id"),
    User.id.label("linked_doctor_id"), User.display_name.label("doctor_name"),
    User.availability.label("doctor_availability")).select_from(Patient).outerjoin(
    PatientMapping, PatientMapping.compass_patient_id == Patient.id).outerjoin(User, User.id == Patient.doctor_id))
_ASSESSMENT_HISTORY = patient_read_queries(select(Patient.id.label("scope_patient_id"), QuestionnaireResponse.id,
    QuestionnaireResponse.form_type, QuestionnaireResponse.form_version, QuestionnaireResponse.answers,
    QuestionnaireResponse.score, QuestionnaireResponse.risk_flags, QuestionnaireResponse.created_at).select_from(Patient).outerjoin(
    QuestionnaireResponse, QuestionnaireResponse.patient_id == Patient.id).order_by(
    QuestionnaireResponse.created_at, QuestionnaireResponse.id))


def patient_summary(patient: Patient) -> dict:
    return {"id": patient.id, "full_name": patient.full_name, "mis_id": patient.mis_id,
            "doctor_id": patient.doctor_id, "created_at": patient.created_at,"scenario_label":scenario_label(patient.mis_id)}


@router.get("")
async def patients(session: CompassSession, user: CurrentUser) -> list[dict]:
    if user.role not in {UserRole.doctor, UserRole.patient}:
        raise HTTPException(403, "Нет клинического доступа")
    query = select(Patient).order_by(Patient.id)
    query = query.where(Patient.doctor_id == user.id) if user.role == UserRole.doctor else query.where(Patient.user_id == user.id)
    rows = (await session.scalars(query)).all()
    return await directory_items(session, rows) if user.role == UserRole.doctor else [patient_summary(p) for p in rows]


async def directory_items(session, rows):
    ids = [p.id for p in rows]
    if not ids: return []
    latest = dict((await session.execute(select(TreatmentStatusChange.patient_id, TreatmentStatusChange.status).where(
        TreatmentStatusChange.patient_id.in_(ids)).distinct(TreatmentStatusChange.patient_id).order_by(
        TreatmentStatusChange.patient_id, TreatmentStatusChange.id.desc()))).all())
    mappings = dict((await session.execute(select(PatientMapping.compass_patient_id, PatientMapping.mis_id).where(
        PatientMapping.compass_patient_id.in_(ids)))).all())
    task_counts = {}
    for patient_id, stage, count in (await session.execute(select(DoctorTask.patient_id, DoctorTask.status, func.count()).where(
            DoctorTask.patient_id.in_(ids)).group_by(DoctorTask.patient_id, DoctorTask.status))).all():
        task_counts.setdefault(patient_id, {})[stage] = count
    alerts = dict((await session.execute(select(Alert.patient_id,func.count()).where(
        Alert.patient_id.in_(ids), Alert.status != 'closed').group_by(Alert.patient_id))).all())
    observations = dict((await session.execute(select(QuestionnaireResponse.patient_id,func.max(QuestionnaireResponse.created_at)).where(
        QuestionnaireResponse.patient_id.in_(ids)).group_by(QuestionnaireResponse.patient_id))).all())
    clinical = {row.patient_id: row for row in (await session.scalars(select(ClinicalResult).where(
        ClinicalResult.patient_id.in_(ids), ClinicalResult.instrument_key.in_((PHQ9_KEY, GAD7_KEY, PANIC_KEY)))
        .distinct(ClinicalResult.patient_id).order_by(ClinicalResult.patient_id, ClinicalResult.created_at.desc(), ClinicalResult.id.desc()))).all()}
    result = []
    for patient in rows:
        point = clinical.get(patient.id)
        numeric_at = observations.get(patient.id)
        clinical_is_latest = point is not None and (numeric_at is None or point.created_at >= numeric_at)
        preview = {"id": point.id, "instrument_key": point.instrument_key,
            "code": {PHQ9_KEY: "PHQ-9", GAD7_KEY: "GAD-7", PANIC_KEY: "PHQ · панический модуль"}[point.instrument_key],
            "name": point.definition["name"], "version": point.definition["version"],
            "score": point.score, "maximum": point.definition["maximum"],
            "criterion_met": point.result.get("criterion_met"), "created_at": point.created_at} if point else None
        fixture = patient_snapshot(patient.mis_id if mappings.get(patient.id) == patient.mis_id else None)
        case=scenario_for_mis(patient.mis_id) if mappings.get(patient.id)==patient.mis_id else None
        measurement=max(case["measurements"],key=lambda row:row["day"],default=None) if case else None
        scenario_measurement={**measurement,"created_at":datetime.fromisoformat(case["anchor_date"].replace("Z","+00:00"))+timedelta(days=measurement["day"]),
            "source":"supplied_case_history","version_confirmed":False} if measurement else None
        result.append({**patient_summary(patient), "demo_scenario": scenario_label(patient.mis_id) or (fixture['data']['scenario']['title'] if fixture['data'] else None),
            "treatment_status": latest.get(patient.id,'unknown'), "open_tasks":task_counts.get(patient.id,{}).get('open',0),
            "in_progress_tasks":task_counts.get(patient.id,{}).get('in_progress',0), "pending_events": alerts.get(patient.id,0),
            "last_observation_at": point.created_at if clinical_is_latest else numeric_at,
            "last_observation_source": "canonical_clinical" if clinical_is_latest else "numeric_demo" if numeric_at else None,
            "latest_clinical_result": preview,"scenario_measurement":scenario_measurement})
    return result


@router.get("/directory")
async def directory(session: CompassSession, user: CurrentUser, q: str = Query(default='', max_length=100),
        after: int = Query(default=0, ge=0), limit: int = Query(default=24, ge=1, le=100)):
    if user.role != UserRole.doctor: raise HTTPException(403, 'Список пациентов доступен врачу')
    conditions = [Patient.doctor_id == user.id]
    if q.strip():
        value = q.strip().replace('\\','\\\\').replace('%','\\%').replace('_','\\_')
        conditions.append(Patient.full_name.ilike(f'%{value}%', escape='\\'))
    total = await session.scalar(select(func.count()).select_from(Patient).where(*conditions))
    rows = (await session.scalars(select(Patient).where(*conditions, Patient.id > after).order_by(Patient.id).limit(limit+1))).all()
    page = rows[:limit]
    return {'total':total, 'items':await directory_items(session,page), 'next_cursor':page[-1].id if len(rows)>limit else None}


@router.get("/{patient_id}")
async def card(patient_id: int, session: CompassSession, user: CurrentUser) -> dict:
    patient, mapped_mis_id, doctor_id, doctor_name, doctor_availability = (
        await patient_read_rows(session, user, patient_id, _CARD_READ))[0]
    mis: dict = {"source": "MIS", "status": "not_linked", "diagnoses": [], "prescriptions": []}
    if mapped_mis_id is not None and mapped_mis_id != patient.mis_id:
        mis["status"] = "mapping_conflict"
    elif mapped_mis_id is not None and (case:=scenario_for_mis(patient.mis_id)) is not None:
        mis.update(source="synthetic_mis_json",status="available",full_name=case["full_name"],
            diagnoses=case["diagnoses"],prescriptions=case["current_prescriptions"])
    elif mapped_mis_id is not None:
        try:
            async with async_session_mis() as mis_session:
                source = await mis_session.get(MISPatient, mapped_mis_id)
                mis["status"] = "available" if source else "missing"
                if source:
                    mis.update(full_name=source.full_name, diagnoses=source.diagnoses, prescriptions=source.prescriptions)
        except (SQLAlchemyError, OSError, TimeoutError):
            mis["status"] = "unavailable"
    return {**patient_summary(patient), "mis": mis,
            "doctor": {"name": doctor_name, "availability": doctor_availability} if doctor_id is not None else None}


@router.get("/{patient_id}/assessments")
async def assessments(patient_id: int, session: CompassSession, user: CurrentUser) -> list[dict]:
    rows = await patient_read_rows(session, user, patient_id, _ASSESSMENT_HISTORY)
    return [{"id": r.id, "form_type": r.form_type, "form_version": r.form_version, "answers": r.answers, "score": r.score,
             "risk_flags": r.risk_flags, "created_at": r.created_at} for r in rows if r.id is not None]


@router.get("/{patient_id}/timeline")
async def timeline(patient_id: int, session: CompassSession, user: CurrentUser) -> list[dict]:
    await patient_for_user(session, user, patient_id)
    # Private clinical work is not included in the patient's view.
    if user.role != UserRole.doctor:
        raise HTTPException(403, "История действий доступна врачу")
    events = (await session.scalars(select(AuditEvent).where(AuditEvent.patient_id == patient_id)
                                    .order_by(AuditEvent.created_at.desc(), AuditEvent.id.desc()).limit(100))).all()
    return [{"id": e.id, "event_type": e.event_type, "object_type": e.object_type,
             "object_id": e.object_id, "actor_id": e.actor_id, "created_at": e.created_at} for e in events]
