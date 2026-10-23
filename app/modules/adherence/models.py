from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class AdherenceReport(Base):
    __tablename__ = "adherence_reports"
    __table_args__ = (UniqueConstraint("patient_id", "client_request_id", name="uq_adherence_request"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"), nullable=False, index=True)
    client_request_id: Mapped[str] = mapped_column(String(36), nullable=False)
    recommendation: Mapped[str] = mapped_column(String(300), nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False)
    reason: Mapped[str] = mapped_column(String(2000), nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class DiaryEntry(Base):
    __tablename__ = "diary_entries"
    __table_args__ = (UniqueConstraint("patient_id", "client_request_id", name="uq_diary_request"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"), nullable=False, index=True)
    client_request_id: Mapped[str] = mapped_column(String(36), nullable=False)
    text: Mapped[str] = mapped_column(String(4000), nullable=False)
    shared_with_doctor: Mapped[bool] = mapped_column(nullable=False, default=False)
    initial_shared_with_doctor: Mapped[bool] = mapped_column(nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    observed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    observation_kind: Mapped[str | None] = mapped_column(String(24))
    feeling: Mapped[str | None] = mapped_column(String(24))
    daily_impact: Mapped[str | None] = mapped_column(String(24))
