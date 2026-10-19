"""Experiment 1: single-agent baseline vs the multi-agent outreach pipeline.

For each posting (paired with the sample profile it was selected for) both systems write one
outreach email from the SAME profile and posting:
  * baseline: one prompt, no research, no critic (`agents/baseline.py`), strong model
  * multi-agent: research -> fact sheet -> writer <-> critic loop (the production graph)
Then independent judges (`eval/judge.py`) fact-check each draft against the sources that
system had, and a blind, order-randomised pairwise judge picks the better draft.

Fairness rules: same writer model; each system gets its own fresh Budget and fresh in-memory
DB (so no cross-posting research cache: cost and latency are cold-start numbers); judging
costs are tracked separately and excluded from system cost.
"""
import asyncio
import random
import time
from collections.abc import Callable
from typing import Any

import httpx

from eval import metrics
from eval.judge import Judges
from nextrole.agents.baseline import run_baseline
from nextrole.agents.critic import CriticAgent, rule_violations
from nextrole.agents.factsheet import build_fact_sheet
from nextrole.config import Settings
from nextrole.db.connection import connect
from nextrole.llm.client import LLMClient
from nextrole.models.job import Job
from nextrole.models.profile import Profile
from nextrole.outreach import generate_outreach

NewLLM = Callable[[], LLMClient]
HttpFactory = Callable[[], httpx.AsyncClient]


def to_job(p: dict) -> Job:
    return Job(source="eval", source_id=p["id"], title=p["title"], company=p["company"],
               location=p.get("location", ""), description=p["description"],
               apply_url=p["apply_url"])


def _usage(llm: LLMClient, seconds: float) -> dict:
    b = llm.budget
    return {"tokens": b.tokens_used, "cost_usd": b.cost_usd, "calls": b.calls,
            "latency_s": round(seconds, 2)}


async def _judge_draft(
    judges: Judges, critic: CriticAgent, draft, profile: Profile, job: Job, facts, research,
    saw_preferences: bool,
) -> dict:
    check = await judges.fact_check(draft.body, profile, job, research,
                                    saw_preferences=saw_preferences)
    report = await critic.review(draft, facts)
    unsupported = [c.text for c in check.claims if c.verdict == "unsupported"]
    overreach = [c.text for c in check.claims if c.verdict == "overreach"]
    # The baseline cannot cite fact ids by design, so that one rule is not counted against it.
    rules = [v for v in rule_violations(draft, facts) if "cites no facts" not in v]
    return {
        "body": draft.body, "subject": draft.subject, "words": len(draft.body.split()),
        "claims_total": len(check.claims), "claims_unsupported": len(unsupported),
        "claims_overreach": len(overreach), "unsupported_texts": unsupported,
        "overreach_texts": overreach, "rule_violations": rules,
        "critic_overall": report.overall, "critic_scores": report.scores,
    }


async def eval_one(
    posting: dict, profile: Profile, settings: Settings, new_llm: NewLLM,
    http_factory: HttpFactory, seed: int,
) -> dict:
    row: dict[str, Any] = {"id": posting["id"], "profile_id": posting["profile_id"],
                           "company": posting["company"], "title": posting["title"], "error": None}
    judge_llm = new_llm()
    judges, critic = Judges(judge_llm, settings), CriticAgent(judge_llm, settings)
    try:
        job = to_job(posting)  # inside the try: a malformed posting must fail alone
        # ---- baseline ----
        llm_b, t0 = new_llm(), time.perf_counter()
        draft_b = await run_baseline(llm_b, settings.model_strong, profile, job)
        usage_b = _usage(llm_b, time.perf_counter() - t0)
        facts_b = build_fact_sheet(profile, job, None)
        base = {**usage_b, **await _judge_draft(judges, critic, draft_b, profile, job, facts_b, None,
                                                True)}  # baseline saw the full profile JSON

        # ---- multi-agent ----
        llm_m, t0 = new_llm(), time.perf_counter()
        async with http_factory() as http:
            res = await generate_outreach(
                llm=llm_m, settings=settings, conn=connect(":memory:"), http=http,
                profile=profile, job=job, channel="email")
        usage_m = _usage(llm_m, time.perf_counter() - t0)
        research = [f for f in res.facts if f.source == "research"]
        multi = {**usage_m, **await _judge_draft(judges, critic, res.draft, profile, job,
                                                   res.facts, research, False)}
        multi.update(
            attempts=res.attempts, passed=res.report.verdict == "pass", warnings=res.warnings,
            research_facts=len(research),
            first_critic_overall=res.reports[0].overall if res.reports else res.report.overall)

        # ---- blind pairwise preference ----
        multi_first = random.Random(f"{seed}:{posting['id']}").random() < 0.5
        a, b = (multi, base) if multi_first else (base, multi)
        verdict = await judges.pairwise(a["body"], b["body"], profile, job)
        if verdict.winner == "tie":
            winner = "tie"
        else:
            first_wins = verdict.winner == "A"
            winner = "multi" if first_wins == multi_first else "baseline"
        row.update(baseline=base, multi=multi, pairwise={
            "winner": winner, "reason": verdict.reason, "multi_was_A": multi_first},
            judge_cost_usd=judge_llm.budget.cost_usd)
    except Exception as exc:  # noqa: BLE001 - one failed posting must not sink the experiment
        row["error"] = f"{type(exc).__name__}: {str(exc)[:200]}"
    return row


async def run_outreach_eval(
    postings: list[dict], profiles: dict[str, Profile], settings: Settings, *,
    new_llm: NewLLM, http_factory: HttpFactory, concurrency: int = 3, seed: int = 0,
    max_total_cost: float | None = None, progress: Callable[[str], None] = print,
) -> dict:
    sem, spent, rows = asyncio.Semaphore(concurrency), [0.0], []

    async def one(i: int, p: dict) -> None:
        async with sem:
            if max_total_cost is not None and spent[0] >= max_total_cost:
                rows.append({"id": p["id"], "error": "skipped: eval cost cap reached"})
                return
            row = await eval_one(p, profiles[p["profile_id"]], settings, new_llm, http_factory, seed)
            if not row["error"]:
                spent[0] += (row["baseline"]["cost_usd"] + row["multi"]["cost_usd"]
                             + row["judge_cost_usd"])
            rows.append(row)
            progress(f"[{len(rows)}/{len(postings)}] {p['company']} - {p['title'][:40]}: "
                     f"{row['error'] or row['pairwise']['winner']}")

    await asyncio.gather(*(one(i, p) for i, p in enumerate(postings)))
    return {"rows": sorted(rows, key=lambda r: r["id"]), "seed": seed,
            "settings": {"model_fast": settings.model_fast, "model_strong": settings.model_strong,
                         "price_in_per_mtok": settings.price_in_per_mtok,
                         "price_out_per_mtok": settings.price_out_per_mtok,
                         "critic_threshold": settings.critic_threshold,
                         "critic_max_retries": settings.critic_max_retries}}


# ---------------------------------------------------------------- summary

def _ci(xs: list[float]) -> dict:
    lo, hi = metrics.bootstrap_ci(xs)
    return {"mean": metrics.mean(xs), "lo": lo, "hi": hi}


def _diff(a: list[float], b: list[float]) -> dict:
    d, lo, hi = metrics.paired_diff(a, b)
    return {"diff": d, "lo": lo, "hi": hi, "reading": metrics.verdict(lo, hi)}


def summarize_outreach(data: dict) -> dict:
    ok = [r for r in data["rows"] if not r.get("error")]
    errors = [r for r in data["rows"] if r.get("error")]
    if not ok:
        return {"n_ok": 0, "n_error": len(errors), "errors": [e["error"] for e in errors][:5]}
    b, m = [r["baseline"] for r in ok], [r["multi"] for r in ok]
    col = lambda rows, k: [x[k] for x in rows]

    def _rate(rows: list[dict], key: str) -> float:
        total = sum(x["claims_total"] for x in rows)
        return sum(x[key] for x in rows) / total if total else float("nan")

    def claim_rate(rows: list[dict]) -> float:
        return _rate(rows, "claims_unsupported")

    wins, ties, losses = metrics.win_tie_loss(
        [{"multi": "win", "baseline": "loss", "tie": "tie"}[r["pairwise"]["winner"]] for r in ok])
    decisive = wins + losses
    lo, hi = metrics.wilson_ci(wins, decisive) if decisive else (float("nan"),) * 2
    attempts = [x["attempts"] for x in m]
    return {
        "n_ok": len(ok), "n_error": len(errors), "errors": [e["error"] for e in errors][:5],
        "critic": {
            "baseline": _ci(col(b, "critic_overall")), "multi_final": _ci(col(m, "critic_overall")),
            "multi_first": _ci(col(m, "first_critic_overall")),
            "multi_vs_baseline": _diff(col(m, "critic_overall"), col(b, "critic_overall")),
            "loop_effect": _diff(col(m, "critic_overall"), col(m, "first_critic_overall"))},
        "factuality": {
            "claim_error_rate": {"baseline": claim_rate(b), "multi": claim_rate(m)},
            "claims_per_draft": {"baseline": metrics.mean(col(b, "claims_total")),
                                 "multi": metrics.mean(col(m, "claims_total"))},
            "unsupported_per_draft": {"baseline": _ci(col(b, "claims_unsupported")),
                                      "multi": _ci(col(m, "claims_unsupported"))},
            "unsupported_diff_multi_minus_baseline": _diff(col(m, "claims_unsupported"),
                                                           col(b, "claims_unsupported")),
            "overreach_per_draft": {"baseline": _ci(col(b, "claims_overreach")),
                                    "multi": _ci(col(m, "claims_overreach"))},
            "overreach_diff_multi_minus_baseline": _diff(col(m, "claims_overreach"),
                                                         col(b, "claims_overreach")),
            "overreach_claim_rate": {"baseline": _rate(b, "claims_overreach"),
                                     "multi": _rate(m, "claims_overreach")},
            "drafts_with_any_unsupported": {
                "baseline": metrics.mean([float(x["claims_unsupported"] > 0) for x in b]),
                "multi": metrics.mean([float(x["claims_unsupported"] > 0) for x in m])},
            "rule_violation_drafts": {"baseline": sum(bool(x["rule_violations"]) for x in b),
                                      "multi": sum(bool(x["rule_violations"]) for x in m)}},
        "preference": {"multi_wins": wins, "ties": ties, "baseline_wins": losses,
                       "multi_share_of_decisive": wins / decisive if decisive else float("nan"),
                       "share_lo": lo, "share_hi": hi},
        "cost": {"baseline_usd": _ci(col(b, "cost_usd")), "multi_usd": _ci(col(m, "cost_usd")),
                 "baseline_tokens": metrics.mean(col(b, "tokens")),
                 "multi_tokens": metrics.mean(col(m, "tokens")),
                 "baseline_calls": metrics.mean(col(b, "calls")),
                 "multi_calls": metrics.mean(col(m, "calls")),
                 "ratio": metrics.mean(col(m, "cost_usd")) / max(metrics.mean(col(b, "cost_usd")), 1e-12)},
        "latency_s": {
            "baseline_p50": metrics.percentile(col(b, "latency_s"), 50),
            "baseline_p90": metrics.percentile(col(b, "latency_s"), 90),
            "multi_p50": metrics.percentile(col(m, "latency_s"), 50),
            "multi_p90": metrics.percentile(col(m, "latency_s"), 90)},
        "pipeline": {
            "passed_rate": metrics.mean([float(x["passed"]) for x in m]),
            "attempts_mean": metrics.mean(attempts),
            "needed_rewrite": sum(a > 1 for a in attempts),
            "runs_with_research_facts": sum(x["research_facts"] > 0 for x in m),
            "mean_words": {"baseline": metrics.mean(col(b, "words")),
                           "multi": metrics.mean(col(m, "words"))}},
    }
