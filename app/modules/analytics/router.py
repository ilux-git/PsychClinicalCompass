from datetime import datetime

from fastapi import APIRouter, Depends

from app.api.deps import CompassSession, require_role
from app.modules.access.models import User, UserRole
from app.modules.analytics import service

router = APIRouter(tags=["analytics"])


@router.get("/analytics/engagement")
async def engagement(session: CompassSession, user: User = Depends(require_role([UserRole.doctor])),
                     since: datetime | None = None, until: datetime | None = None) -> dict:
    return await service.engagement(session, user, since, until)


@router.get("/participation/me")
async def participation(session: CompassSession, user: User = Depends(require_role([UserRole.patient]))) -> dict:
    return await service.participation(session, user)
