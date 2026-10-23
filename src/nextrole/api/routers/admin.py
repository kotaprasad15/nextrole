"""Admin-only routes. EVERY route here depends on `require_admin`, which reads the role from the
database on each request and answers 404 to everyone else (the existence of these routes is not
revealed, and hiding a link in the UI is never the protection)."""
import sqlite3
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException

from nextrole.api.deps import get_conn, rate_limit_user, require_admin
from nextrole.db import interview_repo as repo
from nextrole.interviews.schemas import ModerationNote

router = APIRouter(prefix="/admin", dependencies=[Depends(require_admin), rate_limit_user("admin", 600, 3600)])


@router.get("/interviews")
def queue(status: Literal["pending", "approved", "rejected", "removed"] = "pending", conn: sqlite3.Connection = Depends(get_conn)) -> list[dict]:
    """The review queue, riskiest first (automated rules + model opinion, then open reports)."""
    return repo.queue(conn, status)


@router.get("/interviews/{exp_id}")
def one(exp_id: int, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    found = repo.admin_get(conn, exp_id)
    if found is None:
        raise HTTPException(404, "not found")
    return found


def _decide(exp_id: int, status: str, body: ModerationNote | None, conn: sqlite3.Connection) -> dict:
    if not repo.set_status(conn, exp_id, status, (body or ModerationNote()).note):
        raise HTTPException(404, "not found")
    return repo.admin_get(conn, exp_id)  # type: ignore[return-value]


@router.post("/interviews/{exp_id}/approve")
def approve(exp_id: int, body: ModerationNote | None = None, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    return _decide(exp_id, "approved", body, conn)


@router.post("/interviews/{exp_id}/reject")
def reject(exp_id: int, body: ModerationNote | None = None, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    """The note is shown to the author as the reason it was not published."""
    return _decide(exp_id, "rejected", body, conn)


@router.post("/interviews/{exp_id}/remove")
def remove(exp_id: int, body: ModerationNote | None = None, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    return _decide(exp_id, "removed", body, conn)


@router.get("/reports")
def reports(conn: sqlite3.Connection = Depends(get_conn)) -> list[dict]:
    return repo.open_reports(conn)


@router.post("/reports/{report_id}/dismiss", status_code=204)
def dismiss(report_id: int, conn: sqlite3.Connection = Depends(get_conn)) -> None:
    if not repo.dismiss_report(conn, report_id):
        raise HTTPException(404, "not found")
