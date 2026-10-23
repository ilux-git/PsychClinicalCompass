"""Read-only synthetic MIS snapshots, not a live integration or a clinical rule base."""
import json
from functools import lru_cache
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import select

PATH = Path(__file__).with_name("fixtures") / "mis_v1.json"


class Snapshot(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schema_version: str
    synthetic: bool
    as_of: str
    patients: list[dict]
    limitations: list[str]

    @model_validator(mode="after")
    def validate_synthetic(self):
        ids = [p["mis_id"] for p in self.patients]
        if not self.synthetic or len(ids) != len(set(ids)):
            raise ValueError("Expected unique synthetic MIS identities")
        return self


@lru_cache
def snapshot() -> Snapshot:
    return Snapshot.model_validate_json(PATH.read_text(encoding="utf-8"))


def patient_snapshot(mis_id: int | None) -> dict:
    data = snapshot()
    patient = next((p for p in data.patients if p["mis_id"] == mis_id), None)
    # Deep copy: callers must not mutate the cached source.
    return {"source": "synthetic_mis_json", "schema_version": data.schema_version,
            "as_of": data.as_of, "synthetic": True, "read_only": True,
            "status": "available" if patient else "not_linked",
            "data": json.loads(json.dumps(patient)) if patient else None,
            "limitations": data.limitations}


async def linked_snapshot(session, patient):
    from app.modules.patients.models import PatientMapping
    mapping = await session.scalar(select(PatientMapping).where(PatientMapping.compass_patient_id == patient.id))
    if mapping is None or mapping.mis_id != patient.mis_id:
        data = patient_snapshot(None)
        data["status"] = "not_linked" if mapping is None else "mapping_conflict"
        return data
    return patient_snapshot(mapping.mis_id)
