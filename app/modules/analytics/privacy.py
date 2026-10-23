from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, StrictInt
from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint, func, select, text
from sqlalchemy.orm import Mapped, mapped_column

from app.api.deps import CompassSession, require_role
from app.core.config import get_settings
from app.db.base import Base
from app.modules.access.models import User, UserRole
from app.modules.audit.service import record_event


class PrivacyPolicyChange(Base):
    __tablename__ = "privacy_policy_changes"
    __table_args__ = (UniqueConstraint("client_request_id", name="uq_privacy_request"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    actor_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    client_request_id: Mapped[str] = mapped_column(String(36), nullable=False)
    min_group_size: Mapped[int | None] = mapped_column()
    reason: Mapped[str] = mapped_column(String(1000), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


async def effective_policy(session):
    row = await session.scalar(select(PrivacyPolicyChange).order_by(PrivacyPolicyChange.id.desc()).limit(1))
    return {"revision": row.id if row else 0,
        "min_group_size": row.min_group_size if row else get_settings().admin_analytics_min_group_size,
        "source": "administrator" if row else "environment",
        "owner_role": "admin", "individual_access": False, "arbitrary_filters": False}


class PrivacyWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")
    client_request_id: UUID
    expected_revision: int = Field(ge=0)
    min_group_size: StrictInt | None = Field(ge=1, le=100000)
    reason: str = Field(min_length=1, max_length=1000)


router = APIRouter(tags=["administration policy"])
Admin = Depends(require_role([UserRole.admin]))


@router.get("/admin/privacy-policy")
async def privacy_policy(session: CompassSession, user: User = Admin):
    rows = (await session.scalars(select(PrivacyPolicyChange).order_by(PrivacyPolicyChange.id.desc()).limit(30))).all()
    return {**await effective_policy(session), "mode": "synthetic_demo",
        "history": [{"revision": r.id, "min_group_size": r.min_group_size, "reason": r.reason,
                     "actor_id": r.actor_id, "created_at": r.created_at} for r in rows],
        "notice": "Порог применяется к разным пациентам и дополнениям ячеек. Один порог не доказывает полное обезличивание. Для реального пилота нужны разрешённые разрезы, периоды и политика хранения."}


@router.put("/admin/privacy-policy")
async def set_policy(payload: PrivacyWrite, session: CompassSession, user: User = Admin):
    if not payload.reason.strip():
        raise HTTPException(422, "Укажите основание изменения")
    await session.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": 846999})
    previous = await session.scalar(select(PrivacyPolicyChange).where(
        PrivacyPolicyChange.client_request_id == str(payload.client_request_id)))
    if previous:
        if previous.actor_id != user.id or previous.min_group_size != payload.min_group_size or previous.reason != payload.reason.strip():
            raise HTTPException(409, "Ключ запроса уже использован с другой политикой")
        return {**await effective_policy(session), "replayed": True}
    current = await effective_policy(session)
    if current["revision"] != payload.expected_revision:
        raise HTTPException(409, "Политика уже изменена: обновите настройки")
    row = PrivacyPolicyChange(actor_id=user.id, client_request_id=str(payload.client_request_id),
        min_group_size=payload.min_group_size, reason=payload.reason.strip())
    session.add(row); await session.flush()
    record_event(session, user.id, None, "admin.privacy_changed", "privacy_policy", row.id,
                 {"min_group_size": row.min_group_size, "previous_revision": current["revision"]})
    await session.commit()
    return {**await effective_policy(session), "replayed": False}
