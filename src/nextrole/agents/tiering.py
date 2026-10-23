"""Tiering agent: classify companies as startup / mid-size / MNC.

Resolution order (cheapest and most trustworthy first):
  1. cache (DB)             - every decision is cached, so each company costs at most one LLM call ever
  2. curated MNC seed list  - deterministic, no LLM
  3. employee-count metadata - deterministic thresholds, when a source exposes it
  4. LLM fallback           - one batched call for everything still unknown

Design decision: the LLM only sees company *names* it must classify, never user data, and
low-confidence answers are returned but not cached, so a bad guess can't stick.
"""
import json
import sqlite3
from pathlib import Path

from pydantic import BaseModel

from nextrole.config import Settings
from nextrole.db import repos
from nextrole.llm.client import LLMClient
from nextrole.llm.untrusted import with_data_rule, wrap
from nextrole.models.company import CompanyTier, Tier, normalize_company

SEED_FILE = Path(__file__).parent.parent / "data" / "mnc_seed.json"
MIN_CACHE_CONFIDENCE = 0.6

SYSTEM = (
    "Classify each company by size. For each one, estimate its current total number of "
    "employees from general knowledge, then pick: 'startup' = under ~200 employees; 'mid' = roughly 200 to 5000 "
    "employees; 'mnc' = over ~5000 employees. Size is decided by headcount ONLY. Being "
    "well known, venture-backed, publicly listed or having offices in several countries does "
    "NOT make a company an 'mnc': a famous software company with 1,500 people is 'mid'. "
    "Return one entry per company, using the exact name given, with `approx_employees` as a "
    "single number (use null only if you have no idea). If you do not recognise a company, "
    "still give your best guess but a low confidence (below 0.5)."
)


class _Item(BaseModel):
    company: str
    approx_employees: int | None = None
    tier: Tier
    confidence: float = 0.5


class _Batch(BaseModel):
    items: list[_Item]


def load_seed(path: Path = SEED_FILE) -> set[str]:
    return {normalize_company(n) for n in json.loads(path.read_text(encoding="utf-8"))}


def tier_from_employee_count(count: int, settings: Settings) -> Tier:
    if count <= settings.startup_max_employees:
        return "startup"
    return "mid" if count <= settings.mid_max_employees else "mnc"


class TieringAgent:
    def __init__(self, llm: LLMClient, conn: sqlite3.Connection, settings: Settings) -> None:
        self.llm, self.conn, self.settings = llm, conn, settings
        self.seed = load_seed()

    async def classify(
        self, companies: list[str], employee_counts: dict[str, int] | None = None
    ) -> dict[str, CompanyTier]:
        """Return {normalized company key: CompanyTier} for every distinct company."""
        counts = {normalize_company(k): v for k, v in (employee_counts or {}).items()}
        names = {normalize_company(c): c for c in companies}  # key -> a display name
        result = self.conn_cached(list(names))
        fresh: list[CompanyTier] = []

        for key in names:
            if key in result:
                continue
            if key in self.seed:
                fresh.append(CompanyTier(company_key=key, tier="mnc", method="seed"))
            elif key in counts:
                tier = tier_from_employee_count(counts[key], self.settings)
                fresh.append(CompanyTier(company_key=key, tier=tier, method="metadata"))
        for t in fresh:
            result[t.company_key] = t

        unknown = [k for k in names if k not in result]
        llm_tiers = await self._llm_classify({k: names[k] for k in unknown}) if unknown else []
        for t in llm_tiers:
            result[t.company_key] = t

        repos.save_tiers(
            self.conn, fresh + [t for t in llm_tiers if t.confidence >= MIN_CACHE_CONFIDENCE]
        )
        return result

    def conn_cached(self, keys: list[str]) -> dict[str, CompanyTier]:
        return repos.get_cached_tiers(self.conn, keys)

    async def _llm_classify(self, unknown: dict[str, str]) -> list[CompanyTier]:
        batch = await self.llm.complete_json(
            agent="tiering",
            model=self.settings.model_fast,
            system=with_data_rule(SYSTEM),
            user="Classify these companies.\n\n" + wrap("company_names", "\n".join(f"- {n}" for n in unknown.values())),
            schema=_Batch,
            max_tokens=400 + 80 * len(unknown),  # headroom: reasoning models may spend tokens first
        )
        out: dict[str, CompanyTier] = {}
        for item in batch.items:
            key = normalize_company(item.company)
            if key in unknown:  # ignore companies the model invented
                conf = min(max(item.confidence, 0.0), 1.0)
                # The model supplies knowledge (a headcount estimate); our configured thresholds
                # decide the tier, so tiers stay consistent with STARTUP/MID_MAX_EMPLOYEES and a
                # fuzzy notion of "big company" can't leak in. Its own tier is only a fallback.
                tier = (tier_from_employee_count(item.approx_employees, self.settings)
                        if item.approx_employees and item.approx_employees > 0 else item.tier)
                out[key] = CompanyTier(company_key=key, tier=tier, method="llm", confidence=conf)
        # Anything the model skipped defaults to 'mid' with zero confidence (never cached).
        for key in unknown.keys() - out.keys():
            out[key] = CompanyTier(company_key=key, tier="mid", method="llm", confidence=0.0)
        return list(out.values())
