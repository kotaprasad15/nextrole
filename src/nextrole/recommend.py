"""Recommendation pipeline: discover -> tier -> select per tier -> match -> persist.

Design decision: a plain async function for now. Milestone f wraps these same steps as
LangGraph nodes under the Orchestrator (budget/loop enforcement, step streaming); the
agents themselves don't change.
"""
import sqlite3
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field

from nextrole.agents.matcher import MatcherAgent, select_candidates
from nextrole.agents.tiering import TieringAgent
from nextrole.config import Settings
from nextrole.db import repos
from nextrole.llm.client import LLMClient
from nextrole.models.profile import Profile
from nextrole.sources.registry import DiscoveryResult, load_boards

DiscoverFn = Callable[..., Awaitable[DiscoveryResult]]


@dataclass
class RecommendationRun:
    discovered: int = 0
    candidates: int = 0
    matched: int = 0
    source_errors: dict[str, str] = field(default_factory=dict)


async def run_recommendations(
    *, user_id: int, profile: Profile, conn: sqlite3.Connection, llm: LLMClient,
    settings: Settings, discover: DiscoverFn,
) -> RecommendationRun:
    found = await discover(load_boards(), profile.preferences)
    run = RecommendationRun(discovered=len(found.jobs), source_errors=found.errors)

    # Tier every discovered company first (one batched, cached call) so candidates can be
    # chosen per tier; the dashboard shows three sections and each needs real candidates.
    tiers = await TieringAgent(llm, conn, settings).classify(sorted({j.company for j in found.jobs}))
    candidates = select_candidates(
        found.jobs, tiers, profile, settings.match_candidates, settings.per_company_cap
    )
    run.candidates = len(candidates)
    if not candidates:
        repos.replace_matches(conn, user_id, [])
        return run

    repos.save_jobs(conn, candidates)
    matches = await MatcherAgent(llm, settings).score_all(profile, candidates)
    repos.replace_matches(conn, user_id, matches)
    run.matched = len(matches)
    return run
