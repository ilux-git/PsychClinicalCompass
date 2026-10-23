from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app.api.deps import get_compass_session  # noqa: F401
from app.db.session import dispose_engines, ping_databases
from app.modules.assessments.router import router as assessments_router
from app.modules.messaging.router import router as messaging_router
from app.modules.access.router import router as access_router
from app.modules.patients.router import router as patients_router
from app.modules.surveys.router import router as surveys_router
from app.modules.adherence.router import router as adherence_router
from app.modules.analytics.router import router as analytics_router
from app.modules.notes.router import router as notes_router
from app.modules.alerts.router import router as alerts_router
from app.modules.care.router import router as care_router
from app.modules.adherence.medication_router import router as medication_router
from app.modules.adherence.rewards import router as rewards_router
from app.modules.analytics.privacy import router as privacy_router
import app.db.models


@asynccontextmanager
async def lifespan(app: FastAPI):
    await ping_databases()
    yield
    await dispose_engines()


app = FastAPI(title="Clinical Compass", lifespan=lifespan)
app.include_router(assessments_router)
app.include_router(messaging_router)
for router in (access_router, patients_router, surveys_router, adherence_router, analytics_router, notes_router, alerts_router, care_router, medication_router, rewards_router, privacy_router):
    app.include_router(router)


@app.get("/health")
async def health() -> JSONResponse:
    pings = await ping_databases()
    state = "ok" if all(pings.values()) else "degraded" if pings["compass"] else "unavailable"
    return JSONResponse(status_code=200 if pings["compass"] else 503,
                        content={"status": state, "compass_db": pings["compass"], "mis_db": pings["mis"], "mode": "synthetic_demo"})


frontend = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if frontend.is_dir():
    app.mount("/", StaticFiles(directory=str(frontend), html=True), name="frontend")
