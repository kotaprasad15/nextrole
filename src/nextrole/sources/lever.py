"""Lever public Postings API (no key): api.lever.co/v0/postings/{slug}."""
from typing import Any

from nextrole.models.job import Job
from nextrole.sources.base import Board, BoardSource, build_job


class LeverSource(BoardSource):
    name = "lever"

    def url(self, slug: str) -> str:
        return f"https://api.lever.co/v0/postings/{slug}?mode=json"

    def parse(self, board: Board, payload: Any) -> list[Job]:
        jobs = (build_job(
            source=self.name,
            source_id=str(p["id"]),
            title=p.get("text", ""),
            company=board.company,
            location=(p.get("categories") or {}).get("location", "") or "",
            remote=p.get("workplaceType") == "remote",
            description=p.get("descriptionPlain", ""),
            apply_url=p.get("hostedUrl", ""),
        ) for p in payload)
        return [j for j in jobs if j]
