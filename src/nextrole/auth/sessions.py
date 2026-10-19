"""Opaque server-side sessions.

Design decision: random 256-bit token in an HttpOnly cookie; only its SHA-256 is stored.
Server-side sessions (vs JWT) can be revoked instantly on logout or account deletion.
"""
import hashlib
import secrets
import sqlite3
from datetime import UTC, datetime, timedelta

from nextrole.db import repos


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def start_session(conn: sqlite3.Connection, user_id: int, ttl_hours: int) -> str:
    token = secrets.token_urlsafe(32)
    expires = (datetime.now(UTC) + timedelta(hours=ttl_hours)).isoformat()
    repos.create_session(conn, _hash(token), user_id, expires)
    return token


def user_for_token(conn: sqlite3.Connection, token: str | None) -> int | None:
    return repos.get_session_user_id(conn, _hash(token)) if token else None


def end_session(conn: sqlite3.Connection, token: str) -> None:
    repos.delete_session(conn, _hash(token))
