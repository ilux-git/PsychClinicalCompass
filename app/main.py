from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.db.session import dispose_engines, ping_databases


@asynccontextmanager
async def lifespan(app: FastAPI):
    await ping_databases()
    yield
    await dispose_engines()


app = FastAPI(title="Clinical Compass", lifespan=lifespan)


@app.get("/health")
async def health() -> dict[str, str | bool]:
    pings = await ping_databases()
    return {"status": "ok", "compass_db": pings["compass"], "mis_db": pings["mis"]}