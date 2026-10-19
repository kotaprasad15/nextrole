"""Signup / login / logout / account deletion."""
import re
import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

from nextrole.api.deps import COOKIE, current_user_id, get_conn, get_settings_dep, get_store
from nextrole.auth.passwords import hash_password, verify_password
from nextrole.auth.sessions import end_session, start_session
from nextrole.config import Settings
from nextrole.db import repos
from nextrole.resume.storage import ResumeStore

router = APIRouter()
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class Credentials(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(min_length=8, max_length=256)


def _set_cookie(resp: Response, token: str, settings: Settings) -> None:
    resp.set_cookie(
        COOKIE, token, httponly=True, samesite="lax", secure=settings.cookie_secure,
        max_age=settings.session_ttl_hours * 3600,
    )


@router.post("/auth/signup", status_code=201)
def signup(
    body: Credentials, resp: Response,
    conn: sqlite3.Connection = Depends(get_conn), settings: Settings = Depends(get_settings_dep),
) -> dict:
    email = body.email.strip().lower()
    if not _EMAIL.match(email):
        raise HTTPException(422, "invalid email")
    if repos.get_user_by_email(conn, email):
        raise HTTPException(409, "email already registered")
    user_id = repos.create_user(conn, email, hash_password(body.password))
    _set_cookie(resp, start_session(conn, user_id, settings.session_ttl_hours), settings)
    return {"email": email}


@router.post("/auth/login")
def login(
    body: Credentials, resp: Response,
    conn: sqlite3.Connection = Depends(get_conn), settings: Settings = Depends(get_settings_dep),
) -> dict:
    email = body.email.strip().lower()
    user = repos.get_user_by_email(conn, email)
    # Same error for unknown email and wrong password: no account enumeration.
    if user is None or not verify_password(user["pw_hash"], body.password):
        raise HTTPException(401, "invalid email or password")
    _set_cookie(resp, start_session(conn, user["id"], settings.session_ttl_hours), settings)
    return {"email": email}


@router.post("/auth/logout", status_code=204)
def logout(request: Request, resp: Response, conn: sqlite3.Connection = Depends(get_conn)) -> None:
    token = request.cookies.get(COOKIE)
    if token:
        end_session(conn, token)
    resp.delete_cookie(COOKIE)


@router.delete("/me", status_code=204)
def delete_account(
    resp: Response,
    user_id: int = Depends(current_user_id),
    conn: sqlite3.Connection = Depends(get_conn),
    store: ResumeStore = Depends(get_store),
) -> None:
    """User-initiated deletion: encrypted resume file, then the user row (cascades the rest)."""
    store.delete(repos.get_resume_path(conn, user_id))
    repos.delete_user(conn, user_id)
    resp.delete_cookie(COOKIE)
