"""Experiment 3: recommendation relevance, precision@10 on the 5 sample profiles.

Two rankings are compared on the SAME discovered job pool per profile:
  * matcher : the production pipeline (tier-balanced selection, then LLM scoring)
  * keyword : the deterministic prefilter alone (skill/role keyword overlap + seniority fit)
so the report can say whether the LLM Matcher actually beats a free baseline.

Relevance must be rated by a human. `build_sheet` writes a BLINDED rating sheet (rows are
shuffled and carry no system label; a separate key file maps rows back to systems). Fill the
`relevant` column with 1 or 0 (would this candidate reasonably apply, right field and right
seniority?) and run `p10-score`. An optional LLM-judge proxy can pre-fill ratings so the
report is not empty, but it is always labelled "LLM-judged", never "manual".
"""
import csv
import json
import random
from collections.abc import Callable
from pathlib import Path

from eval import metrics
from eval.judge import Judges
from nextrole.agents.matcher import prefilter
from nextrole.config import Settings
from nextrole.db import repos
from nextrole.db.connection import connect
from nextrole.llm.client import LLMClient
from nextrole.models.job import Job
from nextrole.models.profile import Profile
from nextrole.orchestrator.graph import run_graph
from nextrole.orchestrator.state import Deps

K = 10
SHEET_FIELDS = ["profile_id", "job_id", "company", "title", "location", "apply_url", "relevant"]


async def run_recommender(
    profile: Profile, settings: Settings, new_llm: Callable[[], LLMClient], discover, http_factory,
) -> tuple[list[Job], list[Job]]:
    """Return (matcher top-K, keyword top-K) for one profile from one shared job pool."""
    conn = connect(":memory:")
    user_id = repos.create_user(conn, "eval@example.com", "x")  # matches have a FK to users
    async with http_factory() as http:
        deps = Deps(llm=new_llm(), settings=settings, conn=conn, http=http, discover=discover)
        final = await run_graph("recommend", deps, {"user_id": user_id, "profile": profile})
    if final.get("abort"):
        raise RuntimeError(final.get("error", "recommend run failed"))
    pool = final["found"].jobs
    by_id = {j.id: j for j in final["candidates"]}
    ranked = sorted(final["matches"], key=lambda m: m.score, reverse=True)
    matcher = [by_id[m.job_id] for m in ranked if m.job_id in by_id][:K]
    keyword = prefilter(pool, profile, K, settings.per_company_cap)
    return matcher, keyword


async def build_sheet(
    profiles: dict[str, Profile], settings: Settings, new_llm: Callable[[], LLMClient],
    discover, http_factory, seed: int = 0, progress: Callable[[str], None] = print,
) -> tuple[list[dict], dict]:
    rows: list[dict] = []
    key: dict[str, dict] = {}
    for pid, profile in profiles.items():
        matcher, keyword = await run_recommender(profile, settings, new_llm, discover, http_factory)
        key[pid] = {"matcher": [j.id for j in matcher], "keyword": [j.id for j in keyword]}
        unique = {j.id: j for j in [*matcher, *keyword]}
        batch = [{"profile_id": pid, "job_id": j.id, "company": j.company, "title": j.title,
                  "location": j.location, "apply_url": j.apply_url or "", "relevant": ""}
                 for j in unique.values()]
        random.Random(f"{seed}:{pid}").shuffle(batch)  # blind: order carries no signal
        rows += batch
        progress(f"{pid}: {len(matcher)} matcher + {len(keyword)} keyword -> {len(unique)} rows to rate")
    return rows, key


def write_sheet(rows: list[dict], path: Path) -> None:
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=SHEET_FIELDS)
        w.writeheader()
        w.writerows(rows)


def read_ratings(path: Path) -> dict[tuple[str, str], int | None]:
    """(profile_id, job_id) -> 1 / 0 / None (unrated)."""
    out: dict[tuple[str, str], int | None] = {}
    with path.open(encoding="utf-8", newline="") as f:
        for r in csv.DictReader(f):
            v = (r.get("relevant") or "").strip().lower()
            out[(r["profile_id"], r["job_id"])] = (
                1 if v in {"1", "y", "yes", "true"} else 0 if v in {"0", "n", "no", "false"} else None)
    return out


async def llm_rate(rows: list[dict], profiles: dict[str, Profile], jobs: dict[str, Job],
                   judges: Judges) -> dict[tuple[str, str], int]:
    out = {}
    for r in rows:
        verdict = await judges.relevant(profiles[r["profile_id"]], jobs[r["job_id"]])
        out[(r["profile_id"], r["job_id"])] = int(verdict.relevant)
    return out


def score_p10(key: dict, ratings: dict[tuple[str, str], int | None], source: str) -> dict:
    """Per-profile and macro precision@10 for both systems from a ratings table."""
    systems: dict[str, dict] = {}
    for system in ("matcher", "keyword"):
        per_profile = {}
        for pid, lists in key.items():
            rel = [ratings.get((pid, jid)) for jid in lists[system][:K]]
            if any(r is None for r in rel):
                missing = sum(r is None for r in rel)
                raise ValueError(f"{pid}/{system}: {missing} unrated rows; finish rating first")
            per_profile[pid] = metrics.precision_at_k([int(r) for r in rel], K)
        vals = list(per_profile.values())
        lo, hi = metrics.bootstrap_ci(vals)
        systems[system] = {"per_profile": per_profile, "macro": metrics.mean(vals),
                           "lo": lo, "hi": hi}
    a = [systems["matcher"]["per_profile"][p] for p in key]
    b = [systems["keyword"]["per_profile"][p] for p in key]
    d, lo, hi = metrics.paired_diff(a, b)
    return {"source": source, "k": K, "profiles": len(key), "systems": systems,
            "diff_matcher_minus_keyword": {"diff": d, "lo": lo, "hi": hi,
                                           "reading": metrics.verdict(lo, hi)}}


def save_json(obj: dict, path: Path) -> None:
    path.write_text(json.dumps(obj, indent=2), encoding="utf-8")
