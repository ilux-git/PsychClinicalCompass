from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class TreatmentStatusChange(Base):
    __tablename__ = "treatment_status_changes"
    __table_args__ = (
        UniqueConstraint("patient_id", "client_request_id", name="uq_treatment_request"),
        CheckConstraint("status IN ('in_progress', 'completed', 'refused')", name="ck_treatment_status"),
        CheckConstraint("reason_category IS NULL OR reason_category IN ('financial','time','family','perceived_benefit','reported_discomfort','other','not_disclosed','unknown')", name="ck_refusal_category"),
        CheckConstraint("status = 'refused' OR reason_category IS NULL", name="ck_refusal_category_status"),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"), nullable=False, index=True)
    doctor_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    client_request_id: Mapped[str] = mapped_column(String(36), nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False)
    reason: Mapped[str] = mapped_column(String(2000), nullable=False, default="")
    reason_category: Mapped[str | None] = mapped_column(String(32))
    source: Mapped[str] = mapped_column(String(40), nullable=False, default="doctor_decision")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
