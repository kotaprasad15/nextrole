"""Dashboard data: refresh (runs the pipeline) and read recommendations grouped by tier."""
import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from nextrole.api.deps import current_user_id, get_conn, get_llm, get_settings_dep, rate_limit_user
from nextrole.config import Settings
from nextrole.db import repos
from nextrole.llm.client import LLMClient
from nextrole.recommend import run_recommendations

router = APIRouter()
TIERS = ("startup", "mid", "mnc")


class JobCard(BaseModel):
    job_id: str
    title: str
    company: str
    location: str
    remote: bool
    score: int
    rationale: str
    strengths: list[str]
    gaps: list[str]
    apply_url: str | None  # from source data (or user-supplied for pasted jobs); never LLM-made
    pasted: bool = False


class Recommendations(BaseModel):
    startup: list[JobCard] = []
    mid: list[JobCard] = []
    mnc: list[JobCard] = []


def _grouped(conn: sqlite3.Connection, user_id: int) -> Recommendations:
    groups: dict[str, list[JobCard]] = {t: [] for t in TIERS}
    for job, match, tier in repos.list_matches(conn, user_id):
        groups[tier].append(JobCard(
            job_id=job.id, title=job.title, company=job.company, location=job.location,
            remote=job.remote, score=match.score, rationale=match.rationale,
            strengths=match.strengths, gaps=match.gaps, apply_url=job.apply_url,
            pasted=job.source == "pasted",
        ))
    return Recommendations(**groups)


@router.get("/recommendations", response_model=Recommendations)
def get_recommendations(
    user_id: int = Depends(current_user_id), conn: sqlite3.Connection = Depends(get_conn)
) -> Recommendations:
    return _grouped(conn, user_id)


@router.post("/recommendations/refresh", dependencies=[rate_limit_user("refresh", 20, 3600)])
async def refresh(
    request: Request,
    user_id: int = Depends(current_user_id),
    conn: sqlite3.Connection = Depends(get_conn),
    settings: Settings = Depends(get_settings_dep),
    llm: LLMClient = Depends(get_llm),
) -> dict:
    profile = repos.get_profile(conn, user_id)
    if profile is None:
        raise HTTPException(409, "complete onboarding first")
    run = await run_recommendations(
        user_id=user_id, profile=profile, conn=conn, llm=llm, settings=settings,
        discover=request.app.state.discover,
    )
    return {
        "discovered": run.discovered, "candidates": run.candidates, "matched": run.matched,
        "source_errors": run.source_errors,
        "tokens": llm.budget.tokens_used, "cost_usd": round(llm.budget.cost_usd, 4),
    }
