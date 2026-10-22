from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class MessageCreate(BaseModel):
    client_request_id: UUID | None = None
    text: str = Field(min_length=1, max_length=4096)
    channel: Literal["web", "tg_doctor", "tg_patient"] = "web"

    @field_validator("text")
    @classmethod
    def not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Сообщение не может быть пустым")
        return value


class MessageRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    patient_id: int
    sender_id: int | None
    sender_role: str
    text: str
    status: str
    channel: str
    external_message_id: str | None
    created_at: datetime
