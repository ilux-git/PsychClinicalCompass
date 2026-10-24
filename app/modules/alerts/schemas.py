from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator


class DecisionWrite(BaseModel):
    action: Literal["confirmed", "declined"]
    expected_version: int = Field(ge=1)
    reason: str = Field(default="", max_length=2000)


class AlertActionWrite(BaseModel):
    client_request_id: UUID
    title: str = Field(min_length=1, max_length=300)
    kind: Literal["clinical", "organization"] = "clinical"
    assigned_to_id: int | None = Field(default=None, gt=0)
    due_at: datetime | None = None
    follow_up_at: datetime | None = None
    reply: str = Field(default="", max_length=4096)
    reply_channel: Literal["web", "tg_doctor"] = "web"

    @model_validator(mode="after")
    def valid_action(self):
        if not self.title.strip() or any(value is not None and value.tzinfo is None
                                         for value in (self.due_at, self.follow_up_at)):
            raise ValueError("Нужны название задачи и часовой пояс срока")
        self.title = self.title.strip()
        return self
