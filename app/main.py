from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.deps import get_compass_session  # noqa: F401
from app.db.session import dispose_engines, ping_databases
from app.modules.assessments.router import router as assessments_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    await ping_databases()
    yield
    await dispose_engines()


app = FastAPI(title="Clinical Compass", lifespan=lifespan)
app.include_router(assessments_router)


@app.get("/health")
async def health() -> dict[str, str | bool]:
    pings = await ping_databases()
    return {"status": "ok", "compass_db": pings["compass"], "mis_db": pings["mis"]}