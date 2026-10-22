from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from app.api.deps import CompassSession, CurrentUser, patient_for_user, require_role
from app.modules.access.models import User, UserRole
from app.modules.adherence.models import AdherenceReport
from app.modules.adherence.schemas import AdherenceWrite
from app.modules.audit.service import record_event
from app.modules.patients.models import Patient

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
