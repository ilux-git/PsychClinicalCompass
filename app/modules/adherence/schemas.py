from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


class AdherenceWrite(BaseModel):
    client_request_id: UUID
    recommendation: str = Field(min_length=1, max_length=300)
    status: Literal["followed", "not_followed", "unknown", "not_applicable"]
    reason: str = Field(default="", max_length=2000)

    @field_validator("recommendation")
    @classmethod
    def not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Укажите рекомендацию")
        return value.strip()
