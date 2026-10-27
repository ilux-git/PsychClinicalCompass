"""Read-only synthetic MIS snapshots, not a live integration or a clinical rule base."""
import json
import os
from functools import lru_cache
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field, PrivateAttr, model_validator
from sqlalchemy import select
from app.modules.assessments.scenarios import scenario_for_mis, scenario_catalog

PATH = Path(os.environ.get("SYNTHETIC_MIS_FIXTURE_PATH", str(Path(__file__).with_name("fixtures") / "mis_v1.json")))


class Snapshot(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schema_version: str
    synthetic: bool
    as_of: str
    patients: list[dict]
    limitations: list[str]
    _patients_by_mis: dict = PrivateAttr(default_factory=dict)

    @model_validator(mode="after")
    def validate_synthetic(self):
        ids = [p["mis_id"] for p in self.patients]
        if not self.synthetic or len(ids) != len(set(ids)):
            raise ValueError("Expected unique synthetic MIS identities")
        self._patients_by_mis = {p["mis_id"]: p for p in self.patients}
        return self


@lru_cache
def snapshot() -> Snapshot:
    return Snapshot.model_validate_json(PATH.read_text(encoding="utf-8"))


def patient_snapshot(mis_id: int | None) -> dict:
    data = snapshot()
    patient = data._patients_by_mis.get(mis_id)
    case=scenario_for_mis(mis_id) if patient is None else None
    if case:
        patient={"mis_id":case["mis_id"],"scenario":{"code":case["key"],"title":f'{case["source_id"]} · {case["title"]}',
            "description":case["history"],"expected_route":"Гипотеза → решение врача → действие → проверка"},
            "visits":[],"medications":[],"age":case["age"],"sex":case["sex"],"diagnoses":case["diagnoses"],
            "prescriptions":case["current_prescriptions"],"source":"supplied_scenario_json"}
    # Deep copy: callers must not mutate the cached source.
    return {"source": "synthetic_mis_json", "schema_version": data.schema_version,
            "as_of": scenario_catalog()["as_of"] if case else data.as_of, "synthetic": True, "read_only": True,
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
