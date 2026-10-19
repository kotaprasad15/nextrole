"""Recommendation pipeline entry point.

The steps (discover -> tier -> select per tier -> match -> save) live in the orchestrator
graph (`nextrole.orchestrator`), which also powers the streamed `/runs` API. This wrapper runs
that same graph to completion for callers that just want the result.
"""
import sqlite3
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field

import httpx

from nextrole.config import Settings
from nextrole.llm.budget import BudgetExceeded
from nextrole.llm.client import LLMClient
from nextrole.models.profile import Profile
from nextrole.orchestrator.graph import run_graph
from nextrole.orchestrator.state import Deps
from nextrole.sources.registry import DiscoveryResult

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
    async with httpx.AsyncClient() as http:
        deps = Deps(llm=llm, settings=settings, conn=conn, http=http, discover=discover)
        final = await run_graph("recommend", deps, {"user_id": user_id, "profile": profile})
    result = final.get("result", {})
    if final.get("abort"):
        raise (BudgetExceeded if final.get("error_kind") == "budget" else ValueError)(
            final.get("error", "run failed"))
    return RecommendationRun(
        discovered=result.get("discovered", 0), candidates=result.get("candidates", 0),
        matched=result.get("matched", 0), source_errors=result.get("source_errors", {}))
