from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select

from app.api.deps import CompassSession, CurrentUser, require_role
from app.core.security import create_access_token, verify_password
from app.modules.access.models import User, UserRole
from app.modules.access.schemas import AvailabilityUpdate, LoginRequest
from app.modules.audit.service import record_event
from app.modules.patients.models import Patient

router = APIRouter(tags=["access"])


async def user_profile(session: CompassSession, user: User) -> dict:
    patient_id = await session.scalar(select(Patient.id).where(Patient.user_id == user.id))
    return {"id": user.id, "username": user.username, "display_name": user.display_name,
            "role": user.role.value, "patient_id": patient_id, "availability": user.availability}


@router.post("/auth/login")
async def login(payload: LoginRequest, session: CompassSession) -> dict:
    user = await session.scalar(select(User).where(User.username == payload.username.strip().lower()))
    if user is None or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(401, "Неверный логин или пароль")
    return {"access_token": create_access_token(user.id, user.role.value), "token_type": "bearer",
            "user": await user_profile(session, user)}


@router.get("/auth/me")
async def me(session: CompassSession, user: CurrentUser) -> dict:
    return await user_profile(session, user)


@router.patch("/doctors/me/availability")
async def availability(payload: AvailabilityUpdate, session: CompassSession,
                       user: User = Depends(require_role([UserRole.doctor]))) -> dict:
    user.availability = payload.availability
    record_event(session, user.id, None, "doctor.availability_changed", "user", user.id,
                 {"availability": payload.availability})
    await session.commit()
    return {"availability": user.availability}
