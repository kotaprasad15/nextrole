"""FastAPI app factory. Run: `uv run uvicorn nextrole.api.main:app --reload`."""
import sqlite3
from collections.abc import Callable

import httpx
from fastapi import FastAPI

from nextrole.api.routers import auth, outreach, profile, public, recommendations, runs, saved
from nextrole.config import Settings, get_settings
from nextrole.db import repos
from nextrole.db.connection import connect
from nextrole.db.migrate import run_data_migrations
from nextrole.llm.budget import Budget
from nextrole.llm.client import LLMClient
from nextrole.orchestrator.manager import RunManager
from nextrole.resume.storage import ResumeStore
from nextrole.security import crypto
from nextrole.security.ratelimit import RateLimiter
from nextrole.security.web import SecurityMiddleware
from nextrole.sources.registry import discover as discover_jobs
from nextrole.tracing.tracer import Tracer


def create_app(
    settings: Settings | None = None,
    conn: sqlite3.Connection | None = None,
    llm_factory: Callable[[], LLMClient] | None = None,
    discover: Callable | None = None,
    http_factory: Callable[[], httpx.AsyncClient] | None = None,
) -> FastAPI:
    """Factory so tests can inject an in-memory DB and a mocked LLM."""
    settings = settings or get_settings()
    # Interactive docs describe every route: off in production (the schema is not a secret, but there
    # is no reason to hand attackers a console).
    docs_on = settings.env != "production"
    app = FastAPI(title="NextRole", docs_url="/docs" if docs_on else None,
                  redoc_url=None, openapi_url="/openapi.json" if docs_on else None)
    app.state.settings = settings
    app.state.conn = conn or connect(settings.db_path)
    # Field encryption: configure the process-wide keyring, then upgrade any pre-encryption rows/files.
    keyring = crypto.Keyring.parse(settings.encryption_keys, settings.resume_encryption_key)
    if keyring is not None:
        crypto.configure(keyring)
        run_data_migrations(app.state.conn, keyring, settings.upload_dir,
                            settings.resume_encryption_key, settings.db_path)
    repos.sync_admins(app.state.conn, settings.admin_emails.split(","))
    app.state.limiter = RateLimiter()
    app.state.store_factory = lambda: ResumeStore(
        settings.upload_dir, crypto.get_keyring(), settings.resume_encryption_key)
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
    production = settings.env == "production"
    app.add_middleware(
        SecurityMiddleware,
        csrf_enabled=settings.csrf_enabled,
        allowed_origins={o.strip().rstrip("/") for o in settings.allowed_origins.split(",") if o.strip()},
        hsts=production or settings.cookie_secure,
    )
    app.include_router(auth.router)
    app.include_router(profile.router)
    app.include_router(recommendations.router)
    app.include_router(outreach.router)
    app.include_router(runs.router)
    app.include_router(public.router)
    app.include_router(saved.router)

    @app.get("/health")
    def health() -> dict:
        return {"status": "ok"}

    @app.get("/", include_in_schema=False)
    def index() -> dict:
        # The UI is the Next.js app in frontend/ (it proxies /api/* here, so no CORS is needed).
        return {"service": "NextRole API", "docs": "/docs", "ui": "run the Next.js app in frontend/ (see README)"}

    return app


def __getattr__(name: str) -> FastAPI:  # lazy `app` so importing the module has no side effects
    if name == "app":
        return create_app()
    raise AttributeError(name)
