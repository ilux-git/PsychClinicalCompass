from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class DoctorNote(Base):
    __tablename__ = "doctor_notes"

    id: Mapped[int] = mapped_column(primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"), nullable=False, index=True)
    doctor_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    text: Mapped[str] = mapped_column(String(4000), nullable=False)
    source_type: Mapped[str] = mapped_column(String(32), nullable=False, default="manual")
    source_id: Mapped[int | None] = mapped_column()
    dimension: Mapped[str | None] = mapped_column(String(40))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class DoctorTask(Base):
    __tablename__ = "doctor_tasks"
    __table_args__ = (
        UniqueConstraint("doctor_id", "client_request_id", name="uq_task_request"),
        CheckConstraint("status IN ('open', 'in_progress', 'done')", name="ck_task_stage"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"), nullable=False, index=True)
    doctor_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="open")
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    client_request_id: Mapped[str | None] = mapped_column(String(36))
    assigned_to_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    kind: Mapped[str] = mapped_column(String(24), nullable=False, default="clinical", server_default="clinical")
    source_type: Mapped[str] = mapped_column(String(32), nullable=False, default="manual", server_default="manual")
    source_id: Mapped[int | None] = mapped_column()
    action_result: Mapped[str] = mapped_column(String(2000), nullable=False, default="", server_default="")
    follow_up_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    verification_status: Mapped[str] = mapped_column(String(24), nullable=False, default="pending", server_default="pending")
    verification_comment: Mapped[str] = mapped_column(String(2000), nullable=False, default="", server_default="")
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    verified_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    revision: Mapped[int] = mapped_column(nullable=False, default=0, server_default="0")
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
