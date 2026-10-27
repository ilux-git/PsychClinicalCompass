from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import bindparam, exists, select

from app.core.security import decode_token, token_fingerprint
from app.db.session import async_session_compass
from app.modules.access.models import RevokedAccessToken, User, UserRole
from app.modules.patients.models import Patient

bearer_scheme = HTTPBearer(auto_error=False)

# Reuse statement structure, never user or authorization results. Every request
# still checks current activation, token revocation and patient ownership in SQL.
_CURRENT_USER = select(User).where(User.id == bindparam("authenticated_user_id"), User.is_active.is_(True),
    ~exists().where(RevokedAccessToken.token_hash == bindparam("authenticated_token_hash")))
_SCOPED_PATIENT = {
    UserRole.doctor: select(Patient).where(Patient.id == bindparam("requested_patient_id"),
        Patient.doctor_id == bindparam("scope_user_id")),
    UserRole.patient: select(Patient).where(Patient.id == bindparam("requested_patient_id"),
        Patient.user_id == bindparam("scope_user_id")),
}


async def get_compass_session() -> AsyncIterator[AsyncSession]:
    async with async_session_compass() as session:
        yield session


CompassSession = Annotated[AsyncSession, Depends(get_compass_session, scope="function")]


async def get_current_user(
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    session: CompassSession,
) -> User:
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    try:
        payload = decode_token(credentials.credentials)
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    sub = payload.get("sub")
    if not isinstance(sub, str) or not sub.isdigit():
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    if 'auth_provider' in payload or 'tg_binding_id' in payload:
        # Password-only Mini App access retires every binding-derived session.
        raise HTTPException(401, "Войдите заново по логину и паролю")
    user = await session.scalar(_CURRENT_USER, {"authenticated_user_id": int(sub),
        "authenticated_token_hash": token_fingerprint(credentials.credentials)})
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    request.state.read_audit_actor = (user.id, user.role.value)
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def patient_read_queries(statement):
    """Scope a Patient-anchored outer join, retaining one row for empty histories."""
    return {role: statement.where(Patient.id == bindparam("requested_patient_id"),
                column == bindparam("scope_user_id"))
            for role, column in ((UserRole.doctor, Patient.doctor_id), (UserRole.patient, Patient.user_id))}


async def patient_read_rows(session: AsyncSession, user: User, patient_id: int, queries, *, parameters=None):
    if user.role not in queries:
        raise HTTPException(403, "Нет клинического доступа")
    rows = (await session.execute(queries[user.role],
        {**(parameters or {}), "requested_patient_id": patient_id, "scope_user_id": user.id})).all()
    if not rows:
        raise HTTPException(404, "Пациент не найден или недоступен")
    return rows


async def patient_for_user(session: AsyncSession, user: User, patient_id: int) -> Patient:
    if user.role not in {UserRole.doctor, UserRole.patient}:
        raise HTTPException(403, "Нет клинического доступа")
    patient = await session.scalar(_SCOPED_PATIENT[user.role],
        {"requested_patient_id": patient_id, "scope_user_id": user.id})
    if patient is None:
        raise HTTPException(404, "Пациент не найден или недоступен")
    return patient


def require_role(roles: list[UserRole]) -> Callable[[User], Awaitable[User]]:
    async def checker(user: CurrentUser) -> User:
        if user.role not in roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient role")
        return user

    return checker
