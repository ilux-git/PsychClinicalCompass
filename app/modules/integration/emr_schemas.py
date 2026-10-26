from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StrictBool, model_validator


class ExactContentConfirmation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    content_hash: str = Field(pattern=r"^[0-9a-f]{64}$")
    confirmed: StrictBool

    @model_validator(mode="after")
    def explicit_confirmation(self):
        if self.confirmed is not True:
            raise ValueError("Нужно явно подтвердить содержимое")
        return self


class EmrApproval(ExactContentConfirmation):
    task_id: int = Field(gt=0)
    expected_task_revision: int = Field(ge=0)
    client_request_id: UUID
