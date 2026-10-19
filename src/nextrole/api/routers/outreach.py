"""Outreach: generate a grounded draft, edit it, and explicitly approve it.

There is intentionally NO send endpoint. 'Approved' means the user marked the draft ready; the
UI then offers mailto:/Gmail-compose links the user opens themselves.
"""
import json
import re
import sqlite3
from typing import Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from nextrole.api.deps import current_user_id, get_conn, get_llm, get_settings_dep
from nextrole.config import Settings
from nextrole.db import repos
from nextrole.llm.budget import BudgetExceeded
from nextrole.llm.client import LLMClient
from nextrole.models.outreach import Channel, CriticReport, OutreachDraft
from nextrole.models.research import Fact
from nextrole.outreach import generate_outreach

router = APIRouter()
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class GenerateRequest(BaseModel):
    job_id: str
    channel: Channel = "email"
    recipient_name: str = Field(default="", max_length=80)


class EditRequest(BaseModel):
    subject: str = Field(default="", max_length=200)
    body: str = Field(min_length=1, max_length=4000)
    recipient_email: str = Field(default="", max_length=254)


class FeedbackRequest(BaseModel):
    rating: Literal[1, -1]
    note: str = Field(default="", max_length=500)


class OutreachOut(BaseModel):
    id: int
    job_id: str
    job_title: str
    company: str
    channel: Channel
    subject: str
    body: str
    recipient_email: str
    status: str
    critic: CriticReport | None
    warnings: list[str]
    attempts: int
    facts_used: list[Fact]
    approved_at: str | None
    feedback: dict | None = None


def _out(conn: sqlite3.Connection, user_id: int, row: sqlite3.Row) -> OutreachOut:
    draft = OutreachDraft.model_validate_json(row["draft_json"])
    job = repos.get_job_for_user(conn, user_id, row["job_id"])
    facts = {f["id"]: Fact(**f) for f in json.loads(row["facts_json"])}
    cited = [facts[i] for c in draft.claims for i in c.fact_ids if i in facts]
    return OutreachOut(
        id=row["id"], job_id=row["job_id"], job_title=job.title if job else "",
        company=job.company if job else "", channel=draft.channel, subject=draft.subject,
        body=draft.body, recipient_email=row["recipient_email"], status=row["status"],
        critic=CriticReport.model_validate_json(row["critic_json"]) if row["critic_json"] else None,
        warnings=json.loads(row["warnings_json"]), attempts=row["attempts"],
        facts_used=list({f.id: f for f in cited}.values()), approved_at=row["approved_at"],
        feedback=dict(fb) if (fb := repos.get_feedback(conn, user_id, row["id"])) else None,
    )


def _get_or_404(conn: sqlite3.Connection, user_id: int, outreach_id: int) -> sqlite3.Row:
    row = repos.get_outreach(conn, user_id, outreach_id)
    if row is None:
        raise HTTPException(404, "draft not found")
    return row


@router.post("/outreach", response_model=OutreachOut)
async def generate(
    body: GenerateRequest, request: Request,
    user_id: int = Depends(current_user_id),
    conn: sqlite3.Connection = Depends(get_conn),
    settings: Settings = Depends(get_settings_dep),
    llm: LLMClient = Depends(get_llm),
) -> OutreachOut:
    profile = repos.get_profile(conn, user_id)
    if profile is None:
        raise HTTPException(409, "complete onboarding first")
    job = repos.get_job_for_user(conn, user_id, body.job_id)
    if job is None:
        raise HTTPException(404, "job not found in your recommendations")
    try:
        async with request.app.state.http_factory() as http:
            result = await generate_outreach(
                llm=llm, settings=settings, conn=conn, http=http, profile=profile, job=job,
                channel=body.channel, recipient_name=body.recipient_name, user_id=user_id)
    except BudgetExceeded as exc:
        raise HTTPException(429, str(exc)) from exc
    except (ValueError, httpx.HTTPError) as exc:
        raise HTTPException(502, "could not generate a draft; please try again") from exc
    oid = repos.upsert_outreach(conn, user_id, job.id, result.draft, result.report, result.facts,
                                result.warnings, result.attempts)
    return _out(conn, user_id, repos.get_outreach(conn, user_id, oid))


@router.get("/outreach")
def list_outreach(
    user_id: int = Depends(current_user_id), conn: sqlite3.Connection = Depends(get_conn)
) -> list[dict]:
    """Lightweight status list so the dashboard can show 'Draft ready' / 'Approved' on cards."""
    return [dict(r) for r in repos.list_outreach_status(conn, user_id)]


@router.get("/outreach/by-job/{job_id}", response_model=OutreachOut)
def by_job(
    job_id: str, user_id: int = Depends(current_user_id),
    conn: sqlite3.Connection = Depends(get_conn),
) -> OutreachOut:
    row = repos.get_outreach_by_job(conn, user_id, job_id)
    if row is None:
        raise HTTPException(404, "no draft for this job yet")
    return _out(conn, user_id, row)


@router.put("/outreach/{outreach_id}", response_model=OutreachOut)
def edit(
    outreach_id: int, body: EditRequest, user_id: int = Depends(current_user_id),
    conn: sqlite3.Connection = Depends(get_conn),
) -> OutreachOut:
    _get_or_404(conn, user_id, outreach_id)
    email = body.recipient_email.strip()
    if email and not _EMAIL.match(email):
        raise HTTPException(422, "invalid recipient email")
    repos.edit_outreach(conn, user_id, outreach_id, body.subject.strip(), body.body.strip(), email)
    return _out(conn, user_id, _get_or_404(conn, user_id, outreach_id))


@router.post("/outreach/{outreach_id}/approve", response_model=OutreachOut)
def approve(
    outreach_id: int, user_id: int = Depends(current_user_id),
    conn: sqlite3.Connection = Depends(get_conn),
) -> OutreachOut:
    """Human approval gate: the only code path that sets 'user_approved'."""
    _get_or_404(conn, user_id, outreach_id)
    repos.approve_outreach(conn, user_id, outreach_id)
    return _out(conn, user_id, _get_or_404(conn, user_id, outreach_id))


@router.post("/outreach/{outreach_id}/feedback", response_model=OutreachOut)
def feedback(
    outreach_id: int, body: FeedbackRequest, user_id: int = Depends(current_user_id),
    conn: sqlite3.Connection = Depends(get_conn),
) -> OutreachOut:
    """Memory: your verdict on a draft. Notes shape the tone of future drafts (never facts)."""
    _get_or_404(conn, user_id, outreach_id)
    repos.save_feedback(conn, user_id, outreach_id, body.rating, body.note.strip())
    return _out(conn, user_id, _get_or_404(conn, user_id, outreach_id))


@router.delete("/outreach/{outreach_id}", status_code=204)
def delete(
    outreach_id: int, user_id: int = Depends(current_user_id),
    conn: sqlite3.Connection = Depends(get_conn),
) -> None:
    if not repos.delete_outreach(conn, user_id, outreach_id):
        raise HTTPException(404, "draft not found")
