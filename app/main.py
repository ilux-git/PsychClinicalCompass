from contextlib import asynccontextmanager
from pathlib import Path
import os

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.api.deps import get_compass_session  # noqa: F401
from app.core.config import get_settings
from app.core.browser_security import BrowserSecurityMiddleware
from app.core.api_docs import router as api_docs_router
from app.db.session import dispose_engines, ping_databases
from app.modules.assessments.router import router as assessments_router
from app.modules.assessments.clinical_router import router as clinical_instruments_router
from app.modules.assessments.scenario_router import router as scenario_router
from app.modules.messaging.router import router as messaging_router
from app.modules.access.router import router as access_router
from app.modules.access.telegram_router import router as telegram_auth_router
from app.modules.patients.router import router as patients_router
from app.modules.surveys.router import router as surveys_router
from app.modules.adherence.router import router as adherence_router
from app.modules.analytics.router import router as analytics_router
from app.modules.notes.router import router as notes_router
from app.modules.alerts.router import router as alerts_router
from app.modules.alerts.escalation_router import router as escalation_router
from app.modules.care.router import router as care_router
from app.modules.adherence.medication_router import router as medication_router
from app.modules.adherence.rewards import router as rewards_router
from app.modules.analytics.privacy import router as privacy_router
import app.db.models
from app.modules.audit.read_access import ReadAccessMiddleware
from app.modules.integration.emr_router import router as emr_demo_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    await ping_databases()
    yield
    await dispose_engines()


app = FastAPI(title="Clinical Compass", lifespan=lifespan, docs_url=None, redoc_url=None)
app.add_middleware(ReadAccessMiddleware)
app.add_middleware(BrowserSecurityMiddleware)
app.include_router(telegram_auth_router)
app.include_router(api_docs_router)
app.include_router(assessments_router)
app.include_router(clinical_instruments_router)
app.include_router(scenario_router)
app.include_router(messaging_router)
app.include_router(emr_demo_router)
app.include_router(escalation_router)
for router in (access_router, patients_router, surveys_router, adherence_router, analytics_router, notes_router, alerts_router, care_router, medication_router, rewards_router, privacy_router):
    app.include_router(router)


@app.exception_handler(RequestValidationError)
async def validation_error(request, exc):
    if request.url.path.startswith('/auth/'):
        return JSONResponse(status_code=422, content={'detail': [
            {key: error[key] for key in ('loc', 'msg', 'type') if key in error} for error in exc.errors()]})
    return await request_validation_exception_handler(request, exc)


@app.get("/health")
async def health() -> JSONResponse:
    pings = await ping_databases()
    state = "ok" if all(pings.values()) else "degraded" if pings["compass"] else "unavailable"
    return JSONResponse(status_code=200 if pings["compass"] else 503,
                        content={"status": state, "compass_db": pings["compass"], "mis_db": pings["mis"], "mode": "synthetic_demo"})


@app.get("/_load-test/context", include_in_schema=False)
async def load_test_context():
    settings = get_settings()
    if not settings.load_test_mode:
        raise HTTPException(404, "Not found")
    return {"run_id":settings.load_test_run_id, "synthetic":True, "external_delivery":False, "process_id":os.getpid()}


frontend = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if frontend.is_dir():
    @app.get('/tg', include_in_schema=False)
    @app.get('/tg/', include_in_schema=False)
    async def mini_app_entry():
        return FileResponse(frontend / 'index.html')

    app.mount("/", StaticFiles(directory=str(frontend), html=True), name="frontend")
