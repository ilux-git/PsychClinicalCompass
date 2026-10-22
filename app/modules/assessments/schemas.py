from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StrictInt, model_validator

FORM_LENGTHS: dict[str, int] = {"phq9": 9, "gad7": 7}


class AssessmentCreate(BaseModel):
    client_request_id: UUID | None = None
    form_type: Literal["phq9", "gad7"]
    form_version: str = "v1"
    answers: list[StrictInt] = Field(min_length=1, max_length=9)

    @model_validator(mode="after")
    def check_answers(self) -> "AssessmentCreate":
        expected = FORM_LENGTHS[self.form_type]
        if len(self.answers) != expected:
            raise ValueError(f"{self.form_type} requires exactly {expected} answers")
        if any(type(a) is not int or not 0 <= a <= 3 for a in self.answers):
            raise ValueError("each answer must be between 0 and 3")
        return self


class AssessmentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    patient_id: int
    form_type: str
    form_version: str
    answers: list[int]
    score: int
    risk_flags: list[str]
    created_at: datetime
