from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class NoteWrite(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    source_type: Literal["manual", "message", "assessment", "survey_submission", "adherence_report", "alert"] = "manual"
    source_id: int | None = Field(default=None, gt=0)

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

    @model_validator(mode="after")
    def valid_task(self) -> "TaskWrite":
        if not self.title.strip() or (self.due_at and self.due_at.tzinfo is None):
            raise ValueError("Нужны название и корректный часовой пояс срока")
        return self


class TaskStatus(BaseModel):
    status: Literal["open", "done"]
