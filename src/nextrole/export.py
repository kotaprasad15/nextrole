"""Data export ("download everything NextRole holds about me") and account-deletion helpers.

Export sections are registered by name so each feature adds its own data next to its own tables
(saved jobs, alerts, interview posts...). Everything is decrypted for the owner only: the route that
calls this is authenticated, rate limited, and the user id comes from the session.
"""
import base64
import json
import sqlite3
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path

from nextrole.alerts import store as alert_store
from nextrole.db import interview_repo, repos, saved_repo
from nextrole.resume.storage import ResumeStore
from nextrole.security.crypto import DecryptionError

Section = Callable[[sqlite3.Connection, int], object]
_SECTIONS: dict[str, Section] = {}


def export_section(name: str) -> Callable[[Section], Section]:
    def register(fn: Section) -> Section:
        _SECTIONS[name] = fn
        return fn

    return register


@export_section("account")
def _account(conn: sqlite3.Connection, user_id: int) -> dict:
    row = conn.execute("SELECT email, role, created_at, last_login_at FROM users WHERE id = ?",
                       (user_id,)).fetchone()
    return dict(row) if row else {}


@export_section("profile")
def _profile(conn: sqlite3.Connection, user_id: int) -> dict | None:
    profile = repos.get_profile(conn, user_id)
    return profile.model_dump() if profile else None


@export_section("matches")
def _matches(conn: sqlite3.Connection, user_id: int) -> list[dict]:
    return [{"tier": tier, "match": match.model_dump(), "job": job.model_dump()}
            for job, match, tier in repos.list_matches(conn, user_id)]


@export_section("outreach")
def _outreach(conn: sqlite3.Connection, user_id: int) -> list[dict]:
    out = []
    for r in conn.execute("SELECT id FROM outreach WHERE user_id = ?", (user_id,)).fetchall():
        row = repos.get_outreach(conn, user_id, r["id"])
        feedback = repos.get_feedback(conn, user_id, r["id"])
        out.append({
            "job_id": row["job_id"], "status": row["status"], "approved_at": row["approved_at"],
            "recipient_email": row["recipient_email"], "draft": json.loads(row["draft_json"]),
            "facts": json.loads(row["facts_json"]), "warnings": json.loads(row["warnings_json"]),
            "feedback": feedback, "updated_at": row["updated_at"],
        })
    return out


@export_section("saved_jobs")
def _saved_jobs(conn: sqlite3.Connection, user_id: int) -> list[dict]:
    return saved_repo.list_saved(conn, user_id)


@export_section("watched_companies")
def _companies(conn: sqlite3.Connection, user_id: int) -> list[str]:
    return [c["display_name"] for c in saved_repo.list_companies(conn, user_id)]


@export_section("alerts")
def _alerts(conn: sqlite3.Connection, user_id: int) -> dict:
    cfg = alert_store.get_settings_row(conn, user_id)
    return {"settings": {"in_app": bool(cfg["in_app"]), "email": bool(cfg["email"]), "frequency": cfg["frequency"]},
            "items": alert_store.list_alerts(conn, user_id, limit=1000)}


@export_section("interview_experiences")
def _interviews(conn: sqlite3.Connection, user_id: int) -> dict:
    return interview_repo.export_for(conn, user_id)


@export_section("runs")
def _runs(conn: sqlite3.Connection, user_id: int) -> list[dict]:
    return [dict(r) for r in repos.list_runs(conn, user_id, limit=1000)]


def build_export(conn: sqlite3.Connection, store: ResumeStore, user_id: int) -> dict:
    data: dict = {"exported_at": datetime.now(UTC).isoformat(), "format": 1}
    for name, fn in _SECTIONS.items():
        data[name] = fn(conn, user_id)
    data["resume_file"] = None
    path = repos.get_resume_path(conn, user_id)
    if path:
        try:
            blob = store.load(path)
            kind = "pdf" if blob.startswith(b"%PDF") else "docx"
            data["resume_file"] = {"filename": f"resume.{kind}", "content_base64": base64.b64encode(blob).decode()}
        except (DecryptionError, FileNotFoundError):
            data["resume_file"] = None
    return data


def delete_user_traces(trace_dir: Path, run_ids: list[str]) -> None:
    for rid in run_ids:
        (Path(trace_dir) / f"{Path(rid).name}.jsonl").unlink(missing_ok=True)
