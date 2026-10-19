"""Greenhouse public Job Board API (no key): boards-api.greenhouse.io."""
from typing import Any

from nextrole.models.job import Job
from nextrole.sources.base import Board, BoardSource, build_job
from nextrole.text import html_to_text


class GreenhouseSource(BoardSource):
    name = "greenhouse"

    def url(self, slug: str) -> str:
        return f"https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true"

    def parse(self, board: Board, payload: Any) -> list[Job]:
        jobs = (build_job(
            source=self.name,
            source_id=str(j["id"]),
            title=j.get("title", ""),
            company=j.get("company_name") or board.company,
            location=(j.get("location") or {}).get("name", ""),
            description=html_to_text(j.get("content", "")),
            apply_url=j.get("absolute_url", ""),
        ) for j in payload.get("jobs", []))
        # The board endpoint only lists open postings, so there is no closed flag to filter on.
        return [j for j in jobs if j]
