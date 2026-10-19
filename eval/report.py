"""Render the evaluation results as markdown tables for the README.

Design decision: this module only formats numbers computed from the raw saved results
(`results/*.json`); it never makes a claim of its own. "Reading" columns come from interval
arithmetic (does the 95% CI exclude zero?), so an inconclusive difference is printed as
inconclusive rather than dressed up as a win.
"""
import json
import math
from pathlib import Path

from eval.outreach_eval import summarize_outreach

RESULTS = Path(__file__).parent / "results"
MARK_START, MARK_END = "<!-- EVAL:START -->", "<!-- EVAL:END -->"


def _f(x: float, nd: int = 1) -> str:
    return "n/a" if x is None or (isinstance(x, float) and math.isnan(x)) else f"{x:.{nd}f}"


def _ci(d: dict, nd: int = 1) -> str:
    return f"{_f(d['mean'], nd)} [{_f(d['lo'], nd)}, {_f(d['hi'], nd)}]"


def _diff(d: dict, nd: int = 1) -> str:
    return f"{d['diff']:+.{nd}f} [{d['lo']:+.{nd}f}, {d['hi']:+.{nd}f}]"


def _reading(d: dict, higher_is_better: bool) -> str:
    """Interpret a (multi - baseline) interval in terms of which system is better."""
    lo, hi = d["lo"], d["hi"]
    if math.isnan(lo):
        return "n/a"
    if lo > 0:
        return "multi-agent better" if higher_is_better else "multi-agent worse"
    if hi < 0:
        return "multi-agent worse" if higher_is_better else "multi-agent better"
    return "inconclusive"


def _money(x: float) -> str:
    return f"${x:.4f}"


def render_outreach(data: dict) -> str:
    s = summarize_outreach(data)
    if not s["n_ok"]:
        return "_Outreach experiment: no successful runs._\n"
    c, fa, pr, co, la, pl = (s["critic"], s["factuality"], s["preference"], s["cost"],
                             s["latency_s"], s["pipeline"])
    cfg = data["settings"]
    rate = fa["claim_error_rate"]
    lines = [
        f"### 1. Single-agent baseline vs multi-agent pipeline (n = {s['n_ok']} paired postings"
        + (f", {s['n_error']} failed" if s["n_error"] else "") + ")",
        "",
        "Same profile, posting and writer model for both systems. Differences are paired; "
        "brackets are 95% bootstrap confidence intervals.",
        "",
        "| Metric | Baseline | Multi-agent | Difference (multi - baseline) | Reading |",
        "|---|---|---|---|---|",
        f"| Pipeline Critic score (0-100)* | {_ci(c['baseline'])} | {_ci(c['multi_final'])} "
        f"| {_diff(c['multi_vs_baseline'])} "
        f"| {_reading(c['multi_vs_baseline'], True)} |",
        f"| Critic score: first draft to final (rewrite loop effect) | n/a | "
        f"{_f(c['multi_first']['mean'])} to {_f(c['multi_final']['mean'])} | {_diff(c['loop_effect'])} "
        f"| {_reading(c['loop_effect'], True)} |",
        f"| Invented / unsupported claims per draft (independent fact-check) | {_ci(fa['unsupported_per_draft']['baseline'], 2)} "
        f"| {_ci(fa['unsupported_per_draft']['multi'], 2)} "
        f"| {_diff(fa['unsupported_diff_multi_minus_baseline'], 2)} "
        f"| {_reading(fa['unsupported_diff_multi_minus_baseline'], False)} |",
        f"| Overreaching claims per draft (true facts stretched) | {_ci(fa['overreach_per_draft']['baseline'], 2)} "
        f"| {_ci(fa['overreach_per_draft']['multi'], 2)} "
        f"| {_diff(fa['overreach_diff_multi_minus_baseline'], 2)} "
        f"| {_reading(fa['overreach_diff_multi_minus_baseline'], False)} |",
        f"| Factual-error rate (unsupported / all claims) | {rate['baseline']:.1%} | {rate['multi']:.1%} | "
        f"{(rate['multi'] - rate['baseline']) * 100:+.1f} pts | point estimate |",
        f"| Overreach rate (overreaching / all claims) | {fa['overreach_claim_rate']['baseline']:.1%} "
        f"| {fa['overreach_claim_rate']['multi']:.1%} | "
        f"{(fa['overreach_claim_rate']['multi'] - fa['overreach_claim_rate']['baseline']) * 100:+.1f} pts | point estimate |",
        f"| Drafts with at least one unsupported claim | {fa['drafts_with_any_unsupported']['baseline']:.0%} "
        f"| {fa['drafts_with_any_unsupported']['multi']:.0%} | | |",
        f"| Checkable claims per draft | {_f(fa['claims_per_draft']['baseline'])} "
        f"| {_f(fa['claims_per_draft']['multi'])} | | |",
        f"| Blind pairwise preference (judge) | {pr['baseline_wins']} wins | {pr['multi_wins']} wins "
        f"({pr['ties']} ties) | multi share of decisive: {_f(pr['multi_share_of_decisive'] * 100, 0)}% "
        f"[{_f(pr['share_lo'] * 100, 0)}, {_f(pr['share_hi'] * 100, 0)}] "
        f"| {_pref_reading(pr)} |",
        f"| Cost per draft | {_money(co['baseline_usd']['mean'])} | {_money(co['multi_usd']['mean'])} "
        f"| x{co['ratio']:.1f} | |",
        f"| Tokens / model calls per draft | {co['baseline_tokens']:.0f} / {co['baseline_calls']:.1f} "
        f"| {co['multi_tokens']:.0f} / {co['multi_calls']:.1f} | | |",
        f"| Latency p50 / p90 (s) | {_f(la['baseline_p50'])} / {_f(la['baseline_p90'])} "
        f"| {_f(la['multi_p50'])} / {_f(la['multi_p90'])} | | |",
        "",
        f"Pipeline detail: critic pass rate {pl['passed_rate']:.0%}; mean {pl['attempts_mean']:.2f} "
        f"drafts per run ({pl['needed_rewrite']} of {s['n_ok']} needed a rewrite); research found "
        f"sourced facts for {pl['runs_with_research_facts']} of {s['n_ok']} runs; mean length "
        f"{pl['mean_words']['baseline']:.0f} (baseline) vs {pl['mean_words']['multi']:.0f} (multi-agent) words. "
        f"Drafts with a rule violation (URL, placeholder): baseline {fa['rule_violation_drafts']['baseline']}, "
        f"multi-agent {fa['rule_violation_drafts']['multi']}.",
        "",
        f"\\* The pipeline's own Critic is part of the multi-agent system (it rewrites until the Critic is "
        f"satisfied), so this row favours it by construction. The independent fact-check and blind "
        f"preference rows are the fairer comparison. Models: fast `{cfg['model_fast']}`, strong "
        f"`{cfg['model_strong']}`; cost uses ${cfg['price_in_per_mtok']}/${cfg['price_out_per_mtok']} per "
        f"million input/output tokens (set `PRICE_*` to your provider before quoting costs).",
        "",
    ]
    return "\n".join(lines)


def _pref_reading(pr: dict) -> str:
    lo, hi = pr["share_lo"], pr["share_hi"]
    if math.isnan(lo):
        return "n/a"
    return "multi-agent better" if lo > 0.5 else "multi-agent worse" if hi < 0.5 else "inconclusive"


def render_tiering(data: dict, kind: str = "development") -> str:
    lines = [f"### 2{'b' if kind == 'held-out' else 'a'}. Tiering accuracy, {kind} set ({data['n']} hand-labeled companies, {data['repeats']} runs each)", "",
             "| Variant | Accuracy (mean, min-max) | Accuracy excl. borderline | Recall: startup / mid / MNC |",
             "|---|---|---|---|"]
    names = {"production": "Production path (seed list + LLM fallback)",
             "llm_only": "LLM only (seed list disabled)"}
    for key, v in data["variants"].items():
        pc = v["per_class"]
        lines.append(
            f"| {names[key]} | {v['accuracy_mean']:.0%} ({v['accuracy_min']:.0%}-{v['accuracy_max']:.0%}) "
            f"| {v['accuracy_excl_borderline_mean']:.0%} (n={v['n_excl_borderline']}) "
            f"| {_f(pc['startup']['recall'] * 100, 0)}% / {_f(pc['mid']['recall'] * 100, 0)}% / "
            f"{_f(pc['mnc']['recall'] * 100, 0)}% |")
    lines += ["", "Confusion matrix, LLM only (rows = label, columns = prediction, summed over runs):", "",
              "| label \\ predicted | startup | mid | mnc |", "|---|---|---|---|"]
    cm = data["variants"]["llm_only"]["confusion_summed_over_runs"]
    for t in ("startup", "mid", "mnc"):
        lines.append(f"| {t} | {cm[t]['startup']} | {cm[t]['mid']} | {cm[t]['mnc']} |")
    errs = data["variants"]["llm_only"]["disagreements_or_errors"]
    if errs:
        lines += ["", "Companies the LLM-only variant got wrong or answered inconsistently "
                  "(label, approx. employees, votes across runs): "
                  + "; ".join(f"{e['company']} ({e['label']}, ~{e['approx_employees']:,}"
                              f"{', borderline' if e['borderline'] else ''}: {e['votes']})"
                              for e in errs[:12]) + "."]
    lines += ["", "> Labels were drafted by the project author's assistant from public headcount "
              "knowledge and have not been independently verified; correct "
              "the files in `eval/datasets/` before quoting these numbers.", ""]
    return "\n".join(lines)


def render_p10(data: dict) -> str:
    src = {"manual": "rated manually", "llm-proxy": "rated by an LLM judge (proxy, NOT manual)"}[data["source"]]
    sysd = data["systems"]
    lines = [f"### 3. Recommendation relevance: precision@{data['k']} ({data['profiles']} sample profiles, {src})", "",
             "| Profile | LLM matcher (production) | Keyword baseline |", "|---|---|---|"]
    for pid in sysd["matcher"]["per_profile"]:
        lines.append(f"| {pid} | {sysd['matcher']['per_profile'][pid]:.0%} | {sysd['keyword']['per_profile'][pid]:.0%} |")
    d = data["diff_matcher_minus_keyword"]
    lines += [f"| **Macro average** [95% CI] | **{sysd['matcher']['macro']:.0%}** "
              f"[{sysd['matcher']['lo']:.0%}, {sysd['matcher']['hi']:.0%}] | **{sysd['keyword']['macro']:.0%}** "
              f"[{sysd['keyword']['lo']:.0%}, {sysd['keyword']['hi']:.0%}] |",
              "", f"Difference (matcher - keyword): {d['diff'] * 100:+.0f} pts "
              f"[{d['lo'] * 100:+.0f}, {d['hi'] * 100:+.0f}], {d['reading'].replace('a better', 'matcher better').replace('b better', 'keyword better')}. "
              "With only 5 profiles the interval is wide.", ""]
    return "\n".join(lines)


def render_runs(results: Path) -> str:
    """Headline metrics for every saved outreach run, so run-to-run noise is visible."""
    notes_path = results / "run_notes.json"
    if not notes_path.exists():
        return ""
    notes = json.loads(notes_path.read_text(encoding="utf-8"))
    rows = []
    for name, note in notes.items():
        path = results / name
        if not path.exists():
            continue
        s = summarize_outreach(json.loads(path.read_text(encoding="utf-8")))
        if not s.get("n_ok"):
            continue
        c, fa, pr, co = s["critic"], s["factuality"], s["preference"], s["cost"]
        rows.append(
            f"| {note.split(':')[0]} | {_diff(c['multi_vs_baseline'])} "
            f"| {_diff(fa['unsupported_diff_multi_minus_baseline'], 2)} "
            f"| {_diff(fa['overreach_diff_multi_minus_baseline'], 2)} "
            f"| {pr['multi_wins']}-{pr['baseline_wins']} ({_f(pr['multi_share_of_decisive'] * 100, 0)}%) "
            f"| x{co['multi_tokens'] / max(co['baseline_tokens'], 1):.1f} |")
    if len(rows) < 2:
        return ""
    lines = ["#### Run-to-run variation", "",
             "The experiment was run three times while the harness was being corrected. All runs are kept "
             "in `eval/results/`; only the last uses the corrected method end to end. Quality differences that "
             "keep their sign and interval across runs are trustworthy; ones that swing are noise.", "",
             "| Run | Critic score diff | Unsupported claims/draft diff | Overreach/draft diff | Judge preference (multi-baseline) | Token ratio |",
             "|---|---|---|---|---|---|", *rows, ""]
    lines += [f"- **{n.split(':')[0]}**: {n.split(':', 1)[1].strip()}" for n in notes.values()]
    return "\n".join(lines) + "\n"


def render_human(data: dict) -> str:
    return (f"#### Human check of the blind judge\n\nA person compared "
            f"{data['n_decisive'] + data['ties']} blinded pairs: "
            f"the multi-agent draft won {data['multi_wins']}, the baseline {data['baseline_wins']}, "
            f"{data['ties']} ties (multi-agent share of decisive picks "
            f"{_f(data['multi_share_of_decisive'] * 100, 0)}% [{_f(data['share_lo'] * 100, 0)}, "
            f"{_f(data['share_hi'] * 100, 0)}]). They agreed with the LLM judge on "
            f"{data['agreement_with_judge']:.0%} of decisive pairs.\n")


def render(results: Path = RESULTS) -> str:
    parts = ["## Results tables (generated)", ""]
    for name, fn, hint in (
        ("outreach.json", lambda d: render_outreach(d) + render_runs(results),
         "`python -m eval.run_eval outreach`"),
        ("human_review.json", render_human,
         "`python -m eval.run_eval review-sheet`, fill it in, then `review-score`"),
        ("tiering.json", lambda d: render_tiering(d, "development") + _tiering_history(results),
         "`python -m eval.run_eval tiering`"),
        ("tiering_holdout.json", lambda d: render_tiering(d, "held-out"),
         "`python -m eval.run_eval tiering --dataset holdout`"),
        ("p10.json", render_p10, "`python -m eval.run_eval p10-sheet`, rate the sheet, then `p10-score`"),
    ):
        path = results / name
        parts.append(fn(json.loads(path.read_text(encoding="utf-8"))) if path.exists()
                     else f"_Not run yet: {hint}._\n")
    return "\n".join(parts)


def _tiering_history(results: Path) -> str:
    """How the first measurement led to a prompt fix (kept so the change is auditable)."""
    path = results / "tiering_v1_prompt.json"
    if not path.exists():
        return ""
    v1 = json.loads(path.read_text(encoding="utf-8"))["variants"]["llm_only"]
    mid = v1["confusion_summed_over_runs"]["mid"]
    return (f"\nHistory: the first version of the tiering prompt scored {v1['accuracy_mean']:.0%} "
            f"(LLM only). The eval showed it labelled mid-size companies as MNC "
            f"({mid['mnc']} of {sum(mid.values())} mid-size judgments) because the prompt defined MNC as "
            "'over ~5000 employees or a multinational'. The prompt now asks for a headcount estimate and "
            "code applies the thresholds. That revision was made after seeing these results, so the "
            "development-set number is optimistic; the held-out set below was written afterwards, "
            "before any predictions on it were seen, and run once.\n")


def update_readme(readme: Path, body: str) -> None:
    text = readme.read_text(encoding="utf-8")
    block = f"{MARK_START}\n{body}\n{MARK_END}"
    if MARK_START in text and MARK_END in text:
        head, rest = text.split(MARK_START, 1)
        text = head + block + rest.split(MARK_END, 1)[1]
    else:
        text = text.rstrip() + "\n\n" + block + "\n"
    readme.write_text(text, encoding="utf-8")
