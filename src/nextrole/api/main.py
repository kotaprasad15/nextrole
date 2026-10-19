"""FastAPI app factory. Run: `uv run uvicorn nextrole.api.main:app --reload`."""
import sqlite3
from collections.abc import Callable
from pathlib import Path

import httpx
from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from nextrole.api.routers import auth, outreach, profile, recommendations, runs
from nextrole.config import Settings, get_settings
from nextrole.db import repos
from nextrole.db.connection import connect
from nextrole.llm.budget import Budget
from nextrole.llm.client import LLMClient
from nextrole.orchestrator.manager import RunManager
from nextrole.resume.storage import ResumeStore
from nextrole.sources.registry import discover as discover_jobs
from nextrole.tracing.tracer import Tracer

WEB_DIR = Path(__file__).parent.parent / "web"


def create_app(
    settings: Settings | None = None,
    conn: sqlite3.Connection | None = None,
    llm_factory: Callable[[], LLMClient] | None = None,
    discover: Callable | None = None,
    http_factory: Callable[[], httpx.AsyncClient] | None = None,
) -> FastAPI:
    """Factory so tests can inject an in-memory DB and a mocked LLM."""
    settings = settings or get_settings()
    app = FastAPI(title="NextRole")
    app.state.settings = settings
    app.state.conn = conn or connect(settings.db_path)
    app.state.store_factory = lambda: ResumeStore(settings.upload_dir, settings.resume_encryption_key)
    app.state.llm_factory = llm_factory or (
        lambda: LLMClient(settings, Budget.from_settings(settings), Tracer(settings.trace_dir))
    )
    app.state.discover = discover or discover_jobs  # injectable so tests never hit the network
    # HTTP client for researcher tools; injectable so tests never touch the network.
    app.state.http_factory = http_factory or (lambda: httpx.AsyncClient(
        headers={"User-Agent": "NextRole/0.1 (portfolio project)"}, timeout=settings.fetch_timeout_s))
    repos.fail_stale_runs(app.state.conn)  # a restart orphans 'running' rows
    app.state.run_manager = RunManager(
        app.state.conn, settings, app.state.llm_factory, app.state.http_factory,
        app.state.discover)
    app.include_router(auth.router)
    app.include_router(profile.router)
    app.include_router(recommendations.router)
    app.include_router(outreach.router)
    app.include_router(runs.router)

    @app.get("/health")
    def health() -> dict:
        return {"status": "ok"}

    # Frontend: static files served same-origin, so session cookies need no CORS handling.
    app.mount("/static", StaticFiles(directory=WEB_DIR), name="static")

    @app.get("/", include_in_schema=False)
    def index() -> FileResponse:
        return FileResponse(WEB_DIR / "index.html")

    return app


def __getattr__(name: str) -> FastAPI:  # lazy `app` so importing the module has no side effects
    if name == "app":
        return create_app()
    raise AttributeError(name)
