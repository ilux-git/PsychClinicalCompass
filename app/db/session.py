from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import get_settings

settings = get_settings()

engine_compass = create_async_engine(settings.compass_database_url, pool_pre_ping=True, hide_parameters=True,
    connect_args={"timeout": 3}, pool_size=settings.compass_db_pool_size, max_overflow=settings.compass_db_max_overflow)
# Reserve a bounded pool on the same database for the mandatory pre-response
# access record. Domain requests must not queue this write behind their reads.
engine_read_audit = create_async_engine(settings.compass_database_url, pool_pre_ping=True, hide_parameters=True,
    connect_args={"timeout": 3}, pool_size=settings.read_audit_db_pool_size, max_overflow=0)
engine_mis = create_async_engine(settings.mis_database_url, pool_pre_ping=True, hide_parameters=True,
    connect_args={"timeout": 3}, pool_size=settings.mis_db_pool_size, max_overflow=settings.mis_db_max_overflow)

async_session_compass = async_sessionmaker(bind=engine_compass, class_=AsyncSession, expire_on_commit=False)
async_session_read_audit = async_sessionmaker(bind=engine_read_audit, class_=AsyncSession, expire_on_commit=False)
async_session_mis = async_sessionmaker(bind=engine_mis, class_=AsyncSession, expire_on_commit=False)


async def ping_databases() -> dict[str, bool]:
    results: dict[str, bool] = {"compass": False, "mis": False}
    try:
        async with engine_compass.connect() as conn:
            await conn.execute(text("SELECT 1"))
        results["compass"] = True
    except Exception:
        pass
    try:
        async with engine_mis.connect() as conn:
            await conn.execute(text("SELECT 1"))
        results["mis"] = True
    except Exception:
        pass
    return results


async def dispose_engines() -> None:
    await engine_read_audit.dispose()
    await engine_compass.dispose()
    await engine_mis.dispose()
