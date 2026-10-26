"""Recipient-scoped operational fallback; no clinical text is copied here."""
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class DoctorEscalationRoute(Base):
    __tablename__ = "doctor_escalation_routes"
    __table_args__ = (CheckConstraint("revision >= 1", name="ck_escalation_route_revision"),)

    doctor_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    coordinator_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    revision: Mapped[int] = mapped_column(nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class CoordinatorNotice(Base):
    __tablename__ = "coordinator_notices"
    __table_args__ = (
        CheckConstraint("reason IN ('doctor_unavailable', 'acknowledgement_overdue')", name="ck_coordinator_notice_reason"),
        Index("ix_coordinator_notices_recipient", "coordinator_id", "id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    alert_id: Mapped[int] = mapped_column(ForeignKey("alerts.id"), unique=True, nullable=False)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"), nullable=False)
    doctor_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    coordinator_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    route_revision: Mapped[int] = mapped_column(nullable=False)
    reason: Mapped[str] = mapped_column(String(32), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
