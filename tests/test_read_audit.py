import asyncio
from contextlib import AsyncExitStack
import json
from uuid import UUID

import httpx
import pytest
from fastapi import FastAPI
from starlette.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.deps import CurrentUser
from app.core.config import get_settings
from app.modules.audit.models import ReadAccessEvent


async def history(database):
    async with database() as session:
        return (await session.scalars(select(ReadAccessEvent).order_by(ReadAccessEvent.id))).all()


async def test_allowed_read_records_verified_actor_and_template_without_response_content(client, headers, accounts, database):
    response = await client.get("/patients/1/assessments", headers=headers("doctor"))
    assert response.status_code == 200
    rows = await history(database)
    assert len(rows) == 1
    row = rows[0]
    assert (row.actor_id, row.actor_role, row.route, row.resource_ids, row.http_status) == (
        accounts["doctor"].id, "doctor", "/patients/{patient_id}/assessments", {"patient_id":1}, 200)
    assert row.created_at is not None and UUID(row.request_id).version == 4
    assert response.headers["cache-control"] == "no-store"


@pytest.mark.parametrize("actor,path,status", [
    ("doctor", "/patients/2/assessments", 404),
    ("admin", "/patients/1/assessments", 403),
    ("patient1", "/patients/1/notes", 403),
    ("doctor", "/patients/not-a-number/assessments", 422),
])
async def test_denied_and_invalid_requests_preserve_the_actual_http_outcome(client, headers, accounts, database, actor, path, status):
    response = await client.get(path, headers=headers(actor))
    assert response.status_code == status
    rows = await history(database)
    assert len(rows) == 1
    assert (rows[0].actor_id, rows[0].actor_role, rows[0].http_status) == (accounts[actor].id, accounts[actor].role.value, status)
    assert "not-a-number" not in json.dumps(rows[0].resource_ids)


async def test_query_capture_is_bounded_and_does_not_store_search_tokens_or_untrusted_ids(client, headers, database):
    credential = headers("doctor")
    response = await client.get("/survey-assignments", params={"patient_id":1,"q":"PRIVATE SEARCH","token":"PRIVATE TOKEN"},
        headers={**credential,"X-Request-ID":"UNTRUSTED ID"})
    assert response.status_code == 200
    assert (await client.get("/patients/directory?q=PRIVATE+SEARCH&patient_id=2", headers=credential)).status_code == 200
    rows = await history(database)
    assert [r.resource_ids for r in rows] == [{"patient_id":1},{}]
    stored = json.dumps([{c.name:getattr(r,c.name) for c in r.__table__.columns} for r in rows], default=str)
    for forbidden in ("PRIVATE SEARCH", "PRIVATE TOKEN", "UNTRUSTED ID", credential["Authorization"], "Иван Петров"):
        assert forbidden not in stored
    assert set(rows[0].__table__.columns.keys()) == {
        "id","actor_id","actor_role","route","resource_ids","http_status","request_id","created_at"}


async def test_health_unauthenticated_reads_and_domain_writes_do_not_create_read_records(client, headers, database):
    assert (await client.get("/auth/me")).status_code == 401
    assert (await client.get("/health")).status_code == 200
    assert (await client.patch("/doctors/me/availability", headers=headers("doctor"), json={"availability":"busy"})).status_code == 200
    assert await history(database) == []


async def test_audit_storage_failure_withholds_clinical_response(client, headers, monkeypatch):
    from app.modules.audit import read_access

    async def unavailable(*_):
        raise OSError("A simulated unavailable audit store")
    monkeypatch.setattr(read_access, "record_read_access", unavailable)
    response = await client.get("/patients", headers=headers("doctor"))
    assert response.status_code == 503
    assert response.headers["cache-control"] == "no-store"
    assert response.json() == {"detail":"Журнал доступа временно недоступен. Повторите запрос позже."}
    assert "Иван" not in response.text and "Соколов" not in response.text


async def test_audit_commit_precedes_response_start(accounts, database, headers):
    from app.main import app

    observed = []
    async def checked_app(scope, receive, send):
        async def checked_send(message):
            if message["type"] == "http.response.start":
                rows = await history(database)
                observed.append([(row.route, row.http_status) for row in rows])
            await send(message)
        await app(scope, receive, checked_send)

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=checked_app), base_url="http://test") as client:
        assert (await client.get("/patients/1/assessments", headers=headers("doctor"))).status_code == 200
    assert observed == [[("/patients/{patient_id}/assessments", 200)]]


async def test_reads_release_domain_connection_before_audit_with_a_single_connection_pool(client, headers, database, monkeypatch):
    from app.api import deps
    from app.modules.audit import read_access

    engine = create_async_engine(get_settings().compass_database_url, pool_size=1, max_overflow=0, pool_timeout=1, hide_parameters=True)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(deps, "async_session_compass", maker)
    monkeypatch.setattr(read_access, "async_session_read_audit", maker)
    try:
        responses = await asyncio.wait_for(asyncio.gather(*(client.get("/patients", headers=headers("doctor")) for _ in range(4))), timeout=6)
        assert all(r.status_code == 200 for r in responses)
        assert len(await history(database)) == 4
    finally:
        await engine.dispose()


async def test_completed_read_can_persist_audit_while_domain_pool_is_saturated(accounts, database):
    from app.db.session import engine_compass
    from app.modules.audit.read_access import ReadAccessMiddleware

    # The endpoint has already verified the actor and computed its response.
    # Other requests now occupy every domain connection, including overflow.
    async def completed_read(scope, receive, send):
        scope.setdefault('state', {})['read_audit_actor'] = (accounts['doctor'].id, 'doctor')
        await JSONResponse({'result': 'computed'})(scope, receive, send)

    settings = get_settings()
    capacity = settings.compass_db_pool_size + settings.compass_db_max_overflow
    assert 1 <= capacity <= 20  # Keep this disposable test's resource use bounded.
    async with AsyncExitStack() as stack:
        for _ in range(capacity):
            await stack.enter_async_context(engine_compass.connect())
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=ReadAccessMiddleware(completed_read)),
                                     base_url='http://test') as client:
            response = await asyncio.wait_for(client.get('/completed-read'), timeout=2)
            assert response.status_code == 200 and response.json() == {'result': 'computed'}
    rows = await history(database)
    assert len(rows) == 1 and rows[0].actor_id == accounts['doctor'].id and rows[0].http_status == 200


async def test_unhandled_read_failure_records_status_without_exception_or_medical_text(accounts, database, headers):
    from app.modules.audit.read_access import ReadAccessMiddleware

    test_app = FastAPI()
    test_app.add_middleware(ReadAccessMiddleware)

    @test_app.get("/failure")
    async def failure(user: CurrentUser):
        raise RuntimeError("PRIVATE CLINICAL FAILURE")

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=test_app, raise_app_exceptions=False), base_url="http://test") as client:
        assert (await client.get("/failure", headers=headers("doctor"))).status_code == 500
    rows = await history(database)
    assert len(rows) == 1 and rows[0].http_status == 500 and rows[0].route == "/failure"
    assert "PRIVATE" not in json.dumps(rows[0].resource_ids)
