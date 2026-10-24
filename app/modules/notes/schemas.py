from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator
from app.modules.analytics.dimensions import ObservationDimension


class NoteWrite(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    source_type: Literal["manual", "message", "assessment", "survey_submission", "adherence_report", "alert", "medication_log", "diary_entry"] = "manual"
    source_id: int | None = Field(default=None, gt=0)
    dimension: ObservationDimension | None = None

    @model_validator(mode="after")
    def valid_source(self) -> "NoteWrite":
        if not self.text.strip():
            raise ValueError("Заметка не может быть пустой")
        if (self.source_type == "manual") != (self.source_id is None):
            raise ValueError("Укажите источник и его ID вместе")
        return self


class TaskWrite(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    due_at: datetime | None = None
    client_request_id: UUID | None = None
    assigned_to_id: int | None = Field(default=None, gt=0)
    kind: Literal["clinical", "organization"] = "clinical"
    source_type: Literal["manual", "message", "assessment", "survey_submission", "adherence_report", "alert", "doctor_note", "medication_log", "diary_entry"] = "manual"
    source_id: int | None = Field(default=None, gt=0)
    follow_up_at: datetime | None = None

    @model_validator(mode="after")
    def valid_task(self) -> "TaskWrite":
        if not self.title.strip() or any(t and t.tzinfo is None for t in (self.due_at, self.follow_up_at)):
            raise ValueError("Нужны название и корректный часовой пояс срока")
        if (self.source_type == "manual") != (self.source_id is None):
            raise ValueError("Укажите источник и его ID вместе")
        self.title = self.title.strip()
        return self


class TaskStatus(BaseModel):
    status: Literal["open", "in_progress", "done"]
    action_result: str | None = Field(default=None, max_length=2000)
    expected_revision: int | None = Field(default=None, ge=0)


class TaskVerification(BaseModel):
    status: Literal["resolved", "not_resolved", "unknown"]
    comment: str = Field(min_length=1, max_length=2000)
    expected_revision: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def not_blank(self):
        if not self.comment.strip():
            raise ValueError("Укажите основание проверки результата")
        self.comment = self.comment.strip()
        return self
