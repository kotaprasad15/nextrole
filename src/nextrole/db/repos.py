"""Repository functions for users, sessions and profiles."""
import sqlite3
from datetime import UTC, datetime

from nextrole.models.profile import Profile


def _now() -> str:
    return datetime.now(UTC).isoformat()


def create_user(conn: sqlite3.Connection, email: str, pw_hash: str) -> int:
    cur = conn.execute("INSERT INTO users (email, pw_hash) VALUES (?, ?)", (email, pw_hash))
    conn.commit()
    return int(cur.lastrowid)


def get_user_by_email(conn: sqlite3.Connection, email: str) -> sqlite3.Row | None:
    return conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()


def create_session(conn: sqlite3.Connection, token_hash: str, user_id: int, expires: str) -> None:
    conn.execute(
        "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
        (token_hash, user_id, expires),
    )
    conn.commit()


def get_session_user_id(conn: sqlite3.Connection, token_hash: str) -> int | None:
    row = conn.execute(
        "SELECT user_id, expires_at FROM sessions WHERE token_hash = ?", (token_hash,)
    ).fetchone()
    if row is None:
        return None
    if row["expires_at"] <= _now():
        delete_session(conn, token_hash)
        return None
    return int(row["user_id"])


def delete_session(conn: sqlite3.Connection, token_hash: str) -> None:
    conn.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash,))
    conn.commit()


def save_profile(
    conn: sqlite3.Connection, user_id: int, profile: Profile, resume_path: str | None = None
) -> None:
    """Upsert the profile; keep the existing resume path unless a new one is given."""
    conn.execute(
        """INSERT INTO profiles (user_id, profile_json, resume_path, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(user_id) DO UPDATE SET
             profile_json = excluded.profile_json,
             resume_path = COALESCE(excluded.resume_path, profiles.resume_path),
             updated_at = excluded.updated_at""",
        (user_id, profile.model_dump_json(), resume_path, _now()),
    )
    conn.commit()


def get_profile(conn: sqlite3.Connection, user_id: int) -> Profile | None:
    row = conn.execute(
        "SELECT profile_json FROM profiles WHERE user_id = ?", (user_id,)
    ).fetchone()
    return Profile.model_validate_json(row["profile_json"]) if row else None


def get_resume_path(conn: sqlite3.Connection, user_id: int) -> str | None:
    row = conn.execute("SELECT resume_path FROM profiles WHERE user_id = ?", (user_id,)).fetchone()
    return row["resume_path"] if row else None


def delete_user(conn: sqlite3.Connection, user_id: int) -> None:
    """Cascades to sessions and profiles. The caller must delete the resume file itself."""
    conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
    conn.commit()
