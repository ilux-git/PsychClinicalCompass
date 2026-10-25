from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from app.api.deps import CompassSession, CurrentUser, patient_for_user, require_role
from app.modules.access.models import User, UserRole
from app.modules.adherence.models import AdherenceReport, DiaryEntry
from app.modules.adherence.schemas import AdherenceWrite, DiarySharing, DiaryWrite
from app.modules.audit.service import record_event
from app.modules.patients.models import Patient
from app.modules.adherence.rewards import grant_points, participation_receipt

router = APIRouter(tags=["adherence"])


def report_read(row: AdherenceReport) -> dict:
    return {"id": row.id, "patient_id": row.patient_id, "recommendation": row.recommendation,
            "status": row.status, "reason": row.reason, "created_at": row.created_at,
            "source": "patient_self_report"}


@router.post("/adherence/reports", status_code=201)
async def report(payload: AdherenceWrite, session: CompassSession,
                 user: User = Depends(require_role([UserRole.patient]))) -> dict:
    patient = await session.scalar(select(Patient).where(Patient.user_id == user.id))
    if patient is None:
        raise HTTPException(403, "Учётная запись не связана с пациентом")
    data = payload.model_dump(mode="json")
    row = (await session.execute(insert(AdherenceReport).values(patient_id=patient.id, **data)
                .on_conflict_do_nothing(constraint="uq_adherence_request").returning(AdherenceReport))).scalar_one_or_none()
    if row is None:
        row = await session.scalar(select(AdherenceReport).where(AdherenceReport.patient_id == patient.id,
                                  AdherenceReport.client_request_id == str(payload.client_request_id)))
        if any(getattr(row, key) != data[key] for key in ("recommendation", "status", "reason")):
            raise HTTPException(409, "Ключ запроса уже использован с другим ответом")
    else:
        record_event(session, user.id, patient.id, "adherence.reported", "adherence_report", row.id)
    await session.commit()
    return report_read(row)


@router.get("/patients/{patient_id}/adherence")
async def reports(patient_id: int, session: CompassSession, user: CurrentUser) -> dict:
    await patient_for_user(session, user, patient_id)
    rows = (await session.scalars(select(AdherenceReport).where(AdherenceReport.patient_id == patient_id)
                                  .order_by(AdherenceReport.created_at.desc(), AdherenceReport.id.desc()).limit(100))).all()
    return {"reports": [report_read(r) for r in rows], "observation_status": "reported" if rows else "unknown"}


def diary_read(row: DiaryEntry) -> dict:
    return {"id": row.id, "text": row.text, "shared_with_doctor": row.shared_with_doctor,
            "created_at": row.created_at, "source": "voluntary_patient_diary",
            "observed_at": row.observed_at, "observation_kind": row.observation_kind,
            "feeling": row.feeling, "daily_impact": row.daily_impact, "is_clinical_scale": False}


@router.post("/diary/entries", status_code=201)
async def create_diary_entry(payload: DiaryWrite, session: CompassSession,
                             user: User = Depends(require_role([UserRole.patient]))) -> dict:
    patient = await session.scalar(select(Patient).where(Patient.user_id == user.id).with_for_update())
    if patient is None:
        raise HTTPException(403, "Учётная запись не связана с пациентом")
    row = await session.scalar(insert(DiaryEntry).values(
        patient_id=patient.id, **{**payload.model_dump(), "client_request_id": str(payload.client_request_id)},
        initial_shared_with_doctor=payload.shared_with_doctor
    ).on_conflict_do_nothing(constraint="uq_diary_request").returning(DiaryEntry))
    replayed = row is None
    if replayed:
        row = await session.scalar(select(DiaryEntry).where(DiaryEntry.patient_id == patient.id,
                                   DiaryEntry.client_request_id == str(payload.client_request_id)))
        if row.text != payload.text or row.initial_shared_with_doctor != payload.shared_with_doctor:
            raise HTTPException(409, "Ключ запроса уже использован с другой записью")
        if any(getattr(row, key) != getattr(payload, key) for key in ("observed_at", "observation_kind", "feeling", "daily_impact")):
            raise HTTPException(409, "Ключ запроса уже использован с другим наблюдением")
    else:
        record_event(session, user.id, patient.id, "diary.created", "diary_entry", row.id,
                     {"shared_with_doctor": row.shared_with_doctor})
        await grant_points(session, patient.id, "diary", f"diary:{row.id}", user.id)
    receipt = await participation_receipt(session, patient.id, "diary", f"diary:{row.id}")
    await session.commit()
    return {**diary_read(row), "replayed": replayed, "participation": receipt}


@router.get("/patients/{patient_id}/diary")
async def diary_entries(patient_id: int, session: CompassSession, user: CurrentUser) -> dict:
    await patient_for_user(session, user, patient_id)
    query = select(DiaryEntry).where(DiaryEntry.patient_id == patient_id)
    if user.role == UserRole.doctor:
        query = query.where(DiaryEntry.shared_with_doctor.is_(True))
    rows = (await session.scalars(query.order_by(DiaryEntry.id.desc()).limit(100))).all()
    return {"entries": [diary_read(row) for row in rows], "limit": 100,
            "visibility": "shared_with_treating_doctor" if user.role == UserRole.doctor else "own_entries"}


@router.patch("/diary/entries/{entry_id}/sharing")
async def change_diary_sharing(entry_id: int, payload: DiarySharing, session: CompassSession,
                              user: User = Depends(require_role([UserRole.patient]))) -> dict:
    row = await session.scalar(select(DiaryEntry).join(Patient, Patient.id == DiaryEntry.patient_id).where(
        DiaryEntry.id == entry_id, Patient.user_id == user.id).with_for_update(of=DiaryEntry))
    if row is None:
        raise HTTPException(404, "Запись не найдена или недоступна")
    if row.shared_with_doctor != payload.shared_with_doctor:
        row.shared_with_doctor = payload.shared_with_doctor
        record_event(session, user.id, row.patient_id, "diary.sharing_changed", "diary_entry", row.id,
                     {"shared_with_doctor": row.shared_with_doctor})
    await session.commit()
    return diary_read(row)
