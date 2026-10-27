import os
from urllib.parse import urlsplit

import httpx
import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

os.environ.setdefault("COMPASS_DATABASE_URL", "postgresql+asyncpg://unused@127.0.0.1:1/compass_test")
os.environ.setdefault("MIS_DATABASE_URL", "postgresql+asyncpg://unused@127.0.0.1:1/mis_test")
os.environ.setdefault("JWT_SECRET", "unit-test-secret-not-for-production-123456789")
os.environ.setdefault("REDIS_URL", "redis://127.0.0.1:6379/0")

from app.core.security import create_access_token, hash_password
from app.db.base import Base
from app.db.session import async_session_compass, engine_compass, engine_mis, engine_read_audit
from app.main import app
from app.modules.access.models import User, UserRole
from app.modules.patients.models import Patient, PatientMapping

TEST_HASH = hash_password("test-pass-123")


@pytest_asyncio.fixture
async def database():
    if os.getenv("ALLOW_TEST_DB_RESET") != "1":
        pytest.skip("Set explicit disposable *_test database URLs and ALLOW_TEST_DB_RESET=1")
    database_name = urlsplit(os.environ["COMPASS_DATABASE_URL"]).path.rsplit("/", 1)[-1]
    assert database_name.endswith("_test") and database_name not in {"postgres", "template0", "template1"}
    async with engine_compass.begin() as connection:
        await connection.run_sync(Base.metadata.drop_all)
        await connection.run_sync(Base.metadata.create_all)
    yield async_session_compass
    await engine_read_audit.dispose()
    await engine_compass.dispose()
    await engine_mis.dispose()


@pytest_asyncio.fixture
async def accounts(database):
    async with database() as session:
        users = {}
        for name, role in [("doctor", UserRole.doctor), ("doctor2", UserRole.doctor), ("patient1", UserRole.patient),
                           ("patient2", UserRole.patient), ("patient3", UserRole.patient), ("admin", UserRole.admin)]:
            user = User(username=name, display_name=name, role=role, hashed_password=TEST_HASH)
            session.add(user)
            await session.flush()
            users[name] = user
        for i, doctor, name in [(1, "doctor", "Иван Петров"), (2, "doctor2", "Мария Иванова"), (3, "doctor", "Александр Соколов")]:
            patient = Patient(id=i, mis_id=i, full_name=name, doctor_id=users[doctor].id, user_id=users[f"patient{i}"].id)
            session.add(patient)
            await session.flush()
            session.add(PatientMapping(compass_patient_id=patient.id, mis_id=i))
        # Explicit fixture IDs do not advance PostgreSQL's native sequence.
        await session.execute(text("SELECT setval(pg_get_serial_sequence('patients','id'), (SELECT max(id) FROM patients), true)"))
        await session.commit()
    return users


@pytest.fixture
def headers(accounts):
    return lambda name: {"Authorization": "Bearer " + create_access_token(accounts[name].id, accounts[name].role.value)}


@pytest_asyncio.fixture
async def client(accounts):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        yield client
