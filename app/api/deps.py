from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import exists, select

from app.core.security import decode_token, token_fingerprint
from app.db.session import async_session_compass
from app.modules.access.models import RevokedAccessToken, User, UserRole
from app.modules.patients.models import Patient

bearer_scheme = HTTPBearer(auto_error=False)


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
    user = await session.scalar(select(User).where(User.id == int(sub),
        ~exists().where(RevokedAccessToken.token_hash == token_fingerprint(credentials.credentials))))
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    request.state.read_audit_actor = (user.id, user.role.value)
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


async def patient_for_user(session: AsyncSession, user: User, patient_id: int) -> Patient:
    if user.role not in {UserRole.doctor, UserRole.patient}:
        raise HTTPException(403, "Нет клинического доступа")
    query = select(Patient).where(Patient.id == patient_id)
    if user.role == UserRole.doctor:
        query = query.where(Patient.doctor_id == user.id)
    else:
        query = query.where(Patient.user_id == user.id)
    patient = await session.scalar(query)
    if patient is None:
        raise HTTPException(404, "Пациент не найден или недоступен")
    return patient


def require_role(roles: list[UserRole]) -> Callable[[User], Awaitable[User]]:
    async def checker(user: CurrentUser) -> User:
        if user.role not in roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient role")
        return user

    return checker
