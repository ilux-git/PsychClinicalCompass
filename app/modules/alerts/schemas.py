from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class DecisionWrite(BaseModel):
    action: Literal["confirmed", "declined"]
    expected_version: int = Field(ge=1)
    reason: str = Field(default="", max_length=2000)
