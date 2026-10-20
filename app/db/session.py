from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import get_settings

settings = get_settings()

engine_compass = create_async_engine(settings.compass_database_url)
engine_mis = create_async_engine(settings.mis_database_url)

async_session_compass = async_sessionmaker(bind=engine_compass, class_=AsyncSession, expire_on_commit=False)
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
    await engine_compass.dispose()
    await engine_mis.dispose()