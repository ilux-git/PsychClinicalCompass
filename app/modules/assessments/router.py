from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select

from app.api.deps import CompassSession, CurrentUser, require_role
from app.modules.access.models import User, UserRole
from app.modules.assessments.models import QuestionnaireResponse
from app.modules.assessments.schemas import AssessmentCreate, AssessmentRead
from app.modules.assessments.service import save_response
from app.modules.patients.models import Patient

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
    response = await save_response(session, patient.id, payload.form_type, payload.form_version, payload.answers)
    await session.commit()
    return response
