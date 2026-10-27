from datetime import datetime, timedelta, timezone
from typing import Any
from hashlib import sha256
from uuid import uuid4

import bcrypt
import jwt

from app.core.config import get_settings


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode(), hashed.encode())
    except ValueError:
        return False


def create_access_token(subject: str | int, role: str, *, telegram_binding_id: int | None = None) -> str:
    settings = get_settings()
    now = datetime.now(timezone.utc)
    payload: dict[str, Any] = {
        "sub": str(subject),
        "role": role,
        "iat": now,
        "exp": now + timedelta(minutes=settings.jwt_expires_minutes),
        "jti": str(uuid4()),
    }
    if telegram_binding_id is not None:
        payload.update({"auth_provider": "telegram", "tg_binding_id": telegram_binding_id})
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_token(token: str) -> dict[str, Any]:
    settings = get_settings()
    if len(token) > 8192:
        raise jwt.InvalidTokenError("Token exceeds the accepted credential size")
    return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm],
                      options={"require": ["sub", "iat", "exp"]})


def token_fingerprint(token: str) -> str:
    return sha256(token.encode("utf-8")).hexdigest()
