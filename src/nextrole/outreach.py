"""Outreach pipeline: research -> fact sheet -> write <-> critic loop.

Design decisions:
- Research is cached per company (it is public info shared by all users), so drafting several
  roles at one company costs one research run.
- The Writer<->Critic loop is hard-capped (`critic_max_retries` rewrites after the first
  draft). We keep the best draft seen (a pass beats any fail; otherwise highest score with the
  fewest unsupported claims), so a late bad rewrite can never replace a better earlier one.
- If the loop ends without a pass, we still return the best draft but with explicit warnings:
  the user always has the final say, and sees why the Critic was not satisfied.
- Budget exhaustion or a model failure mid-loop returns the best draft so far; it only raises
  if no draft was ever produced.
Milestone f wraps these same steps as Orchestrator/LangGraph nodes.
"""
import sqlite3
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

import httpx

from nextrole.agents.researcher import ResearcherAgent
from nextrole.config import Settings
from nextrole.llm.budget import BudgetExceeded
from nextrole.llm.client import LLMClient
from nextrole.models.company import normalize_company
from nextrole.models.job import Job
from nextrole.models.outreach import Channel, CriticReport, OutreachDraft
from nextrole.models.profile import Profile
from nextrole.models.research import CompanyResearch, Fact
from nextrole.tools.research_tools import ResearchTools


@dataclass
class OutreachResult:
    draft: OutreachDraft
    report: CriticReport
    facts: list[Fact]
    attempts: int
    warnings: list[str] = field(default_factory=list)
    reports: list[CriticReport] = field(default_factory=list)  # first draft -> last


def rank_report(report: CriticReport) -> tuple[int, int, int]:
    """Higher is better: pass first, then fewer problems, then higher score."""
    return (report.verdict == "pass", -(len(report.unsupported_claims) + len(report.violations)),
            report.overall)


def _cached_research(conn: sqlite3.Connection, key: str) -> CompanyResearch | None:
    row = conn.execute(
        "SELECT research_json, expires_at FROM research_cache WHERE company_key = ?", (key,)
    ).fetchone()
    if row and row["expires_at"] > datetime.now(UTC).isoformat():
        return CompanyResearch.model_validate_json(row["research_json"])
    return None


def _cache_research(conn: sqlite3.Connection, research: CompanyResearch, ttl_hours: int) -> None:
    if not research.facts:
        return  # don't cache empty results: a transient failure must not stick for a day
    expires = (datetime.now(UTC) + timedelta(hours=ttl_hours)).isoformat()
    conn.execute(
        """INSERT INTO research_cache (company_key, research_json, expires_at) VALUES (?, ?, ?)
           ON CONFLICT(company_key) DO UPDATE SET research_json = excluded.research_json,
                                                  expires_at = excluded.expires_at""",
        (research.company_key, research.model_dump_json(), expires),
    )
    conn.commit()


async def research_company(
    *, llm: LLMClient, settings: Settings, conn: sqlite3.Connection, http: httpx.AsyncClient,
    job: Job,
) -> CompanyResearch:
    key = normalize_company(job.company)
    if (hit := _cached_research(conn, key)) is not None:
        return hit
    tools = ResearchTools(http, conn, settings, job.apply_url)
    research = await ResearcherAgent(llm, settings).run(job, tools)
    _cache_research(conn, research, settings.research_cache_ttl_hours)
    return research


async def generate_outreach(
    *, llm: LLMClient, settings: Settings, conn: sqlite3.Connection, http: httpx.AsyncClient,
    profile: Profile, job: Job, channel: Channel = "email", recipient_name: str = "",
    user_id: int | None = None,
) -> OutreachResult:
    """Run research -> fact sheet -> write<->critic through the orchestrator graph and return
    the best draft. Persistence is left to the caller (`persist=False`); pass `user_id` to
    include that user's style memory."""
    from nextrole.orchestrator.graph import run_graph  # local import: nodes import this module
    from nextrole.orchestrator.state import Deps

    async def _no_discovery(*_a, **_k):  # outreach never discovers jobs
        raise RuntimeError("discovery is not part of the outreach pipeline")

    deps = Deps(llm=llm, settings=settings, conn=conn, http=http, discover=_no_discovery)
    final = await run_graph("outreach", deps, {
        "user_id": user_id or 0, "profile": profile, "job": job, "channel": channel,
        "recipient_name": recipient_name, "persist": False})
    if final.get("abort"):
        raise (BudgetExceeded if final.get("error_kind") == "budget" else ValueError)(
            final.get("error", "run failed"))
    draft, report = final["best"]
    return OutreachResult(draft, report, final["facts"], final["attempts"], final["warnings"],
                          final.get("reports", []))
