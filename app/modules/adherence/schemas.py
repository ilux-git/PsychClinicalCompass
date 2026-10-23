from typing import Literal
from uuid import UUID
from datetime import datetime

from pydantic import BaseModel, Field, StrictBool, field_validator, model_validator


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


class DiaryWrite(BaseModel):
    client_request_id: UUID
    text: str = Field(default="", max_length=4000)
    shared_with_doctor: StrictBool = False
    observed_at: datetime | None = None
    observation_kind: Literal["moment", "day_summary"] | None = None
    feeling: Literal["very_difficult", "difficult", "neutral", "good", "very_good"] | None = None
    daily_impact: Literal["no_interference", "some_interference", "strong_interference", "cannot_assess"] | None = None

    @field_validator("text")
    @classmethod
    def not_blank(cls, value: str) -> str:
        return value.strip()

    @model_validator(mode="after")
    def valid_observation(self):
        if not self.text and self.feeling is None and self.daily_impact is None:
            raise ValueError("Добавьте текст или своё наблюдение")
        if self.observed_at is not None and self.observed_at.tzinfo is None:
            raise ValueError("Время наблюдения должно содержать часовой пояс")
        if any(v is not None for v in (self.feeling, self.daily_impact, self.observation_kind, self.observed_at)):
            if self.observed_at is None or self.observation_kind is None:
                raise ValueError("Укажите время наблюдения и момент/итог дня")
        return self


class DiarySharing(BaseModel):
    shared_with_doctor: StrictBool
