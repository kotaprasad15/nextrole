"""FastAPI dependencies: app-scoped state and the authenticated user."""
import sqlite3
from collections.abc import Callable

from fastapi import Depends, HTTPException, Request

from nextrole.auth.sessions import user_for_token
from nextrole.config import Settings
from nextrole.llm.client import LLMClient
from nextrole.resume.storage import ResumeStore

COOKIE = "nextrole_session"


def get_conn(request: Request) -> sqlite3.Connection:
    return request.app.state.conn


def get_settings_dep(request: Request) -> Settings:
    return request.app.state.settings


def get_store(request: Request) -> ResumeStore:
    return request.app.state.store_factory()


def get_llm(request: Request) -> LLMClient:
    """Fresh client + budget per request, so every run has its own cap and trace."""
    factory: Callable[[], LLMClient] = request.app.state.llm_factory
    return factory()


def current_user_id(
    request: Request, conn: sqlite3.Connection = Depends(get_conn)
) -> int:
    user_id = user_for_token(conn, request.cookies.get(COOKIE))
    if user_id is None:
        raise HTTPException(status_code=401, detail="not authenticated")
    return user_id
