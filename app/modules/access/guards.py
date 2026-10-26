"""Durable per-credential-attempt budgets, independent of API worker memory."""
from datetime import datetime, timedelta, timezone
from hashlib import sha256
import hmac
import json
from math import ceil

from fastapi import HTTPException
from sqlalchemy import case, delete, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.modules.access.models import AuthLoginBucket


async def reserve_login_attempt(session: AsyncSession, username: str, peer: str) -> str:
    settings = get_settings()
    identity = json.dumps([username.strip().lower(), peer], ensure_ascii=True, separators=(",", ":"))
    bucket_key = hmac.new(settings.jwt_secret.encode(), identity.encode(), sha256).hexdigest()
    now = datetime.now(timezone.utc)
    expired = AuthLoginBucket.window_started_at <= now - timedelta(seconds=settings.auth_login_window_seconds)
    statement = insert(AuthLoginBucket).values(bucket_key=bucket_key, attempts=1, window_started_at=now)
    statement = statement.on_conflict_do_update(index_elements=[AuthLoginBucket.bucket_key],
        set_={"attempts":case((expired, 1), else_=AuthLoginBucket.attempts+1),
              "window_started_at":case((expired, now), else_=AuthLoginBucket.window_started_at)},
        where=or_(expired, AuthLoginBucket.attempts < settings.auth_login_max_attempts)).returning(AuthLoginBucket.attempts)
    reserved = await session.scalar(statement)
    if reserved is None:
        started = await session.scalar(select(AuthLoginBucket.window_started_at).where(AuthLoginBucket.bucket_key == bucket_key))
        retry_after = max(1, ceil(((started or now)+timedelta(seconds=settings.auth_login_window_seconds)-now).total_seconds()))
        await session.commit()
        raise HTTPException(429, "Слишком много попыток входа. Повторите позднее.", headers={"Retry-After":str(retry_after)})
    # Reserve before bcrypt so concurrent attempts cannot all pass a stale counter.
    await session.commit()
    return bucket_key


async def clear_login_attempts(session: AsyncSession, bucket_key: str) -> None:
    await session.execute(delete(AuthLoginBucket).where(AuthLoginBucket.bucket_key == bucket_key))
