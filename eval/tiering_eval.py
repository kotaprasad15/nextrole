"""Experiment 2: tiering accuracy on 50 hand-labeled companies.

Two variants, because the product's MNC seed list can inflate accuracy on famous companies:
  * production : cache -> MNC seed list -> LLM fallback (what the app runs)
  * llm_only   : the seed list disabled, so the model's own knowledge is what's measured
Each variant runs several times on a fresh DB (the model is non-deterministic and the tier
cache would otherwise freeze the first answer). Borderline companies (near a size threshold)
are flagged in the dataset and reported separately, since either answer is defensible there.
"""
import csv
from collections import Counter
from collections.abc import Callable
from pathlib import Path

from eval import metrics
from nextrole.agents.tiering import TieringAgent
from nextrole.config import Settings
from nextrole.db.connection import connect
from nextrole.llm.client import LLMClient
from nextrole.models.company import normalize_company

CLASSES = ["startup", "mid", "mnc"]
DATASET = Path(__file__).parent / "datasets" / "tiering_50.csv"


def load_rows(path: Path = DATASET) -> list[dict]:
    with path.open(encoding="utf-8", newline="") as f:
        rows = list(csv.DictReader(f))
    for r in rows:
        r["borderline"] = r["borderline"].strip().lower() == "true"
        r["approx_employees"] = int(r["approx_employees"])
    return rows


async def _predict(rows: list[dict], settings: Settings, new_llm: Callable[[], LLMClient],
                   use_seed: bool) -> tuple[dict[str, str], dict[str, str]]:
    agent = TieringAgent(new_llm(), connect(":memory:"), settings)
    if not use_seed:
        agent.seed = set()
    out = await agent.classify([r["company"] for r in rows])
    preds = {r["company"]: out[normalize_company(r["company"])].tier for r in rows}
    methods = {r["company"]: out[normalize_company(r["company"])].method for r in rows}
    return preds, methods


async def run_tiering_eval(
    rows: list[dict], settings: Settings, new_llm: Callable[[], LLMClient], repeats: int = 3
) -> dict:
    result: dict = {"n": len(rows), "repeats": repeats, "variants": {}}
    labels = [r["label"] for r in rows]
    for variant, use_seed in (("production", True), ("llm_only", False)):
        runs, methods = [], {}
        for _ in range(repeats):
            preds, methods = await _predict(rows, settings, new_llm, use_seed)
            runs.append(preds)
        result["variants"][variant] = _score(rows, labels, runs, methods)
    return result


def _score(rows: list[dict], labels: list[str], runs: list[dict[str, str]],
           methods: dict[str, str]) -> dict:
    keep = [i for i, r in enumerate(rows) if not r["borderline"]]
    accs = [metrics.accuracy(labels, [p[r["company"]] for r in rows]) for p in runs]
    accs_clear = [metrics.accuracy([labels[i] for i in keep],
                                   [p[rows[i]["company"]] for i in keep]) for p in runs]
    summed = {t: {p: 0 for p in CLASSES} for t in CLASSES}
    for p in runs:
        for r in rows:
            summed[r["label"]][p[r["company"]]] += 1
    flat_labels = [r["label"] for _ in runs for r in rows]
    flat_preds = [p[r["company"]] for p in runs for r in rows]
    missed = []
    for r in rows:
        votes = Counter(p[r["company"]] for p in runs)
        majority, count = votes.most_common(1)[0]
        if majority != r["label"] or count < len(runs):
            missed.append({"company": r["company"], "label": r["label"], "borderline": r["borderline"],
                           "approx_employees": r["approx_employees"], "votes": dict(votes)})
    return {
        "accuracy_mean": metrics.mean(accs), "accuracy_min": min(accs), "accuracy_max": max(accs),
        "accuracy_excl_borderline_mean": metrics.mean(accs_clear),
        "n_excl_borderline": len(keep),
        "per_class": metrics.per_class_prf(flat_labels, flat_preds, CLASSES),
        "confusion_summed_over_runs": summed, "disagreements_or_errors": missed,
        "seed_methods": sum(1 for m in methods.values() if m == "seed"),
    }
