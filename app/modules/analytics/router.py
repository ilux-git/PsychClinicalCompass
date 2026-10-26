from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request, Query

from app.api.deps import CompassSession, require_role
from app.modules.access.models import User, UserRole
from app.modules.analytics import service
from app.modules.analytics.admin import clinic_summary
from app.core.config import get_settings
from app.modules.analytics.privacy import effective_policy
from app.modules.analytics.care import workflow_metrics
from app.modules.analytics.clinical import clinical_cohort
from app.modules.patients.models import Patient
from sqlalchemy import select

router = APIRouter(tags=["analytics"])


@router.get("/analytics/clinical-instruments")
async def clinical_metrics(session: CompassSession, user: User = Depends(require_role([UserRole.doctor])),
                           q: str = Query(default="", max_length=100)) -> dict:
    return await clinical_cohort(session, user, q)


@router.get("/analytics/clinic")
async def clinic(request: Request, session: CompassSession,
                 user: User = Depends(require_role([UserRole.admin]))) -> dict:
    if request.query_params:
        raise HTTPException(422, "Произвольные разрезы и фильтры административной сводки не разрешены")
    policy = await effective_policy(session)
    return await clinic_summary(session, policy["min_group_size"])


@router.get("/analytics/engagement")
async def engagement(session: CompassSession, user: User = Depends(require_role([UserRole.doctor])),
                     since: datetime | None = None, until: datetime | None = None) -> dict:
    return await service.engagement(session, user, since, until)


@router.get("/participation/me")
async def participation(session: CompassSession, user: User = Depends(require_role([UserRole.patient]))) -> dict:
    return await service.participation(session, user)


@router.get("/analytics/care")
async def care_metrics(session: CompassSession, user: User = Depends(require_role([UserRole.doctor]))):
    patients = (await session.scalars(select(Patient).where(Patient.doctor_id == user.id))).all()
    values, _ = await workflow_metrics(session, patients)
    return values
