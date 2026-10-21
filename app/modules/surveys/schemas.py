from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator


class Choice(BaseModel):
    id: str = Field(pattern=r"^[a-z][a-z0-9_]{0,39}$")
    label: str = Field(min_length=1, max_length=180)


class Question(BaseModel):
    id: str = Field(pattern=r"^[a-z][a-z0-9_]{0,39}$")
    prompt: str = Field(min_length=1, max_length=500)
    kind: Literal["single", "multiple", "text", "scale"]
    required: bool = True
    options: list[Choice] = Field(default_factory=list, max_length=20)
    minimum: int = Field(default=0, ge=-100, le=100)
    maximum: int = Field(default=10, ge=-100, le=100)

    @model_validator(mode="after")
    def validate_question(self) -> "Question":
        if not self.prompt.strip():
            raise ValueError("Вопрос не может быть пустым")
        if self.kind in {"single", "multiple"}:
            if len(self.options) < 2 or len({o.id for o in self.options}) != len(self.options):
                raise ValueError("Нужно минимум два варианта с разными ID")
            if any(not o.label.strip() for o in self.options):
                raise ValueError("Вариант не может быть пустым")
        elif self.options:
            raise ValueError("Варианты допустимы только для вопроса с выбором")
        if self.kind == "scale" and self.minimum >= self.maximum:
            raise ValueError("Минимум шкалы должен быть меньше максимума")
        return self


class SurveyWrite(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=2000)
    purpose: Literal["barriers", "experience", "continuation", "follow_up", "custom"] = "custom"
    questions: list[Question] = Field(min_length=1, max_length=30)

    @model_validator(mode="after")
    def unique_questions(self) -> "SurveyWrite":
        if not self.title.strip() or len({q.id for q in self.questions}) != len(self.questions):
            raise ValueError("Нужны название и уникальные ID вопросов")
        return self


class AssignSurvey(BaseModel):
    patient_ids: list[int] = Field(min_length=1, max_length=100)
    client_request_id: UUID
    due_at: datetime | None = None

    @model_validator(mode="after")
    def valid_assignment(self) -> "AssignSurvey":
        if len(set(self.patient_ids)) != len(self.patient_ids) or any(p <= 0 for p in self.patient_ids):
            raise ValueError("Укажите разных пациентов")
        if self.due_at is not None and self.due_at.tzinfo is None:
            raise ValueError("Для срока требуется часовой пояс")
        return self


class SubmitSurvey(BaseModel):
    answers: dict = Field(max_length=30)
