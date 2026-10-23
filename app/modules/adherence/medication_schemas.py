from datetime import date
import re
from typing import Literal
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt, field_validator, model_validator


class MedicationContent(BaseModel):
    model_config = ConfigDict(extra="forbid")
    label: str = Field(min_length=1, max_length=300)
    instructions: str = Field(default="", max_length=2000)
    schedule_text: str = Field(min_length=1, max_length=1500)
    schedule_kind: Literal["fixed", "as_needed", "description"]
    times: list[str] = Field(default_factory=list, max_length=48)
    weekdays: list[StrictInt] = Field(default_factory=list, max_length=7)
    timezone: str = Field(max_length=80)
    starts_on: date
    ends_on: date | None = None
    active: StrictBool = True

    @field_validator("label", "schedule_text")
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError("Нужно название и описание расписания")
        return value.strip()

    @model_validator(mode="after")
    def validate_schedule(self):
        try:
            ZoneInfo(self.timezone)
        except (ZoneInfoNotFoundError, ValueError):
            raise ValueError("Неизвестный часовой пояс")
        if self.ends_on and self.ends_on < self.starts_on:
            raise ValueError("Дата окончания раньше начала")
        if any(type(day) is not int or day not in range(7) for day in self.weekdays):
            raise ValueError("Дни недели: числа от 0 до 6")
        if len(set(self.weekdays)) != len(self.weekdays) or len(set(self.times)) != len(self.times):
            raise ValueError("Не повторяйте дни и времена")
        if any(not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", t) for t in self.times):
            raise ValueError("Время должно быть в формате ЧЧ:ММ")
        if self.schedule_kind == "fixed" and (not self.times or not self.weekdays):
            raise ValueError("Для фиксированного расписания нужны дни и времена")
        if self.schedule_kind != "fixed" and (self.times or self.weekdays):
            raise ValueError("Свободное расписание хранится описанием; автоматические события не создаются")
        self.times.sort(); self.weekdays.sort()
        return self


class MedicationCreate(MedicationContent):
    client_request_id: UUID


class MedicationEdit(MedicationContent):
    expected_revision: int = Field(ge=1)


class MedicationReport(BaseModel):
    model_config = ConfigDict(extra="forbid")
    client_request_id: UUID
    item_key: str = Field(min_length=1, max_length=80)
    day: date
    occurrence_key: str = Field(min_length=1, max_length=120)
    status: Literal["taken", "not_taken", "unknown", "not_applicable"]
    reason: str = Field(default="", max_length=2000)


class MedicationReportEdit(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_revision: int = Field(ge=1)
    status: Literal["taken", "not_taken", "unknown", "not_applicable"]
    reason: str = Field(default="", max_length=2000)
