"""Discovery fan-out: query many boards in parallel with timeouts and graceful fallback.

Design decisions:
- Each board is fetched independently under a semaphore (politeness + bounded concurrency).
- A failing board never fails the run: its error is recorded in `DiscoveryResult.errors`
  and the others still return. The UI/trace can show which sources degraded.
- Filtering by the user's preferences happens after fetch, deterministically (no LLM).
"""
import asyncio
import json
from dataclasses import dataclass, field
from pathlib import Path

import httpx

from nextrole.models.company import normalize_company
from nextrole.models.job import Job
from nextrole.models.profile import Preferences
from nextrole.roles.taxonomy import roles_match
from nextrole.sources.ashby import AshbySource
from nextrole.sources.base import Board, BoardSource
from nextrole.sources.dedupe import dedupe
from nextrole.sources.greenhouse import GreenhouseSource
from nextrole.sources.lever import LeverSource

SOURCES: dict[str, BoardSource] = {s.name: s for s in (GreenhouseSource(), LeverSource(), AshbySource())}
BOARDS_FILE = Path(__file__).parent.parent / "data" / "boards.json"


def load_boards(path: Path = BOARDS_FILE) -> list[Board]:
    return [Board(**b) for b in json.loads(path.read_text(encoding="utf-8"))]


@dataclass
class DiscoveryResult:
    jobs: list[Job] = field(default_factory=list)
    errors: dict[str, str] = field(default_factory=dict)  # "source:slug" -> error
    # Every job id returned by boards that answered, BEFORE preference filtering. Saved jobs whose
    # id is missing here (and whose source had no errors) are no longer listed by their employer.
    seen_ids: set[str] = field(default_factory=set)
    sources_checked: set[str] = field(default_factory=set)


def matches(job: Job, prefs: Preferences) -> bool:
    """Keep jobs whose title matches any desired role (through the role taxonomy, so SDE ==
    Software Development Engineer) and whose location fits."""
    if prefs.roles and not roles_match(job.title, prefs.roles):
        return False
    if prefs.locations or prefs.remote_ok:
        loc = job.location.lower()
        wanted = [x.lower() for x in prefs.locations]
        is_remote = job.remote or "remote" in loc
        in_location = not wanted or any(w in loc for w in wanted)
        if not (in_location or (prefs.remote_ok and is_remote)):
            return False
    return True


@dataclass
class FetchResult:
    """Everything the boards returned, unfiltered, grouped by company."""

    by_company: dict[str, list[Job]] = field(default_factory=dict)  # normalized company name -> jobs
    errors: dict[str, str] = field(default_factory=dict)
    sources_checked: set[str] = field(default_factory=set)

    @property
    def all_jobs(self) -> list[Job]:
        return [j for jobs in self.by_company.values() for j in jobs]


async def fetch_boards(
    boards: list[Board],
    *,
    timeout_s: float = 15.0,
    concurrency: int = 8,
    client: httpx.AsyncClient | None = None,
) -> FetchResult:
    """Fetch every board in parallel (bounded, with timeouts); a failing board is recorded, never fatal.
    Shared by recommendation discovery and the alert job, so both see the same postings."""
    result = FetchResult(sources_checked={b.source for b in boards})
    sem = asyncio.Semaphore(concurrency)
    own_client = client is None
    client = client or httpx.AsyncClient(timeout=timeout_s, follow_redirects=True)

    async def one(board: Board) -> tuple[Board, list[Job]]:
        async with sem:
            try:
                return board, await asyncio.wait_for(
                    SOURCES[board.source].fetch(client, board), timeout=timeout_s * 2
                )
            except Exception as exc:  # noqa: BLE001 - graceful fallback: record and continue
                result.errors[f"{board.source}:{board.slug}"] = repr(exc)
                return board, []

    try:
        batches = await asyncio.gather(*(one(b) for b in boards))
    finally:
        if own_client:
            await client.aclose()
    for board, jobs in batches:
        result.by_company.setdefault(normalize_company(board.company), []).extend(jobs)
    return result


async def discover(
    boards: list[Board],
    prefs: Preferences,
    *,
    timeout_s: float = 15.0,
    concurrency: int = 8,
    client: httpx.AsyncClient | None = None,
) -> DiscoveryResult:
    fetched = await fetch_boards(boards, timeout_s=timeout_s, concurrency=concurrency, client=client)
    jobs = fetched.all_jobs
    return DiscoveryResult(
        jobs=dedupe([j for j in jobs if matches(j, prefs)]), errors=fetched.errors,
        seen_ids={j.id for j in jobs}, sources_checked=fetched.sources_checked,
    )
