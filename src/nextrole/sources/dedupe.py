"""Cross-source deduplication.

Design decision: key on normalized (company, title, location). The same role is often listed
on several boards/aggregators with different ids and URLs. We keep the first occurrence, so
callers should pass jobs ordered by source trust (direct ATS boards before aggregators).
"""
import re

from nextrole.models.job import Job

_NON_ALNUM = re.compile(r"[^a-z0-9]+")


def _norm(s: str) -> str:
    return _NON_ALNUM.sub(" ", s.lower()).strip()


def dedupe(jobs: list[Job]) -> list[Job]:
    seen: set[tuple[str, str, str]] = set()
    out: list[Job] = []
    for job in jobs:
        key = (_norm(job.company), _norm(job.title), _norm(job.location))
        if key not in seen:
            seen.add(key)
            out.append(job)
    return out
