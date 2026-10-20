from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Patient(Base):
    __tablename__ = "patients"

    id: Mapped[int] = mapped_column(primary_key=True)
    mis_id: Mapped[int | None] = mapped_column(unique=True)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    doctor_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class PatientMapping(Base):
    __tablename__ = "patient_mappings"

    id: Mapped[int] = mapped_column(primary_key=True)
    compass_patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"), nullable=False, unique=True)
    mis_id: Mapped[int] = mapped_column(nullable=False, unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
