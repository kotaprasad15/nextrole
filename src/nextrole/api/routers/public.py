"""Public, read-only data for the marketing homepage (no login, no user data).

Design decisions:
- Real postings only: rows already fetched by the source connectors (https apply URL copied verbatim),
  or, on a fresh install with an empty cache, a small live sample from two curated boards that is
  remembered in memory for an hour. Any failure returns an empty list and the UI shows a generic card.
- No match score and no draft: those need a user's profile, so an anonymous visitor cannot have them.
"""
import asyncio
import time

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel

from nextrole.api.deps import get_conn
from nextrole.db import repos
from nextrole.models.job import Job
from nextrole.models.profile import Preferences
from nextrole.sources.registry import load_boards

router = APIRouter(prefix="/public")

LIVE_TTL_S = 3600
LIVE_TIMEOUT_S = 12.0
LIVE_BOARDS = 2


class FeaturedJob(BaseModel):
    title: str
    company: str
    location: str
    remote: bool
    tier: str | None  # startup | mid | mnc, only when already known
    source: str  # greenhouse | lever | ashby
    apply_url: str  # from the source API, never generated


def _out(job: Job, tier: str | None) -> FeaturedJob:
    return FeaturedJob(
        title=job.title, company=job.company, location=job.location, remote=job.remote,
        tier=tier, source=job.source, apply_url=str(job.apply_url),
    )


async def _live_sample(request: Request) -> list[tuple[Job, str | None]]:
    memo = getattr(request.app.state, "featured_memo", None)
    if memo and time.monotonic() - memo[0] < LIVE_TTL_S:
        return memo[1]
    rows: list[tuple[Job, str | None]] = []
    try:
        found = await asyncio.wait_for(
            request.app.state.discover(load_boards()[:LIVE_BOARDS], Preferences()), LIVE_TIMEOUT_S)
        per_company: dict[str, Job] = {}
        for job in found.jobs:
            if job.apply_url is not None and job.is_open:
                per_company.setdefault(job.company, job)
        rows = [(j, None) for j in list(per_company.values())[:3]]
    except Exception:  # noqa: BLE001 - the public page must never fail because a board did
        rows = []
    request.app.state.featured_memo = (time.monotonic(), rows)
    return rows


@router.get("/featured-jobs", response_model=list[FeaturedJob])
async def featured_jobs(request: Request, response: Response, conn=Depends(get_conn)) -> list[FeaturedJob]:
    response.headers["Cache-Control"] = "public, max-age=300"
    rows = repos.list_featured_jobs(conn, 3) or await _live_sample(request)
    return [_out(j, t) for j, t in rows]
