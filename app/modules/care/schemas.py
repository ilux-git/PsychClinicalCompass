from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class TreatmentWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")
    client_request_id: UUID
    status: Literal["in_progress", "completed", "refused"]
    reason: str = Field(default="", max_length=2000)
    expected_revision: int = Field(ge=0)
