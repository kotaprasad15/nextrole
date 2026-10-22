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


def client_ip(request: Request) -> str:
    """The caller's address. X-Forwarded-For is honoured only for the configured number of trusted
    proxies (default 0), because anyone can send that header themselves."""
    hops = request.app.state.settings.trusted_proxy_hops
    if hops > 0:
        parts = [p.strip() for p in request.headers.get("x-forwarded-for", "").split(",") if p.strip()]
        if len(parts) >= hops:
            return parts[-hops]
    return request.client.host if request.client else "unknown"


def too_many(retry_after: float) -> HTTPException:
    return HTTPException(429, "too many requests, try again later",
                         headers={"Retry-After": str(max(1, int(retry_after) + 1))})


def rate_limit_ip(name: str, limit: int, window_s: float):
    """Dependency: at most `limit` calls per `window_s` per client address."""

    def dep(request: Request) -> None:
        if not request.app.state.settings.rate_limit_enabled:
            return
        ok, retry = request.app.state.limiter.check(f"{name}:ip:{client_ip(request)}", limit, window_s)
        if not ok:
            raise too_many(retry)

    return Depends(dep)


def current_user_id(
    request: Request, conn: sqlite3.Connection = Depends(get_conn)
) -> int:
    user_id = user_for_token(conn, request.cookies.get(COOKIE))
    if user_id is None:
        raise HTTPException(status_code=401, detail="not authenticated")
    return user_id


def rate_limit_user(name: str, limit: int, window_s: float):
    """Dependency: at most `limit` calls per `window_s` per signed-in user (runs, uploads, LLM work)."""

    def dep(request: Request, user_id: int = Depends(current_user_id)) -> None:
        if not request.app.state.settings.rate_limit_enabled:
            return
        ok, retry = request.app.state.limiter.check(f"{name}:user:{user_id}", limit, window_s)
        if not ok:
            raise too_many(retry)

    return Depends(dep)


def require_admin(
    user_id: int = Depends(current_user_id), conn: sqlite3.Connection = Depends(get_conn)
) -> int:
    """Admin-only routes. The role is read from the database on EVERY request (never from the
    cookie or the client), and non-admins get a 404 so the route's existence is not revealed."""
    from nextrole.db import repos  # local import: repos is heavy and not needed by other deps

    if repos.get_role(conn, user_id) != "admin":
        raise HTTPException(status_code=404, detail="not found")
    return user_id
