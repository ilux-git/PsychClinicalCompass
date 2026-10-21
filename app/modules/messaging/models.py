from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class MessageStatus:
    QUEUED = "queued"
    SENT = "sent"
    READ = "read"
    SIMULATED = "simulated"


class MessageChannel:
    WEB = "web"
    TG_DOCTOR = "tg_doctor"
    TG_PATIENT = "tg_patient"


class Message(Base):
    __tablename__ = "messages"
    __table_args__ = (UniqueConstraint("external_message_id", name="uq_messages_external_message_id"),
                     UniqueConstraint("sender_id", "client_request_id", name="uq_message_request"))

    id: Mapped[int] = mapped_column(primary_key=True)
    client_request_id: Mapped[str | None] = mapped_column(String(36))
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"), nullable=False, index=True)
    sender_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    sender_role: Mapped[str] = mapped_column(String(16), nullable=False)
    text: Mapped[str] = mapped_column(nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default=MessageStatus.QUEUED)
    channel: Mapped[str] = mapped_column(String(16), nullable=False)
    external_message_id: Mapped[str | None] = mapped_column(nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
