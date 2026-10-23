from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class MedicationItem(Base):
    __tablename__ = "medication_items"
    __table_args__ = (UniqueConstraint("patient_id", "client_request_id", name="uq_medication_item_request"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"), nullable=False, index=True)
    created_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    client_request_id: Mapped[str] = mapped_column(String(36), nullable=False)
    label: Mapped[str] = mapped_column(String(300), nullable=False)
    instructions: Mapped[str] = mapped_column(String(2000), nullable=False, default="")
    schedule_text: Mapped[str] = mapped_column(String(1500), nullable=False)
    schedule_kind: Mapped[str] = mapped_column(String(24), nullable=False)
    times: Mapped[list] = mapped_column(JSONB, nullable=False)
    weekdays: Mapped[list] = mapped_column(JSONB, nullable=False)
    timezone: Mapped[str] = mapped_column(String(80), nullable=False)
    starts_on: Mapped[date] = mapped_column(Date, nullable=False)
    ends_on: Mapped[date | None] = mapped_column(Date)
    active: Mapped[bool] = mapped_column(nullable=False, default=True)
    revision: Mapped[int] = mapped_column(nullable=False, default=1)
    initial_payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class MedicationLog(Base):
    __tablename__ = "medication_logs"
    __table_args__ = (
        UniqueConstraint("patient_id", "client_request_id", name="uq_medication_log_request"),
        UniqueConstraint("patient_id", "item_key", "occurrence_key", name="uq_medication_occurrence"),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"), nullable=False, index=True)
    client_request_id: Mapped[str] = mapped_column(String(36), nullable=False)
    item_key: Mapped[str] = mapped_column(String(80), nullable=False)
    occurrence_key: Mapped[str] = mapped_column(String(120), nullable=False)
    scheduled_for: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(24), nullable=False)
    reason: Mapped[str] = mapped_column(String(2000), nullable=False, default="")
    revision: Mapped[int] = mapped_column(nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
