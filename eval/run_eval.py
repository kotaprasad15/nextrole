"""Evaluation CLI. Run from the repo root, e.g. `uv run python -m eval.run_eval outreach`.

  outreach   [--limit N] [--concurrency 3] [--max-cost USD]   baseline vs multi-agent, 30 postings
  tiering    [--repeats 3]                                     50 hand-labeled companies
  p10-sheet  [--llm-proxy]                                     build the blinded rating sheet
  p10-score  [--ratings FILE] [--proxy]                        precision@10 from ratings
  review-sheet [--n 10]  /  review-score                      human check of the blind judge
  report     [--update-readme]                                 render markdown tables

Everything calls the real model configured in `.env` and spends real tokens; `outreach` is
the expensive one (about 12 model calls per posting). Results are saved as JSON in
`eval/results/` so the report can be regenerated without re-running anything.
"""
import argparse
import asyncio
import json
import uuid
from pathlib import Path
from types import SimpleNamespace

import httpx

from eval import report
from eval.build_dataset import DATASETS, load_profile_ids, load_profiles
from eval.human_review import build_review_sheet, score_review, write_review_sheet
from eval.judge import Judges
from eval.outreach_eval import run_outreach_eval
from eval.p10_eval import (
    build_sheet,
    llm_rate,
    read_ratings,
    save_json,
    score_p10,
    write_sheet,
)
from eval.tiering_eval import load_rows, run_tiering_eval
from nextrole.config import Settings, get_settings
from nextrole.llm.budget import Budget
from nextrole.llm.client import LLMClient
from nextrole.models.job import Job
from nextrole.sources.registry import discover

RESULTS = Path(__file__).parent / "results"
REPO = Path(__file__).parent.parent


class ColdCacheClient:
    """Prefix every request's system prompt with a unique nonce.

    Providers cache by prompt prefix, so identical prompts (the baseline's are identical from
    run to run) would be served from cache: cheaper and faster than the pipeline's varied
    prompts. A unique prefix defeats that for every call in every system, keeping the cost and
    latency comparison fair. Costs a handful of tokens per call.
    """

    def __init__(self, inner) -> None:
        self._inner = inner
        self.messages = SimpleNamespace(create=self._create)

    async def _create(self, **kw):
        kw["system"] = f"[eval-run {uuid.uuid4().hex[:10]}]\n{kw['system']}"
        return await self._inner.messages.create(**kw)


def make_new_llm(settings: Settings):
    """Fresh client + budget per system run. Caps are generous: the eval must not truncate
    a run; total spend is bounded separately by --max-cost."""
    def new_llm() -> LLMClient:
        budget = Budget(2_000_000, 25.0, settings.price_in_per_mtok, settings.price_out_per_mtok)
        llm = LLMClient(settings, budget)
        llm._client = ColdCacheClient(llm._client)
        return llm
    return new_llm


def http_factory() -> httpx.AsyncClient:
    return httpx.AsyncClient(headers={"User-Agent": "NextRole-eval/0.1"}, timeout=15)


def profiles_by_id() -> dict:
    return dict(zip(load_profile_ids(), load_profiles(), strict=True))


async def cmd_outreach(a: argparse.Namespace, settings: Settings) -> None:
    path = DATASETS / "postings_30.jsonl"
    postings = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]
    if a.limit:
        postings = postings[: a.limit]
    print(f"{len(postings)} postings; models fast={settings.model_fast} strong={settings.model_strong}")
    data = await run_outreach_eval(
        postings, profiles_by_id(), settings, new_llm=make_new_llm(settings),
        http_factory=http_factory, concurrency=a.concurrency, max_total_cost=a.max_cost)
    save_json(data, RESULTS / "outreach.json")
    print(report.render_outreach(data))


async def cmd_tiering(a: argparse.Namespace, settings: Settings) -> None:
    holdout = a.dataset == "holdout"
    rows = load_rows(DATASETS / "tiering_holdout_20.csv") if holdout else load_rows()
    data = await run_tiering_eval(rows, settings, make_new_llm(settings), a.repeats)
    save_json(data, RESULTS / ("tiering_holdout.json" if holdout else "tiering.json"))
    print(report.render_tiering(data, "held-out" if holdout else "development"))


async def cmd_p10_sheet(a: argparse.Namespace, settings: Settings) -> None:
    profiles = profiles_by_id()
    rows, key = await build_sheet(profiles, settings, make_new_llm(settings), discover, http_factory)
    write_sheet(rows, RESULTS / "p10_sheet.csv")
    save_json(key, RESULTS / "p10_key.json")
    print(f"wrote {len(rows)} rows -> {RESULTS / 'p10_sheet.csv'}. Rate each row 1 (relevant) or 0 "
          "in the `relevant` column, then run p10-score.")
    if a.llm_proxy:
        jobs = {}
        for pid in profiles:  # rebuild Job objects from the sheet rows for the judge
            for r in rows:
                if r["profile_id"] == pid:
                    jobs[r["job_id"]] = Job(source="eval", source_id=r["job_id"], title=r["title"],
                                            company=r["company"], location=r["location"],
                                            apply_url=r["apply_url"] or None)
        ratings = await llm_rate(rows, profiles, jobs, Judges(make_new_llm(settings)(), settings))
        proxy = [{**r, "relevant": ratings[(r["profile_id"], r["job_id"])]} for r in rows]
        write_sheet(proxy, RESULTS / "p10_ratings_llm.csv")
        print(f"LLM-judge proxy ratings -> {RESULTS / 'p10_ratings_llm.csv'} (NOT manual)")


def cmd_p10_score(a: argparse.Namespace) -> None:
    key = json.loads((RESULTS / "p10_key.json").read_text(encoding="utf-8"))
    path = Path(a.ratings) if a.ratings else RESULTS / ("p10_ratings_llm.csv" if a.proxy else "p10_sheet.csv")
    out = score_p10(key, read_ratings(path), "llm-proxy" if a.proxy else "manual")
    save_json(out, RESULTS / "p10.json")
    print(report.render_p10(out))


def cmd_review_sheet(a: argparse.Namespace) -> None:
    data = json.loads((RESULTS / "outreach.json").read_text(encoding="utf-8"))
    rows, key = build_review_sheet(data, a.n)
    write_review_sheet(rows, RESULTS / "human_review_sheet.csv")
    save_json(key, RESULTS / "human_review_key.json")
    print(f"wrote {len(rows)} blinded pairs -> {RESULTS / 'human_review_sheet.csv'}. Read each pair "
          "and put A, B or tie in the `prefer` column, then run review-score.")


def cmd_review_score(a: argparse.Namespace) -> None:
    key = json.loads((RESULTS / "human_review_key.json").read_text(encoding="utf-8"))
    out = score_review(Path(a.ratings) if a.ratings else RESULTS / "human_review_sheet.csv", key)
    save_json(out, RESULTS / "human_review.json")
    print(json.dumps(out, indent=2))


def cmd_report(a: argparse.Namespace) -> None:
    body = report.render()
    (RESULTS / "RESULTS.md").write_text(body, encoding="utf-8")
    if a.update_readme:
        report.update_readme(REPO / "README.md", body)
        print("README.md updated")
    else:
        print(body)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    o = sub.add_parser("outreach")
    o.add_argument("--limit", type=int, default=0)
    o.add_argument("--concurrency", type=int, default=3)
    o.add_argument("--max-cost", type=float, default=None)
    t = sub.add_parser("tiering")
    t.add_argument("--repeats", type=int, default=3)
    t.add_argument("--dataset", choices=["dev", "holdout"], default="dev")
    sub.add_parser("p10-sheet").add_argument("--llm-proxy", action="store_true")
    s = sub.add_parser("p10-score")
    s.add_argument("--ratings")
    s.add_argument("--proxy", action="store_true")
    r = sub.add_parser("review-sheet")
    r.add_argument("--n", type=int, default=10)
    rs = sub.add_parser("review-score")
    rs.add_argument("--ratings")
    sub.add_parser("report").add_argument("--update-readme", action="store_true")
    a = ap.parse_args()
    RESULTS.mkdir(exist_ok=True)
    settings = get_settings()
    if a.cmd == "outreach":
        asyncio.run(cmd_outreach(a, settings))
    elif a.cmd == "tiering":
        asyncio.run(cmd_tiering(a, settings))
    elif a.cmd == "p10-sheet":
        asyncio.run(cmd_p10_sheet(a, settings))
    elif a.cmd == "p10-score":
        cmd_p10_score(a)
    elif a.cmd == "review-sheet":
        cmd_review_sheet(a)
    elif a.cmd == "review-score":
        cmd_review_score(a)
    else:
        cmd_report(a)


if __name__ == "__main__":
    main()
