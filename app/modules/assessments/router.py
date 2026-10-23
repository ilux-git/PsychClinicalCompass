from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select

from app.api.deps import CompassSession, CurrentUser, require_role
from app.modules.access.models import User, UserRole
from app.modules.assessments.models import QuestionnaireResponse
from app.modules.assessments.schemas import AssessmentCreate, AssessmentRead
from app.modules.assessments.service import save_response
from app.modules.patients.models import Patient
from app.modules.adherence.rewards import grant_points

router = APIRouter(prefix="/assessments", tags=["assessments"])


async def _get_patient_for_user(session: CompassSession, user: User) -> Patient:
    result = await session.execute(select(Patient).where(Patient.user_id == user.id))
    patient = result.scalar_one_or_none()
    if patient is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No patient record linked to this user")
    return patient


@router.post("/responses", response_model=AssessmentRead, status_code=status.HTTP_201_CREATED)
async def submit_response(
    payload: AssessmentCreate,
    session: CompassSession,
    user: User = Depends(require_role([UserRole.patient])),
) -> QuestionnaireResponse:
    patient = await _get_patient_for_user(session, user)
    await session.scalar(select(Patient).where(Patient.id == patient.id).with_for_update())
    previous = await session.scalar(select(QuestionnaireResponse.id).where(
        QuestionnaireResponse.patient_id == patient.id, QuestionnaireResponse.client_request_id == str(payload.client_request_id))) if payload.client_request_id else None
    response = await save_response(session, patient.id, payload.form_type, payload.form_version, payload.answers,
                                   str(payload.client_request_id) if payload.client_request_id else None, user.id)
    if previous is None:
        await grant_points(session, patient.id, "survey", f"assessment:{response.id}", user.id, len(payload.answers))
    await session.commit()
    return response
