from fastapi import APIRouter, Depends
from sqlalchemy import select
from pydantic import BaseModel, ConfigDict, Field, StrictInt, field_validator

from app.api.deps import CompassSession, CurrentUser, patient_for_user, patient_read_queries, patient_read_rows, require_role
from app.modules.access.models import User, UserRole
from app.modules.assessments.catalog import catalog
from app.modules.assessments.clinical_models import ClinicalBaseline, ClinicalResult
from app.modules.assessments.clinical_service import baseline_read, ensure_clinical_survey, select_baseline
from app.modules.assessments.catalog import instrument
from app.modules.surveys.models import SurveySubmission
from app.modules.surveys.service import survey_read
from app.modules.patients.models import Patient

router = APIRouter(tags=["clinical-instruments"])
Doctor = Depends(require_role([UserRole.doctor]))
_RESULT_HISTORY = patient_read_queries(select(Patient.id.label("scope_patient_id"), ClinicalResult.id,
    ClinicalResult.patient_id, ClinicalResult.submission_id, ClinicalResult.instrument_key,
    ClinicalResult.definition, ClinicalResult.score, ClinicalResult.result, ClinicalResult.created_at,
    SurveySubmission.answers, SurveySubmission.id.label("response_source_id")).select_from(Patient).outerjoin(
    ClinicalResult, ClinicalResult.patient_id == Patient.id).outerjoin(
    SurveySubmission, SurveySubmission.id == ClinicalResult.submission_id).order_by(
    ClinicalResult.created_at, ClinicalResult.id))


class BaselineWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")
    result_id: StrictInt | None = Field(gt=0)
    expected_revision: StrictInt = Field(ge=0)
    reason: str = Field(min_length=1, max_length=500)

    @field_validator("reason")
    @classmethod
    def nonblank_reason(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Укажите основание выбора исходного измерения")
        return value.strip()


@router.get("/clinical-instruments")
async def instruments(doctor: User = Doctor) -> list[dict]:
    return catalog()


@router.post("/clinical-instruments/{key}/survey")
async def add_instrument(key: str, session: CompassSession, doctor: User = Doctor) -> dict:
    survey = await ensure_clinical_survey(session, doctor, key)
    await session.commit()
    return survey_read(survey)


@router.get("/patients/{patient_id}/clinical-results")
async def results(patient_id: int, session: CompassSession, user: CurrentUser) -> list[dict]:
    rows = await patient_read_rows(session, user, patient_id, _RESULT_HISTORY)
    return [{"id": row.id, "patient_id": row.patient_id, "submission_id": row.submission_id,
        "instrument_key": row.instrument_key, "definition": row.definition, "score": row.score,
        "result": row.result, "answers": row.answers, "created_at": row.created_at}
        for row in rows if row.id is not None and row.response_source_id is not None]


@router.get("/patients/{patient_id}/clinical-baselines/{key}")
async def get_baseline(patient_id: int, key: str, session: CompassSession, doctor: User = Doctor) -> dict:
    await patient_for_user(session, doctor, patient_id)
    instrument(key)
    row = await session.scalar(select(ClinicalBaseline).where(
        ClinicalBaseline.patient_id == patient_id, ClinicalBaseline.instrument_key == key))
    return baseline_read(row, key)


@router.put("/patients/{patient_id}/clinical-baselines/{key}")
async def put_baseline(patient_id: int, key: str, payload: BaselineWrite,
                       session: CompassSession, doctor: User = Doctor) -> dict:
    value = await select_baseline(session, doctor, patient_id, key, payload.result_id,
                                  payload.expected_revision, payload.reason)
    await session.commit()
    return value
