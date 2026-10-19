"""Ashby public Job Posting API (no key): api.ashbyhq.com/posting-api/job-board/{slug}.

Popular with early-stage startups, which is what fills the "Startups" dashboard section.
"""
from typing import Any

from nextrole.models.job import Job
from nextrole.sources.base import Board, BoardSource, build_job


class AshbySource(BoardSource):
    name = "ashby"

    def url(self, slug: str) -> str:
        return f"https://api.ashbyhq.com/posting-api/job-board/{slug}"

    def parse(self, board: Board, payload: Any) -> list[Job]:
        jobs = (build_job(
            source=self.name,
            source_id=str(p["id"]),
            title=p.get("title", ""),
            company=board.company,
            location=p.get("location", "") or "",
            remote=bool(p.get("isRemote")) or p.get("workplaceType") == "Remote",
            description=p.get("descriptionPlain", ""),
            apply_url=p.get("jobUrl", ""),
        ) for p in payload.get("jobs", []) if p.get("isListed", True))  # drop unlisted/closed
        return [j for j in jobs if j]
