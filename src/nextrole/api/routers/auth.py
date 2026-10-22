"""Signup / login / logout / account deletion."""
import re
import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

from nextrole.api.deps import (
    COOKIE,
    current_user_id,
    get_conn,
    get_settings_dep,
    get_store,
    rate_limit_ip,
    too_many,
)
from nextrole.auth.passwords import hash_password, verify_password
from nextrole.auth.policy import password_problems
from nextrole.auth.sessions import end_session, start_session
from nextrole.config import Settings
from nextrole.db import repos
from nextrole.resume.storage import ResumeStore
from nextrole.security.web import CSRF_COOKIE, new_csrf_token

router = APIRouter()
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
# Verified against when the email is unknown, so "no such account" costs the same time as "wrong
# password" and response timing does not reveal which emails are registered.
_DUMMY_HASH = hash_password("not-a-real-password")


class Credentials(BaseModel):
    email: str = Field(max_length=254)
    # Bounds only: login must accept any existing password. The composition rules apply at signup.
    password: str = Field(min_length=1, max_length=1024)


class SignupRequest(Credentials):
    # Optional so API clients need not send it; when present it must match (typo guard, not security).
    confirm_password: str | None = Field(default=None, max_length=1024)


def _secure(settings: Settings) -> bool:
    return settings.cookie_secure or settings.env == "production"


def _set_cookies(resp: Response, token: str, settings: Settings) -> None:
    max_age = settings.session_ttl_hours * 3600
    resp.set_cookie(COOKIE, token, httponly=True, samesite="lax", secure=_secure(settings), max_age=max_age)
    # Readable by our own JavaScript on purpose (double-submit CSRF token); it grants nothing alone.
    resp.set_cookie(CSRF_COOKIE, new_csrf_token(), httponly=False, samesite="lax",
                    secure=_secure(settings), max_age=max_age)


@router.post("/auth/signup", status_code=201, dependencies=[rate_limit_ip("signup", 10, 3600)])
def signup(
    body: SignupRequest, resp: Response,
    conn: sqlite3.Connection = Depends(get_conn), settings: Settings = Depends(get_settings_dep),
) -> dict:
    email = body.email.strip().lower()
    if not _EMAIL.match(email):
        raise HTTPException(422, "invalid email")
    problems = password_problems(body.password)
    if problems:
        raise HTTPException(422, "password needs " + ", ".join(problems))
    if body.confirm_password is not None and body.confirm_password != body.password:
        raise HTTPException(422, "passwords do not match")
    if repos.get_user_by_email(conn, email):
        raise HTTPException(409, "email already registered")
    user_id = repos.create_user(conn, email, hash_password(body.password))
    _set_cookies(resp, start_session(conn, user_id, settings.session_ttl_hours), settings)
    return {"email": email}


@router.post("/auth/login", dependencies=[rate_limit_ip("login", 20, 60)])
def login(
    body: Credentials, request: Request, resp: Response,
    conn: sqlite3.Connection = Depends(get_conn), settings: Settings = Depends(get_settings_dep),
) -> dict:
    email = body.email.strip().lower()
    if settings.rate_limit_enabled:
        # Per-account attempt budget: also covers emails that do not exist, so it reveals nothing.
        ok, retry = request.app.state.limiter.check(f"login:email:{email}", 10, 900)
        if not ok:
            raise too_many(retry)
    user = repos.get_user_by_email(conn, email)
    if user is not None and repos.is_locked(user):
        raise too_many(900)  # same response whatever the password: a locked account cannot be probed
    # Same error for unknown email and wrong password: no account enumeration.
    valid = verify_password(user["pw_hash"] if user else _DUMMY_HASH, body.password)
    if user is None or not valid:
        if user is not None and repos.record_failed_login(
                conn, user["id"], settings.login_max_failures, settings.login_lockout_minutes):
            raise too_many(settings.login_lockout_minutes * 60)
        raise HTTPException(401, "invalid email or password")
    repos.record_login_success(conn, user["id"])
    _set_cookies(resp, start_session(conn, user["id"], settings.session_ttl_hours), settings)
    return {"email": email}


@router.post("/auth/logout", status_code=204)
def logout(request: Request, resp: Response, conn: sqlite3.Connection = Depends(get_conn)) -> None:
    token = request.cookies.get(COOKIE)
    if token:
        end_session(conn, token)
    resp.delete_cookie(COOKIE)
    resp.delete_cookie(CSRF_COOKIE)


@router.get("/me")
def me(
    request: Request, resp: Response,
    user_id: int = Depends(current_user_id), conn: sqlite3.Connection = Depends(get_conn),
    settings: Settings = Depends(get_settings_dep),
) -> dict:
    row = conn.execute("SELECT email, role FROM users WHERE id = ?", (user_id,)).fetchone()
    if CSRF_COOKIE not in request.cookies:  # a session that predates CSRF protection
        resp.set_cookie(CSRF_COOKIE, new_csrf_token(), httponly=False, samesite="lax",
                        secure=_secure(settings), max_age=settings.session_ttl_hours * 3600)
    return {"email": row["email"], "role": row["role"]}


@router.delete("/me", status_code=204)
def delete_account(
    request: Request,
    resp: Response,
    user_id: int = Depends(current_user_id),
    conn: sqlite3.Connection = Depends(get_conn),
    store: ResumeStore = Depends(get_store),
) -> None:
    """User-initiated deletion: encrypted resume file, then the user row (cascades the rest)."""
    request.app.state.run_manager.cancel_user(user_id)
    store.delete(repos.get_resume_path(conn, user_id))
    repos.delete_user(conn, user_id)
    resp.delete_cookie(COOKIE)
    resp.delete_cookie(CSRF_COOKIE)

