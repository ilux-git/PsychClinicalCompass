from datetime import datetime, timezone
from typing import Annotated

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from starlette.concurrency import run_in_threadpool

from app.api.deps import CompassSession, CurrentUser, bearer_scheme, require_role
from app.core.security import create_access_token, decode_token, hash_password, token_fingerprint, verify_password
from app.modules.access.guards import clear_login_attempts, reserve_login_attempt
from app.modules.access.models import RevokedAccessToken, User, UserRole
from app.modules.access.schemas import AvailabilityUpdate, LoginRequest
from app.modules.audit.service import record_event
from app.modules.patients.models import Patient
from app.modules.assessments.scenarios import scenario_label

router = APIRouter(tags=["access"])
# Not an account or a usable credential; unknown usernames still receive a bcrypt check.
DUMMY_PASSWORD_HASH = hash_password("unavailable-account-placeholder")


async def user_profile(session: CompassSession, user: User) -> dict:
    patient = await session.scalar(select(Patient).where(Patient.user_id == user.id))
    return {"id": user.id, "username": user.username, "display_name": user.display_name,
            "role": user.role.value, "patient_id": patient.id if patient else None, "availability": user.availability,
            "scenario_label":scenario_label(patient.mis_id) if patient else None}


async def authenticate_password(payload: LoginRequest, request: Request, session: CompassSession) -> tuple[User, str]:
    bucket = await reserve_login_attempt(session, payload.username, request.client.host if request.client else "unknown")
    user = await session.scalar(select(User).where(User.username == payload.username.strip().lower()))
    password_ok = await run_in_threadpool(verify_password, payload.password, user.hashed_password if user else DUMMY_PASSWORD_HASH)
    if user is None or not password_ok or not user.is_active:
        raise HTTPException(401, "Неверный логин или пароль")
    return user, bucket


@router.post("/auth/login")
async def login(payload: LoginRequest, request: Request, session: CompassSession) -> dict:
    user, bucket = await authenticate_password(payload, request, session)
    profile = await user_profile(session, user)
    await clear_login_attempts(session, bucket)
    await session.commit()
    return {"access_token": create_access_token(user.id, user.role.value), "token_type": "bearer",
            "user": profile}


@router.post("/auth/logout")
async def logout(session: CompassSession,
                 credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)]) -> dict:
    if credentials is None:
        raise HTTPException(401, "Необходима действующая сессия")
    try:
        payload = decode_token(credentials.credentials)
        subject = payload["sub"]
        if not isinstance(subject, str) or not subject.isdigit():
            raise ValueError("Invalid subject")
        expires_at = datetime.fromtimestamp(float(payload["exp"]), timezone.utc)
    except (jwt.InvalidTokenError, ValueError, TypeError, OverflowError):
        raise HTTPException(401, "Неверная или истёкшая сессия") from None
    user = await session.get(User, int(subject))
    if user is None:
        raise HTTPException(401, "Неверная или истёкшая сессия")
    # Do not use CurrentUser here: a repeated logout must still succeed for a revoked token.
    statement = insert(RevokedAccessToken).values(token_hash=token_fingerprint(credentials.credentials), expires_at=expires_at)
    statement = statement.on_conflict_do_nothing(index_elements=[RevokedAccessToken.token_hash]).returning(RevokedAccessToken.token_hash)
    if await session.scalar(statement):
        record_event(session, user.id, None, "auth.logged_out", "user", user.id, {"scope":"current_credential"})
    await session.commit()
    return {"revoked":True}


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
