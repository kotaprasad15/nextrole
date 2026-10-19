"""Connector base class for public ATS job boards.

Design decisions:
- A connector only does two things: build the board URL and normalize the payload into `Job`s.
  Fetching (timeout, retries) is shared here so every source gets identical resilience.
- `apply_url` is copied verbatim from the API response. Jobs whose URL fails https validation
  are skipped individually rather than failing the whole board.
"""
import logging
from abc import ABC, abstractmethod
from typing import Any

import httpx
from pydantic import BaseModel, ValidationError
from tenacity import retry, retry_if_exception, stop_after_attempt, wait_exponential

from nextrole.models.job import Job

log = logging.getLogger(__name__)


class Board(BaseModel):
    """One company's public job board on an ATS."""

    company: str
    source: str  # "greenhouse" | "lever"
    slug: str


def _is_transient(exc: BaseException) -> bool:
    if isinstance(exc, (httpx.TransportError, httpx.TimeoutException)):
        return True
    return isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code >= 500


class BoardSource(ABC):
    name: str

    @abstractmethod
    def url(self, slug: str) -> str: ...

    @abstractmethod
    def parse(self, board: Board, payload: Any) -> list[Job]:
        """Normalize a raw API payload into Jobs (use `build_job` to skip bad rows)."""

    async def fetch(self, client: httpx.AsyncClient, board: Board, retries: int = 3) -> list[Job]:
        @retry(
            retry=retry_if_exception(_is_transient),
            stop=stop_after_attempt(retries),
            wait=wait_exponential(multiplier=0.5, max=4),
            reraise=True,
        )
        async def _get() -> Any:
            resp = await client.get(self.url(board.slug))
            resp.raise_for_status()
            return resp.json()

        return self.parse(board, await _get())


def build_job(**fields: Any) -> Job | None:
    """Construct a Job, returning None (and logging) if the row is invalid."""
    try:
        return Job(**fields)
    except ValidationError as exc:
        log.warning("skipping invalid job %s: %s", fields.get("source_id"), exc.errors()[0]["msg"])
        return None
