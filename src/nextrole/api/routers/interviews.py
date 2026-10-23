"""Interview experiences for signed-in users: submit, browse, upvote, report, manage your own."""
import sqlite3
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from nextrole.api.deps import current_user_id, get_conn, rate_limit_user
from nextrole.db import interview_repo as repo
from nextrole.interviews.moderation import auto_check, blocking_problems, rule_flags
from nextrole.interviews.schemas import ExperienceIn, ReportIn

router = APIRouter()
Submit = rate_limit_user("interview-submit", 5, 86400)  # submissions and edits share one daily budget


async def _screen(request: Request, data: ExperienceIn) -> dict:
    """Reject personal data outright, otherwise run the automated check and return its record."""
    text = data.all_text()
    flags = rule_flags(text)
    problems = blocking_problems(flags)
    if problems:
        raise HTTPException(422, " ".join(problems) + " Interview posts are public to other members and must not contain personal details.")
    checked = await auto_check(request.app.state.llm_factory, request.app.state.settings, text, flags)
    return checked.as_json()


@router.post("/interviews", status_code=201, dependencies=[Submit])
async def submit(
    data: ExperienceIn, request: Request, user_id: int = Depends(current_user_id),
    conn: sqlite3.Connection = Depends(get_conn),
) -> dict:
    if repo.pending_count(conn, user_id) >= repo.MAX_PENDING_PER_USER:
        raise HTTPException(409, "You already have several posts waiting for review. Please wait for those first.")
    checked = await _screen(request, data)
    exp_id = repo.create(conn, user_id, data, checked)
    return {"id": exp_id, "status": "pending", "message": "Thanks! A moderator reviews every post before it is published."}


@router.get("/interviews")
def browse(
    company: str = Query(default="", max_length=80), role: str = Query(default="", max_length=80),
    difficulty: int | None = Query(default=None, ge=1, le=5), outcome: str = Query(default="", max_length=20),
    level: str = Query(default="", max_length=20), q: str = Query(default="", max_length=80),
    sort: Literal["recent", "helpful"] = "recent", page: int = Query(default=1, ge=1, le=500),
    user_id: int = Depends(current_user_id), conn: sqlite3.Connection = Depends(get_conn),
) -> dict:
    return repo.list_public(conn, user_id, company=company, role=role, difficulty=difficulty, outcome=outcome,
                            level=level, q=q, sort=sort, page=page)


@router.get("/interviews/mine")
def mine(user_id: int = Depends(current_user_id), conn: sqlite3.Connection = Depends(get_conn)) -> list[dict]:
    return repo.list_mine(conn, user_id)


@router.get("/interviews/{exp_id}")
def get_one(exp_id: int, user_id: int = Depends(current_user_id), conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    found = repo.get_visible(conn, exp_id, user_id)
    if found is None:
        raise HTTPException(404, "not found")
    return found


@router.put("/interviews/{exp_id}", dependencies=[Submit])
async def edit(
    exp_id: int, data: ExperienceIn, request: Request, user_id: int = Depends(current_user_id),
    conn: sqlite3.Connection = Depends(get_conn),
) -> dict:
    row = conn.execute("SELECT id FROM interview_experiences WHERE id = ? AND user_id = ?", (exp_id, user_id)).fetchone()
    if row is None:
        raise HTTPException(404, "not found")
    checked = await _screen(request, data)
    repo.update_own(conn, user_id, exp_id, data, checked)
    return {"id": exp_id, "status": "pending", "message": "Saved. Because you changed it, a moderator will review it again."}


@router.delete("/interviews/{exp_id}", status_code=204)
def delete(exp_id: int, user_id: int = Depends(current_user_id), conn: sqlite3.Connection = Depends(get_conn)) -> None:
    if not repo.delete_own(conn, user_id, exp_id):
        raise HTTPException(404, "not found")


@router.post("/interviews/{exp_id}/upvote", dependencies=[rate_limit_user("interview-vote", 120, 3600)])
def upvote(exp_id: int, user_id: int = Depends(current_user_id), conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    found = repo.vote(conn, user_id, exp_id, True)
    if found is None:
        raise HTTPException(404, "not found")  # missing, not published, or your own post
    return found


@router.delete("/interviews/{exp_id}/upvote", dependencies=[rate_limit_user("interview-vote", 120, 3600)])
def remove_upvote(exp_id: int, user_id: int = Depends(current_user_id), conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    found = repo.vote(conn, user_id, exp_id, False)
    if found is None:
        raise HTTPException(404, "not found")
    return found


@router.post("/interviews/{exp_id}/report", status_code=201, dependencies=[rate_limit_user("interview-report", 10, 3600)])
def report(exp_id: int, body: ReportIn, user_id: int = Depends(current_user_id), conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    result = repo.report(conn, user_id, exp_id, body.reason, body.detail)
    if result == "missing":
        raise HTTPException(404, "not found")
    if result == "own":
        raise HTTPException(409, "You cannot report your own post. You can edit or delete it instead.")
    if result == "duplicate":
        raise HTTPException(409, "You have already reported this post. A moderator will look at it.")
    return {"message": "Thank you. A moderator will review this post."}
