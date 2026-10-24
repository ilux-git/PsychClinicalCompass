from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


class TreatmentWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")
    client_request_id: UUID
    status: Literal["in_progress", "completed", "refused"]
    reason: str = Field(default="", max_length=2000)
    expected_revision: int = Field(ge=0)
    reason_category: Literal["financial","time","family","perceived_benefit","reported_discomfort","other","not_disclosed","unknown"] | None = None

    @model_validator(mode="after")
    def refusal_reason_only(self):
        if self.reason_category is not None and self.status != "refused":
            raise ValueError("Категория причины указывается только для подтверждённого отказа")
        return self
