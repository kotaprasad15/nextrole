"""FastAPI app factory. Run: `uv run uvicorn nextrole.api.main:app --reload`."""
import sqlite3
from collections.abc import Callable

from fastapi import FastAPI

from nextrole.api.routers import auth, profile
from nextrole.config import Settings, get_settings
from nextrole.db.connection import connect
from nextrole.llm.budget import Budget
from nextrole.llm.client import LLMClient
from nextrole.resume.storage import ResumeStore
from nextrole.tracing.tracer import Tracer


def create_app(
    settings: Settings | None = None,
    conn: sqlite3.Connection | None = None,
    llm_factory: Callable[[], LLMClient] | None = None,
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
    app.include_router(auth.router)
    app.include_router(profile.router)

    @app.get("/health")
    def health() -> dict:
        return {"status": "ok"}

    return app


def __getattr__(name: str) -> FastAPI:  # lazy `app` so importing the module has no side effects
    if name == "app":
        return create_app()
    raise AttributeError(name)
