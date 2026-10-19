"""Human check on the blind pairwise judge (the biggest validity threat in experiment 1).

The pairwise judge is an LLM from the same family as the pipeline's own Critic, so "the judge
prefers the multi-agent draft" may partly mean "two models with similar taste agree". This
module samples postings and writes a BLINDED sheet (draft A / draft B in random order, no
system labels) for a person to fill in, then scores the human's choices and reports how often
they agree with the judge. Ten pairs take about ten minutes and are worth more than any
amount of extra LLM judging.
"""
import csv
import json
import random
from pathlib import Path

from eval import metrics
from eval.build_dataset import DATASETS, load_profile_ids, load_profiles
from eval.judge import profile_text

FIELDS = ["posting_id", "candidate", "role", "posting_excerpt", "draft_A", "draft_B", "prefer", "notes"]


def _draft(d: dict) -> str:
    subject = f"Subject: {d['subject']}\n\n" if d.get("subject") else ""
    return subject + d["body"]


def build_review_sheet(outreach: dict, n: int = 10, seed: int = 0) -> tuple[list[dict], dict]:
    ok = [r for r in outreach["rows"] if not r.get("error")]
    chosen = random.Random(seed).sample(ok, min(n, len(ok)))
    postings = {json.loads(line)["id"]: json.loads(line) for line in
                (DATASETS / "postings_30.jsonl").read_text(encoding="utf-8").splitlines() if line}
    profiles = dict(zip(load_profile_ids(), load_profiles(), strict=True))
    rows, key = [], {}
    for r in chosen:
        multi_first = random.Random(f"human:{seed}:{r['id']}").random() < 0.5
        a, b = (r["multi"], r["baseline"]) if multi_first else (r["baseline"], r["multi"])
        post = postings[r["id"]]
        rows.append({
            "posting_id": r["id"], "candidate": profile_text(profiles[r["profile_id"]]),
            "role": f"{post['title']} at {post['company']}",
            "posting_excerpt": post["description"][:700], "draft_A": _draft(a),
            "draft_B": _draft(b), "prefer": "", "notes": ""})
        key[r["id"]] = {"A": "multi" if multi_first else "baseline",
                        "judge_winner": r["pairwise"]["winner"]}
    return rows, key


def write_review_sheet(rows: list[dict], path: Path) -> None:
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        w.writeheader()
        w.writerows(rows)


def score_review(path: Path, key: dict) -> dict:
    """Human choices -> multi-agent share of decisive picks, plus agreement with the LLM judge."""
    wins = losses = ties = agree = counted = 0
    with path.open(encoding="utf-8", newline="") as f:
        for r in csv.DictReader(f):
            choice = (r.get("prefer") or "").strip().upper()
            if choice not in {"A", "B", "TIE"}:
                continue
            k = key[r["posting_id"]]
            if choice == "TIE":
                ties += 1
                continue
            winner = k["A"] if choice == "A" else ("baseline" if k["A"] == "multi" else "multi")
            wins += winner == "multi"
            losses += winner == "baseline"
            counted += 1
            agree += winner == k["judge_winner"]
    if not (wins + losses + ties):
        raise ValueError("no rows rated: fill the `prefer` column with A, B or tie")
    lo, hi = metrics.wilson_ci(wins, wins + losses)
    return {"multi_wins": wins, "baseline_wins": losses, "ties": ties,
            "multi_share_of_decisive": wins / (wins + losses) if wins + losses else float("nan"),
            "share_lo": lo, "share_hi": hi,
            "agreement_with_judge": agree / counted if counted else float("nan"), "n_decisive": counted}
