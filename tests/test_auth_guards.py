import asyncio
from datetime import datetime, timedelta, timezone
from threading import Event

import jwt
from sqlalchemy import text

from app.core.config import get_settings
from app.core import security
import app.modules.access.router as access_router


def auth(token):
    return {"Authorization": "Bearer " + token}


def bad_password(monkeypatch):
    calls = []
    def verify(*_):
        calls.append(True)
        return False
    monkeypatch.setattr(access_router, "verify_password", verify)
    return calls


async def test_two_new_sessions_are_distinct_even_with_the_same_issue_time(client, accounts, monkeypatch):
    fixed = datetime.now(timezone.utc).replace(microsecond=0)
    class FrozenDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            return fixed
    monkeypatch.setattr(security, "datetime", FrozenDateTime)
    first = security.create_access_token(accounts['doctor'].id, 'doctor')
    second = security.create_access_token(accounts['doctor'].id, 'doctor')
    distinct = first != second
    assert distinct, 'Independent sessions need independent credentials, including in the same second'
    for token in (first, second):
        assert (await client.get('/auth/me', headers=auth(token))).status_code == 200


async def test_logout_revokes_only_its_credential_and_is_idempotent(client, headers, database):
    first, second = headers('doctor'), headers('doctor')
    response = await client.post('/auth/logout', headers=first, json={})
    assert response.status_code == 200
    assert response.json() == {'revoked': True}
    assert (await client.get('/auth/me', headers=first)).status_code == 401
    assert (await client.get('/patients', headers=first)).status_code == 401
    assert (await client.get('/auth/me', headers=second)).status_code == 200
    assert (await client.post('/auth/logout', headers=first, json={})).status_code == 200
    async with database() as session:
        assert await session.scalar(text('SELECT count(*) FROM revoked_access_tokens')) == 1
        assert await session.scalar(text("SELECT count(*) FROM audit_events WHERE event_type='auth.logged_out'")) == 1
        fingerprints = (await session.execute(text('SELECT token_hash FROM revoked_access_tokens'))).scalars().all()
    assert all(len(value) == 64 and value not in first['Authorization'] for value in fingerprints)


async def test_logout_cannot_target_another_user_through_the_body(client, headers):
    caller, other = headers('doctor'), headers('patient2')
    response = await client.post('/auth/logout', headers=caller, json={'token':other['Authorization'].split(' ',1)[1]})
    assert response.status_code == 200
    assert (await client.get('/auth/me', headers=caller)).status_code == 401
    assert (await client.get('/auth/me', headers=other)).status_code == 200


async def test_previous_token_format_without_jti_remains_usable_then_revocable(client, accounts):
    settings = get_settings()
    now = datetime.now(timezone.utc)
    token = jwt.encode({'sub':str(accounts['doctor'].id),'role':'doctor','iat':now,'exp':now+timedelta(minutes=10)},settings.jwt_secret,algorithm=settings.jwt_algorithm)
    assert (await client.get('/auth/me', headers=auth(token))).status_code == 200
    assert (await client.post('/auth/logout', headers=auth(token), json={})).status_code == 200
    assert (await client.get('/auth/me', headers=auth(token))).status_code == 401


async def test_logout_rejects_missing_invalid_and_expired_credentials(client, accounts, database):
    settings = get_settings()
    now = datetime.now(timezone.utc)
    expired = jwt.encode({'sub':str(accounts['doctor'].id),'iat':now-timedelta(hours=2),'exp':now-timedelta(hours=1)},settings.jwt_secret,algorithm=settings.jwt_algorithm)
    for credential in (None, 'not-a-token', expired):
        response = await client.post('/auth/logout', headers={} if credential is None else auth(credential), json={})
        assert response.status_code == 401
    async with database() as session:
        assert await session.scalar(text('SELECT count(*) FROM revoked_access_tokens')) == 0


async def test_login_limit_is_persistent_and_does_not_trust_forwarded_headers(client, monkeypatch, database):
    calls = bad_password(monkeypatch)
    limit = getattr(get_settings(), 'auth_login_max_attempts', 10)
    for _ in range(limit):
        assert (await client.post('/auth/login', json={'username':'doctor','password':'wrong'})).status_code == 401
    blocked = await client.post('/auth/login', headers={'X-Forwarded-For':'203.0.113.91'}, json={'username':'doctor','password':'wrong'})
    assert blocked.status_code == 429
    assert int(blocked.headers['retry-after']) > 0
    assert len(calls) == limit, 'An exhausted bucket must stop expensive password checks'
    async with database() as session:
        rows = (await session.execute(text('SELECT bucket_key, attempts FROM auth_login_buckets'))).all()
    assert len(rows) == 1 and rows[0].attempts == limit
    assert len(rows[0].bucket_key) == 64 and 'doctor' not in rows[0].bucket_key


async def test_concurrent_login_attempts_cannot_overrun_the_limit(client, monkeypatch):
    calls = bad_password(monkeypatch)
    limit = getattr(get_settings(), 'auth_login_max_attempts', 10)
    responses = await asyncio.gather(*(client.post('/auth/login',json={'username':'absent','password':'wrong'}) for _ in range(limit+6)))
    codes = [response.status_code for response in responses]
    assert codes.count(401) == limit and codes.count(429) == 6
    assert len(calls) == limit


async def test_successful_login_resets_its_bucket_without_blocking_other_users(client, monkeypatch, database):
    original = access_router.verify_password
    bad_password(monkeypatch)
    for _ in range(2):
        assert (await client.post('/auth/login',json={'username':'doctor','password':'wrong'})).status_code == 401
    monkeypatch.setattr(access_router,'verify_password',original)
    assert (await client.post('/auth/login',json={'username':'doctor','password':'test-pass-123'})).status_code == 200
    assert (await client.post('/auth/login',json={'username':'patient2','password':'test-pass-123'})).status_code == 200
    async with database() as session:
        assert await session.scalar(text('SELECT count(*) FROM auth_login_buckets')) == 0


async def test_expired_login_window_allows_a_new_attempt(client, monkeypatch, database):
    original = access_router.verify_password
    bad_password(monkeypatch)
    settings = get_settings()
    limit = getattr(settings,'auth_login_max_attempts',10)
    for _ in range(limit):
        await client.post('/auth/login',json={'username':'doctor','password':'wrong'})
    assert (await client.post('/auth/login',json={'username':'doctor','password':'wrong'})).status_code == 429
    async with database() as session:
        await session.execute(text('UPDATE auth_login_buckets SET window_started_at=:before'),{'before':datetime.now(timezone.utc)-timedelta(seconds=getattr(settings,'auth_login_window_seconds',300)+1)})
        await session.commit()
    monkeypatch.setattr(access_router,'verify_password',original)
    assert (await client.post('/auth/login',json={'username':'doctor','password':'test-pass-123'})).status_code == 200


async def test_password_check_does_not_block_other_authenticated_requests(client, headers, monkeypatch):
    started, release, finished = Event(), Event(), Event()
    def blocking_verify(*_):
        started.set()
        release.wait(timeout=3)
        finished.set()
        return False
    monkeypatch.setattr(access_router,'verify_password',blocking_verify)
    request = asyncio.create_task(client.post('/auth/login',json={'username':'doctor','password':'wrong'}))
    try:
        assert await asyncio.to_thread(started.wait,2)
        response = await client.get('/auth/me',headers=headers('doctor'))
        assert response.status_code == 200
        assert not finished.is_set(), 'Password verification must not freeze the event loop until it finishes'
    finally:
        release.set()
        await request
