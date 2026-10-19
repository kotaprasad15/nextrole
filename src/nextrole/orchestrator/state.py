"""Shared state and dependencies for orchestrated runs.

`RunState` is the LangGraph state: one typed dict that every step reads and updates. Steps
return partial updates; the Orchestrator node owns routing keys (`next`, `steps`, `rewrites`).
`Deps` carries everything with side effects (LLM, DB, HTTP, event sink) so nodes stay thin
and tests can inject fakes.
"""
import sqlite3
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, TypedDict

import httpx

from nextrole.config import Settings
from nextrole.llm.client import LLMClient
from nextrole.models.company import CompanyTier
from nextrole.models.job import Job
from nextrole.models.match import MatchResult
from nextrole.models.outreach import CriticReport, OutreachDraft
from nextrole.models.profile import Profile
from nextrole.models.research import CompanyResearch, Fact
from nextrole.orchestrator.events import EventSink
from nextrole.sources.base import Board
from nextrole.sources.registry import DiscoveryResult, load_boards
from nextrole.tools.netguard import Resolver, system_resolver


class RunState(TypedDict, total=False):
    # inputs
    mode: str  # recommend | outreach | single_job
    user_id: int
    profile: Profile
    channel: str
    recipient_name: str
    url: str
    text: str
    # routing (owned by the orchestrator node)
    plan: list[str]
    next: str
    last: str
    steps: int
    rewrites: int
    # recommend pipeline
    found: DiscoveryResult
    tiers: dict[str, CompanyTier]
    candidates: list[Job]
    matches: list[MatchResult]
    # outreach pipeline
    job: Job
    research: CompanyResearch | None
    facts: list[Fact]
    memory: Any
    draft: OutreachDraft
    best: tuple[OutreachDraft, CriticReport]
    previous: tuple[OutreachDraft, CriticReport]
    attempts: int
    reports: list[CriticReport]  # every critic report, in order (first draft -> last)
    passed: bool
    stop_loop: bool
    persist: bool  # False for the legacy sync wrappers that persist in the caller
    outreach_id: int
    # outcome
    warnings: list[str]
    abort: bool
    error: str
    error_kind: str  # budget | error | ingest
    status: str  # completed | failed
    result: dict[str, Any]


@dataclass
class Deps:
    llm: LLMClient
    settings: Settings
    conn: sqlite3.Connection
    http: httpx.AsyncClient
    discover: Callable[..., Any]
    sink: EventSink = field(default_factory=EventSink)
    boards_loader: Callable[[], list[Board]] = load_boards
    resolver: Resolver = system_resolver
