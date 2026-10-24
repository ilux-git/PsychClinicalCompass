from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Alert(Base):
    __tablename__ = "alerts"
    __table_args__ = (CheckConstraint(
        "(source_kind = 'assessment' AND assessment_id IS NOT NULL AND message_id IS NULL) OR "
        "(source_kind = 'support_request' AND message_id IS NOT NULL AND assessment_id IS NULL)",
        name="ck_alert_source"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"), nullable=False, index=True)
    source_event_id: Mapped[int] = mapped_column(ForeignKey("outbox_events.id"), unique=True, nullable=False)
    assessment_id: Mapped[int | None] = mapped_column(ForeignKey("questionnaire_responses.id"))
    message_id: Mapped[int | None] = mapped_column(ForeignKey("messages.id"))
    source_kind: Mapped[str] = mapped_column(String(24), nullable=False, default="assessment", server_default="assessment")
    rule_id: Mapped[str] = mapped_column(String(80), nullable=False)
    rule_version: Mapped[str] = mapped_column(String(32), nullable=False)
    severity: Mapped[str] = mapped_column(String(32), nullable=False, default="review_required")
    reason: Mapped[str] = mapped_column(String(1000), nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="created")
    acknowledged_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    closed_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ClinicalDecision(Base):
    __tablename__ = "clinical_decisions"

    id: Mapped[int] = mapped_column(primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"), nullable=False, index=True)
    alert_id: Mapped[int] = mapped_column(ForeignKey("alerts.id"), nullable=False, unique=True)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="pending_review")
    version: Mapped[int] = mapped_column(nullable=False, default=1)
    facts: Mapped[dict] = mapped_column(JSONB, nullable=False)
    missing_data: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    confirmed_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    reason: Mapped[str] = mapped_column(String(2000), nullable=False, default="")
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AlertPresentation(Base):
    """A visible browser row, not acknowledgement or proof that a person read it."""

    __tablename__ = "alert_presentations"
    __table_args__ = (UniqueConstraint("alert_id", "doctor_id", name="uq_alert_presentation_doctor"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    alert_id: Mapped[int] = mapped_column(ForeignKey("alerts.id"), nullable=False)
    doctor_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    presented_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class AlertHandling(Base):
    __tablename__ = "alert_handling"
    __table_args__ = (UniqueConstraint("doctor_id", "client_request_id", name="uq_alert_handling_request"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    doctor_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    alert_id: Mapped[int] = mapped_column(ForeignKey("alerts.id"), nullable=False, index=True)
    client_request_id: Mapped[str] = mapped_column(String(36), nullable=False)
    request_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    task_id: Mapped[int] = mapped_column(ForeignKey("doctor_tasks.id"), nullable=False)
    reply_message_id: Mapped[int | None] = mapped_column(ForeignKey("messages.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
