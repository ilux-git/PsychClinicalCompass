from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, SmallInteger, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class AuditEvent(Base):
    __tablename__ = "audit_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    patient_id: Mapped[int | None] = mapped_column(ForeignKey("patients.id"), index=True)
    event_type: Mapped[str] = mapped_column(String(80), nullable=False)
    object_type: Mapped[str] = mapped_column(String(40), nullable=False)
    object_id: Mapped[int] = mapped_column(nullable=False)
    details: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ReadAccessEvent(Base):
    __tablename__ = "read_access_events"
    __table_args__ = (
        CheckConstraint("http_status BETWEEN 100 AND 599", name="ck_read_access_http_status"),
        Index("ix_read_access_actor_created", "actor_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    actor_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    actor_role: Mapped[str] = mapped_column(String(20), nullable=False)
    route: Mapped[str] = mapped_column(String(200), nullable=False)
    resource_ids: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    http_status: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    request_id: Mapped[str] = mapped_column(String(36), nullable=False, unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
