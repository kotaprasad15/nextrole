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

from nextrole.models.job import Job
from nextrole.models.profile import Preferences
from nextrole.sources.base import Board, BoardSource
from nextrole.sources.dedupe import dedupe
from nextrole.sources.greenhouse import GreenhouseSource
from nextrole.sources.lever import LeverSource

SOURCES: dict[str, BoardSource] = {s.name: s for s in (GreenhouseSource(), LeverSource())}
BOARDS_FILE = Path(__file__).parent.parent / "data" / "boards.json"


def load_boards(path: Path = BOARDS_FILE) -> list[Board]:
    return [Board(**b) for b in json.loads(path.read_text(encoding="utf-8"))]


@dataclass
class DiscoveryResult:
    jobs: list[Job] = field(default_factory=list)
    errors: dict[str, str] = field(default_factory=dict)  # "source:slug" -> error


def matches(job: Job, prefs: Preferences) -> bool:
    """Keep jobs whose title matches any desired role and whose location fits."""
    if prefs.roles:
        title = job.title.lower()
        if not any(r.lower() in title for r in prefs.roles):
            return False
    if prefs.locations or prefs.remote_ok:
        loc = job.location.lower()
        wanted = [x.lower() for x in prefs.locations]
        is_remote = job.remote or "remote" in loc
        in_location = not wanted or any(w in loc for w in wanted)
        if not (in_location or (prefs.remote_ok and is_remote)):
            return False
    return True


async def discover(
    boards: list[Board],
    prefs: Preferences,
    *,
    timeout_s: float = 15.0,
    concurrency: int = 8,
    client: httpx.AsyncClient | None = None,
) -> DiscoveryResult:
    result = DiscoveryResult()
    sem = asyncio.Semaphore(concurrency)
    own_client = client is None
    client = client or httpx.AsyncClient(timeout=timeout_s, follow_redirects=True)

    async def one(board: Board) -> list[Job]:
        async with sem:
            try:
                return await asyncio.wait_for(
                    SOURCES[board.source].fetch(client, board), timeout=timeout_s * 2
                )
            except Exception as exc:  # noqa: BLE001 - graceful fallback: record and continue
                result.errors[f"{board.source}:{board.slug}"] = repr(exc)
                return []

    try:
        batches = await asyncio.gather(*(one(b) for b in boards))
    finally:
        if own_client:
            await client.aclose()
    result.jobs = dedupe([j for batch in batches for j in batch if matches(j, prefs)])
    return result
