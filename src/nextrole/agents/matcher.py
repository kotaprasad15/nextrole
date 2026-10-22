"""Matcher/Ranker: scores jobs against the profile (0-100) with strengths, gaps, rationale.

Design decisions:
- Two stages. A free deterministic prefilter (skill/role keyword overlap, per-company cap)
  narrows hundreds of jobs to the top N, and only those are scored by the LLM. That bounds
  cost and latency regardless of how many jobs discovery returns.
- One small call per job, run concurrently under a semaphore. A single failure (bad JSON,
  timeout) drops that job, not the run; hitting the budget stops further scoring and returns
  what was scored so far.
- The model is given the profile and one job and returns only a MatchScore. We attach the
  job_id ourselves, so the model never sees or emits URLs and can't mislabel rows.
"""
import asyncio
import logging
import re
from collections import Counter
from itertools import zip_longest

from nextrole.config import Settings
from nextrole.llm.budget import BudgetExceeded
from nextrole.llm.client import LLMClient
from nextrole.llm.untrusted import with_data_rule, wrap
from nextrole.models.company import CompanyTier, normalize_company
from nextrole.models.job import Job
from nextrole.models.match import MatchResult, MatchScore
from nextrole.models.profile import Profile

log = logging.getLogger(__name__)

SYSTEM = (
    "You score how well a job fits a candidate, from 0 to 100. Use ONLY facts stated in the "
    "candidate profile and the job posting; never assume skills or experience that are not "
    "listed. Scoring guide: 85-100 strong fit on core requirements and level; 65-84 good fit "
    "with minor gaps; 40-64 partial; under 40 poor fit (wrong field, level or major gaps). "
    "'strengths' are profile facts that match the job; 'gaps' are job requirements the profile "
    "lacks. 'rationale' is ONE sentence addressed to the candidate on why this fits. "
    "Keep every strength and gap under 12 words and list at most 4 of each. "
    "Do not include URLs."
)

_WORD = re.compile(r"[a-z0-9+#.]+")
_SENIOR = {"senior", "sr", "staff", "principal", "lead", "manager", "director", "head", "vp",
           "architect"}
_ENTRY = {"intern", "internship", "graduate", "grad", "entry", "junior", "jr", "associate",
          "apprentice", "early"}


def _level_adjust(title: str, level: str) -> int:
    """Seniority fit from the title: a new grad should not be shown Staff roles first.

    Deterministic and free, so it narrows candidates before any LLM spend. The LLM still makes
    the final call on fit; this only decides who gets scored at all.
    """
    words, level = _tokens(title), level.lower()
    entry = any(k in level for k in ("intern", "new grad", "junior", "entry"))
    senior = "senior" in level or "lead" in level
    if entry:
        return 4 * bool(words & _ENTRY) - 6 * bool(words & _SENIOR)
    if senior:
        return 3 * bool(words & _SENIOR) - 5 * bool(words & _ENTRY)
    return 0


def _tokens(text: str) -> set[str]:
    return set(_WORD.findall(text.lower()))


def prefilter(jobs: list[Job], profile: Profile, limit: int, per_company_cap: int) -> list[Job]:
    """Rank by cheap keyword overlap, cap per company, keep the top `limit`."""
    skills = {s.lower() for s in profile.skills}
    roles = [r.lower() for r in profile.preferences.roles]

    def score(job: Job) -> int:
        title = job.title.lower()
        hits = len(skills & _tokens(f"{job.title} {job.description}"))
        role_hit = 5 if any(r in title for r in roles) else 0
        return hits + role_hit + _level_adjust(job.title, profile.preferences.experience_level)

    ranked = sorted(jobs, key=score, reverse=True)
    per_company: Counter[str] = Counter()
    kept: list[Job] = []
    for job in ranked:
        if per_company[job.company] >= per_company_cap:
            continue
        per_company[job.company] += 1
        kept.append(job)
        if len(kept) == limit:
            break
    return kept


def select_candidates(
    jobs: list[Job], tiers: dict[str, CompanyTier], profile: Profile, limit: int, cap: int
) -> list[Job]:
    """Pick the jobs to score so every dashboard section gets a fair share.

    A single global top-N lets whichever tier has the most (or most keyword-rich) postings
    crowd out the others. Instead, rank within each tier, then take round-robin across tiers:
    an equal share each, with unused slots automatically going to the tiers that have more.
    """
    by_tier: dict[str, list[Job]] = {"startup": [], "mid": [], "mnc": []}
    for job in jobs:
        tier = tiers.get(normalize_company(job.company))
        by_tier[tier.tier if tier else "mid"].append(job)
    ranked = [prefilter(group, profile, limit, cap) for group in by_tier.values()]
    interleaved = [j for row in zip_longest(*ranked) for j in row if j]
    return interleaved[:limit]


def _profile_for_prompt(profile: Profile) -> str:
    """Prompt payload: no contact details, only what matching needs."""
    return profile.model_dump_json(exclude={"preferences": {"extras"}})


class MatcherAgent:
    def __init__(self, llm: LLMClient, settings: Settings) -> None:
        self.llm, self.settings = llm, settings

    async def score_one(self, profile: Profile, job: Job) -> MatchResult:
        user = (
            "Score this job for this candidate.\n\n"
            + wrap("candidate_profile", _profile_for_prompt(profile)) + "\n\n"
            + wrap("job_posting", f"{job.title} at {job.company} ({job.location})\n{job.description}",
                   max_chars=2800)
        )
        s = await self.llm.complete_json(
            agent="matcher", model=self.settings.model_fast, system=with_data_rule(SYSTEM), user=user,
            schema=MatchScore, max_tokens=1000,  # headroom: truncated JSON costs a retry
        )
        return MatchResult(job_id=job.id, **s.model_dump())

    async def score_all(self, profile: Profile, jobs: list[Job]) -> list[MatchResult]:
        sem = asyncio.Semaphore(self.settings.match_concurrency)
        out_of_budget = asyncio.Event()

        async def one(job: Job) -> MatchResult | None:
            async with sem:
                if out_of_budget.is_set():
                    return None
                try:
                    return await self.score_one(profile, job)
                except BudgetExceeded:
                    out_of_budget.set()
                    return None
                except Exception as exc:  # noqa: BLE001 - one bad job must not fail the run
                    log.warning("matcher skipped %s: %r", job.id, exc)
                    return None

        results = await asyncio.gather(*(one(j) for j in jobs))
        return sorted((r for r in results if r), key=lambda r: r.score, reverse=True)
