"""Evaluation harness tests: statistics, dataset sanity, runner wiring and report rendering.

The model and network are faked, so these verify the *machinery* (pairing, blinding,
aggregation, formatting), not the quality numbers, which only a live run can produce.
"""
import json
import math
from collections import Counter
from types import SimpleNamespace

import httpx
import pytest
from eval import metrics, report
from eval.build_dataset import load_profile_ids, load_profiles
from eval.outreach_eval import run_outreach_eval, summarize_outreach
from eval.p10_eval import read_ratings, score_p10, write_sheet
from eval.tiering_eval import load_rows, run_tiering_eval

from nextrole.agents.tiering import tier_from_employee_count
from nextrole.config import Settings
from nextrole.llm.budget import Budget
from nextrole.llm.client import LLMClient

# ---------------- statistics ----------------

def test_mean_percentile_and_bootstrap_are_reproducible():
    xs = [1.0, 2.0, 3.0, 4.0, 5.0]
    assert metrics.mean(xs) == 3.0 and metrics.percentile(xs, 50) == 3.0
    assert metrics.percentile(xs, 90) == pytest.approx(4.6)
    lo, hi = metrics.bootstrap_ci(xs, seed=1)
    assert lo < 3.0 < hi and (lo, hi) == metrics.bootstrap_ci(xs, seed=1)
    assert math.isnan(metrics.bootstrap_ci([1.0])[0])  # can't bootstrap one point


def test_paired_diff_and_verdict_reading():
    d, lo, hi = metrics.paired_diff([5, 6, 7, 8], [1, 2, 3, 4])
    assert d == 4 and lo > 0 and metrics.verdict(lo, hi) == "a better"
    d, lo, hi = metrics.paired_diff([1, 5, 2, 6], [2, 4, 3, 5])
    assert metrics.verdict(lo, hi) == "inconclusive"  # noisy differences straddle zero
    assert metrics.verdict(-3, -1) == "b better" and metrics.verdict(float("nan"), 1) == "n/a"
    with pytest.raises(ValueError):
        metrics.paired_diff([1], [1, 2])


def test_wilson_confusion_prf_and_precision_at_k():
    lo, hi = metrics.wilson_ci(8, 10)
    assert 0.4 < lo < 0.8 < hi < 1.0 and math.isnan(metrics.wilson_ci(0, 0)[0])
    labels, preds = ["a", "a", "b", "b", "c"], ["a", "b", "b", "b", "a"]
    assert metrics.accuracy(labels, preds) == 0.6
    cm = metrics.confusion(labels, preds, ["a", "b", "c"])
    assert cm["a"] == {"a": 1, "b": 1, "c": 0} and cm["c"]["a"] == 1
    prf = metrics.per_class_prf(labels, preds, ["a", "b", "c"])
    assert prf["b"]["precision"] == pytest.approx(2 / 3) and prf["b"]["recall"] == 1.0
    assert prf["c"]["recall"] == 0.0 and metrics.win_tie_loss(["win", "tie", "win", "loss"]) == (2, 1, 1)
    assert metrics.precision_at_k([1, 1, 0, 1], 10) == 0.3  # missing results count as misses


# ---------------- datasets ----------------

def test_tiering_dataset_is_balanced_and_consistent_with_the_systems_own_thresholds():
    rows = load_rows()
    assert len(rows) == 50 and len({r["company"] for r in rows}) == 50
    assert Counter(r["label"] for r in rows) == {"startup": 15, "mid": 17, "mnc": 18}
    s = Settings(_env_file=None)
    for r in rows:
        implied = tier_from_employee_count(r["approx_employees"], s)
        if not r["borderline"]:
            assert implied == r["label"], f"{r['company']}: label {r['label']} vs size implies {implied}"
    assert any(r["borderline"] for r in rows)  # near-threshold cases are flagged, not hidden


def test_sample_profiles_are_valid_and_cover_levels():
    profiles = load_profiles()
    assert len(profiles) == 5 and len(set(load_profile_ids())) == 5
    levels = {p.preferences.experience_level for p in profiles}
    assert {"Intern / New grad", "Junior", "Mid", "Senior"} <= levels
    assert all(p.skills and p.preferences.roles and p.experience for p in profiles)


# ---------------- a fake model for the runners ----------------

class EvalFake:
    def __init__(self, judge_pick="A", fact_unsupported=("invented metric",), tier_labels=None):
        self.judge_pick, self.unsupported = judge_pick, list(fact_unsupported)
        self.tier_labels = tier_labels or {}
        self.messages = SimpleNamespace(create=self._create)
        self.calls = []
        self.fact_prompts = []

    async def _create(self, **kw):
        system, user = kw["system"], kw["messages"][0]["content"]
        self.calls.append(system[:40])
        body = None
        if "concise, personalized cold outreach emails" in system:  # the baseline
            body = {"subject": "Hi", "body": " ".join(["base"] * 80)}
        elif "You research a company" in system:
            return self._resp([SimpleNamespace(type="text", text="DONE")])
        elif "You write a concise" in system:  # the multi-agent writer
            body = {"subject": "Hello", "body": " ".join(["multi"] * 100),
                    "claims": [{"text": "c", "fact_ids": ["F-P1"]}]}
        elif "strict reviewer" in system:
            body = {"specificity": 80, "tone": 80, "grounding": 80, "no_fluff": 80,
                    "unsupported_claims": [], "rewrite_instructions": ""}
        elif "meticulous fact-checker" in system:
            self.fact_prompts.append(user)
            body = {"claims": [{"text": "ok", "verdict": "supported"},
                               {"text": "maps directly", "verdict": "overreach"}]
                    + [{"text": t, "verdict": "unsupported"} for t in self.unsupported]}
        elif "compare two cold outreach" in system:
            body = {"winner": self.judge_pick, "reason": "because"}
        elif "score how well a job fits" in system:  # the production matcher
            body = {"score": 90 if "Backend" in user.split("JOB:")[-1][:80] else 20,
                    "strengths": ["Python"], "gaps": [], "rationale": "fit"}
        elif "Classify each company" in system:
            names = [ln[2:] for ln in user.splitlines() if ln.startswith("- ")]
            body = {"items": [{"company": n, "tier": self.tier_labels.get(n, "mid"), "confidence": 0.9}
                              for n in names]}
        else:
            raise AssertionError(f"unexpected prompt: {system[:60]}")
        return self._resp([SimpleNamespace(type="text", text=json.dumps(body))])

    @staticmethod
    def _resp(content):
        return SimpleNamespace(content=content, stop_reason="end_turn",
                               usage=SimpleNamespace(input_tokens=100, output_tokens=50))


def harness(fake):
    s = Settings(_env_file=None)
    new_llm = lambda: LLMClient(s, Budget(10**7, 100.0, 3.0, 15.0), client=fake, retry_wait=lambda *_: 0)
    http = lambda: httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(404)))
    return s, new_llm, http


POSTINGS = [{"id": f"j{i}", "profile_id": "p1_backend_newgrad", "company": f"Co{i}", "title": "Backend Engineer",
             "location": "Remote", "apply_url": f"https://boards.greenhouse.io/x/jobs/{i}",
             "description": "Build Python APIs and maintain SQL databases. " * 8} for i in range(4)]
PROFILES = dict(zip(load_profile_ids(), load_profiles(), strict=True))


async def run_eval(fake, postings=POSTINGS, **kw):
    s, new_llm, http = harness(fake)
    return s, await run_outreach_eval(postings, PROFILES, s, new_llm=new_llm, http_factory=http,
                                      progress=lambda _m: None, **kw)


async def test_outreach_eval_pairs_systems_judges_blind_and_aggregates():
    many = [{**POSTINGS[0], "id": f"j{i:02d}", "company": f"Co{i}"} for i in range(12)]
    _, data = await run_eval(EvalFake(judge_pick="A"), postings=many)
    assert [r["id"] for r in data["rows"]] == [f"j{i:02d}" for i in range(12)]
    for r in data["rows"]:
        assert not r["error"]
        assert r["baseline"]["claims_unsupported"] == 1 and r["multi"]["claims_unsupported"] == 1
        assert r["baseline"]["claims_overreach"] == 1 and r["multi"]["overreach_texts"] == ["maps directly"]
        # Judge always says "A": the winner must therefore follow the randomised order.
        assert (r["pairwise"]["winner"] == "multi") == r["pairwise"]["multi_was_A"]
        assert r["baseline"]["calls"] == 1 and r["multi"]["calls"] > 1  # cost accounting per system
    order = {r["pairwise"]["multi_was_A"] for r in data["rows"]}
    assert order == {True, False}  # both presentation orders occur (blinding works)

    summary = summarize_outreach(data)
    assert summary["n_ok"] == 12 and summary["factuality"]["claim_error_rate"]["multi"] == pytest.approx(1 / 3)
    assert summary["factuality"]["overreach_claim_rate"]["multi"] == pytest.approx(1 / 3)
    assert summary["cost"]["ratio"] > 1 and summary["pipeline"]["passed_rate"] == 1.0
    md = report.render_outreach(data)
    assert "| Metric | Baseline | Multi-agent |" in md and "Blind pairwise preference" in md
    assert "favours it by construction" in md  # the circularity caveat is always printed


async def test_outreach_eval_is_deterministic_for_a_seed_and_isolates_failures():
    _, a = await run_eval(EvalFake(), seed=7)
    _, b = await run_eval(EvalFake(), seed=7)
    assert [r["pairwise"]["multi_was_A"] for r in a["rows"]] == [r["pairwise"]["multi_was_A"] for r in b["rows"]]

    bad = [{**POSTINGS[0], "id": "bad", "apply_url": "http://insecure.example.com"}, *POSTINGS[:2]]
    _, data = await run_eval(EvalFake(), postings=bad)
    summary = summarize_outreach(data)
    assert summary["n_error"] == 1 and summary["n_ok"] == 2  # one bad posting doesn't sink the rest


async def test_outreach_eval_cost_cap_skips_remaining_postings():
    _, data = await run_eval(EvalFake(), concurrency=1, max_total_cost=0.0001)
    assert sum("cost cap" in (r.get("error") or "") for r in data["rows"]) >= 1


async def test_tiering_eval_scores_variants_and_flags_borderline():
    rows = load_rows()
    labels = {r["company"]: r["label"] for r in rows}
    s, new_llm, _ = harness(EvalFake(tier_labels=labels))
    data = await run_tiering_eval(rows, s, new_llm, repeats=2)
    llm_only, prod = data["variants"]["llm_only"], data["variants"]["production"]
    assert llm_only["accuracy_mean"] == 1.0 and llm_only["disagreements_or_errors"] == []
    assert prod["seed_methods"] > 0 and llm_only["seed_methods"] == 0  # seed list only in production
    assert llm_only["n_excl_borderline"] == 47

    # A model that calls everything "mid" gets exactly the mid share right.
    s, new_llm, _ = harness(EvalFake(tier_labels={}))
    data = await run_tiering_eval(rows, s, new_llm, repeats=1)
    assert data["variants"]["llm_only"]["accuracy_mean"] == pytest.approx(17 / 50)
    assert "Confusion matrix" in report.render_tiering(data)


# ---------------- precision@10 ----------------

KEY = {"p1": {"matcher": [f"m{i}" for i in range(10)], "keyword": [f"k{i}" for i in range(10)]},
       "p2": {"matcher": [f"n{i}" for i in range(10)], "keyword": [f"q{i}" for i in range(10)]}}


def ratings(good_matcher, good_keyword):
    out = {}
    for pid, lists in KEY.items():
        for j, jid in enumerate(lists["matcher"]):
            out[(pid, jid)] = int(j < good_matcher)
        for j, jid in enumerate(lists["keyword"]):
            out[(pid, jid)] = int(j < good_keyword)
    return out


def test_precision_at_10_scoring_and_missing_ratings_are_refused():
    res = score_p10(KEY, ratings(8, 5), "manual")
    assert res["systems"]["matcher"]["macro"] == 0.8 and res["systems"]["keyword"]["macro"] == 0.5
    assert res["diff_matcher_minus_keyword"]["diff"] == pytest.approx(0.3)
    partial = ratings(8, 5)
    partial[("p1", "m3")] = None
    with pytest.raises(ValueError, match="unrated"):
        score_p10(KEY, partial, "manual")
    md = report.render_p10(res)
    assert "rated manually" in md and "80%" in md
    assert "NOT manual" in report.render_p10(score_p10(KEY, ratings(8, 5), "llm-proxy"))


def test_rating_sheet_roundtrip(tmp_path):
    rows = [{"profile_id": "p1", "job_id": "a", "company": "X", "title": "T", "location": "L",
             "apply_url": "https://x.example.com/1", "relevant": ""},
            {"profile_id": "p1", "job_id": "b", "company": "Y", "title": "U", "location": "",
             "apply_url": "", "relevant": "1"},
            {"profile_id": "p1", "job_id": "c", "company": "Z", "title": "V", "location": "",
             "apply_url": "", "relevant": "N"}]
    path = tmp_path / "sheet.csv"
    write_sheet(rows, path)
    assert read_ratings(path) == {("p1", "a"): None, ("p1", "b"): 1, ("p1", "c"): 0}
    assert "system" not in path.read_text(encoding="utf-8").splitlines()[0]  # sheet is blinded


# ---------------- report assembly ----------------

def test_report_marks_missing_experiments_and_updates_readme_idempotently(tmp_path):
    body = report.render(tmp_path)  # empty results directory
    assert body.count("Not run yet") == 5  # outreach, human review, tiering dev + held-out, p10
    readme = tmp_path / "README.md"
    readme.write_text("# T\n\nintro\n", encoding="utf-8")
    report.update_readme(readme, "FIRST")
    report.update_readme(readme, "SECOND")
    text = readme.read_text(encoding="utf-8")
    assert text.count(report.MARK_START) == 1 and "SECOND" in text and "FIRST" not in text
    assert text.startswith("# T\n\nintro")


async def test_judge_sees_exactly_what_each_system_saw():
    """Baseline got the full profile JSON (incl. preferences); the multi-agent fact sheet has
    none, so only the baseline's fact-check may cite them. The whole posting reaches the judge."""
    tail = "UNIQUE-TAIL-OF-A-LONG-POSTING"
    long_posting = {**POSTINGS[0], "description": ("Build Python APIs. " * 190) + tail}  # > 3000 chars
    fake = EvalFake()
    await run_eval(fake, postings=[long_posting])
    baseline_check, multi_check = fake.fact_prompts  # baseline is judged first
    assert "Preferences:" in baseline_check and "Preferences:" not in multi_check
    assert tail in baseline_check and tail in multi_check


async def test_cold_cache_client_gives_every_request_a_unique_prefix():
    from eval.run_eval import ColdCacheClient

    seen = []

    async def create(**kw):
        seen.append(kw["system"])
        return "ok"

    client = ColdCacheClient(SimpleNamespace(messages=SimpleNamespace(create=create)))
    await client.messages.create(system="same prompt", messages=[])
    await client.messages.create(system="same prompt", messages=[])
    assert seen[0] != seen[1] and all(x.endswith("same prompt") for x in seen)


async def test_p10_recommender_runs_the_production_graph_and_builds_a_blinded_sheet():
    """Regression: the recommender needs a real user row (matches FK), and the sheet must not
    reveal which system ranked a row."""
    from eval.p10_eval import build_sheet, run_recommender

    from nextrole.models.job import Job
    from nextrole.sources.registry import DiscoveryResult

    jobs = [Job(source="gh", source_id=str(i), company=f"Co{i}", location="Remote",
                title="Backend Engineer" if i % 2 else "Chef", description="python sql " * 20,
                apply_url=f"https://boards.greenhouse.io/x/jobs/{i}") for i in range(30)]

    async def discover(boards, prefs, **_):
        return DiscoveryResult(jobs=jobs, errors={})

    s, new_llm, http = harness(EvalFake())
    profile = PROFILES["p1_backend_newgrad"]
    matcher, keyword = await run_recommender(profile, s, new_llm, discover, http)
    assert len(matcher) == 10 and len(keyword) == 10
    assert all("Backend" in j.title for j in matcher)  # the LLM scores put backend roles on top

    rows, key = await build_sheet({"p1_backend_newgrad": profile}, s, new_llm, discover, http,
                                  progress=lambda _m: None)
    assert set(key["p1_backend_newgrad"]) == {"matcher", "keyword"}
    assert {r["job_id"] for r in rows} == set(key["p1_backend_newgrad"]["matcher"]) | set(key["p1_backend_newgrad"]["keyword"])
    assert not any(k in rows[0] for k in ("system", "matcher", "keyword", "score"))  # blinded


def test_committed_results_render_every_section_they_have_data_for():
    """Guards against a section silently missing from the README report."""
    md = report.render()
    for fname, marker in (("outreach.json", "### 1. Single-agent baseline"),
                          ("tiering.json", "### 2a. Tiering accuracy, development set"),
                          ("tiering_holdout.json", "### 2b. Tiering accuracy, held-out set")):
        if (report.RESULTS / fname).exists():
            assert marker in md, f"{marker!r} missing although {fname} exists"
    if (report.RESULTS / "tiering_v1_prompt.json").exists():
        assert "History: the first version of the tiering prompt" in md
