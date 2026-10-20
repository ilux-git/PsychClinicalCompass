from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class MessageCreate(BaseModel):
    text: str = Field(min_length=1, max_length=4096)
    channel: Literal["web", "tg_doctor", "tg_patient"] = "web"


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
