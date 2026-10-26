from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ClinicalResult(Base):
    """A completed canonical edition, separate from historic numeric demo rows."""
    __tablename__ = "clinical_results"
    __table_args__ = (CheckConstraint(
        "score IS NULL OR score >= 0", name="ck_clinical_result_score"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"), nullable=False, index=True)
    submission_id: Mapped[int] = mapped_column(ForeignKey("survey_submissions.id"), nullable=False, unique=True)
    instrument_key: Mapped[str] = mapped_column(String(64), nullable=False)
    definition: Mapped[dict] = mapped_column(JSONB, nullable=False)
    score: Mapped[int | None] = mapped_column()
    result: Mapped[dict] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ClinicalBaseline(Base):
    """An explicit doctor's reference for future comparisons, not a rewritten result."""
    __tablename__ = "clinical_baselines"
    __table_args__ = (UniqueConstraint("patient_id", "instrument_key", name="uq_clinical_baseline_patient_key"),
                      CheckConstraint("revision >= 1", name="ck_clinical_baseline_revision"))

    id: Mapped[int] = mapped_column(primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"), nullable=False)
    instrument_key: Mapped[str] = mapped_column(String(64), nullable=False)
    result_id: Mapped[int | None] = mapped_column(ForeignKey("clinical_results.id"))
    selected_by: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    reason: Mapped[str] = mapped_column(String(500), nullable=False)
    revision: Mapped[int] = mapped_column(nullable=False)
    selected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
