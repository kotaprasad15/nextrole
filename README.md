# NextRole

Agentic job search and outreach: parse a resume, find real openings from legitimate sources (Greenhouse, Lever, Ashby, Adzuna), tier companies (Startup / Mid-size / MNC), explain fit, link to the real application page, and draft a grounded, human-approved outreach message. Built with prompting, tool use and LangGraph orchestration only.

> Status: milestone g (evaluation suite and results). All seven milestones are built; see Evaluation for what is and isn't established. See the roadmap below.

## Setup
```bash
uv sync
cp .env.example .env   # add ANTHROPIC_API_KEY
uv run pytest -q
uv run python -m nextrole.baseline_demo
```

## Roadmap
a. Foundations + baseline (done) · b. Job connectors (done) · c. Auth + resume parsing (done) · d. Tiering, ranking, dashboard (done) · e. Researcher/Writer/Critic (done) · f. Orchestrator, budgets, memory (done) · g. Evaluation (done; three human steps remain, listed under Evaluation)

## Agent flow
Every run is a LangGraph graph: each worker step returns to the **Orchestrator**, the one place that routes, enforces the budget, the step cap and the rewrite cap, and applies each step's failure policy. Steps stream to the UI over SSE.

```mermaid
flowchart TD
    O{{"Orchestrator<br/>route - budget - step cap - failure policy"}}
    subgraph recommend
      D[Discover<br/>Greenhouse / Lever / Ashby in parallel] --> T1[Tier<br/>cache - MNC seed - LLM]
      T1 --> S[Select per tier] --> M1[Match<br/>score 0-100]
    end
    subgraph outreach
      R[Research<br/>Wikipedia - HN - guarded fetch] --> F[Fact sheet]
      F --> W[Writer<br/>cites fact ids] --> C[Critic<br/>rules + rubric + claim check]
      C -- "revise, max 3 rewrites" --> W
    end
    P[Paste a job<br/>URL or text -> Ingest] -.-> T1
    O --> D
    M1 --> O
    O --> R
    C -- pass or cap --> H([You review, edit, approve<br/>mailto / Gmail draft - never auto-sent])
    MEM[(Memory<br/>feedback + approved drafts<br/>style only)] -.-> W
```

## Evaluation

Three experiments, run against a real model (DeepSeek `deepseek-flash` for intake/tiering/matching/research, `deepseek-v4-pro` for writing, reviewing and judging). Method, datasets and limitations: [`eval/README.md`](eval/README.md). Raw results: `eval/results/`. Regenerate everything below with `uv run python -m eval.run_eval report --update-readme`.

### What the evaluation shows

Written from the numbers below, including where the multi-agent design does **not** win.

**Where the multi-agent pipeline wins (stable across all three runs)**
- **Less overreach.** It states fewer claims that stretch true facts ("maps directly to…", "strong experience in…"): about 8% of its claims versus 14% for the single prompt (−0.6 to −1.1 per draft; the confidence interval excludes zero in every run).
- **Never ships an unsendable draft.** 0 of 30 pipeline drafts contained a placeholder or link in any run; the single-prompt baseline left a literal `[Your Name]` in 1 to 12 of 30 (varies by run). That is partly a naive-prompt weakness a better baseline prompt would fix, but the pipeline removes it structurally with deterministic checks.

**Where it does not clearly win**
- **Invented claims.** Both systems occasionally state something absent from the sources (pipeline: 6 of 30 drafts; baseline: 10 of 30). The difference is inconclusive in every run (the interval spans zero), so these results do not show that the pipeline eliminates fabrication. Its most common failure is asserting where the candidate is based or what they prefer, copied from the *job's* location ("I'm based around the Seattle area"): 4 of the 6 flagged drafts, and **all 6 had passed the pipeline's own Critic**. That is a concrete, fixable gap (a Writer rule and a Critic check), left as is so the numbers stay reproducible.
- **The rewrite loop.** First draft to final Critic score moved +0.2 [−2.1, +2.5] (inconclusive; +1.6 and +2.2 in earlier runs). About half the runs triggered a rewrite, and 3 of 30 never passed review. The gain over the baseline is present in the *first* draft, so it comes from the fact sheet, research and rules, not from iteration; this evaluation cannot show the loop itself earns its cost.
- **Blind preference.** An LLM judge preferred the pipeline's draft in all three runs (19-11, 17-13, 25-5), but the margin swings (57% to 83% of decisive pairs), the judge shares a model family with the pipeline's Critic, and pipeline drafts are about 14% longer. Treat it as "probably preferred, size uncertain" until the human-review sheet (`eval/results/human_review_sheet.csv`) is filled in.

**Cost.** About 9× the tokens (≈11,300 vs ≈1,200) and about 7× the latency (p50 16 s vs 2.3 s; p90 29 s) per draft. Dollar figures use a flat illustrative price; set `PRICE_*` for your provider. Fine for one interactive "Draft outreach" click, not for bulk generation.

**Tiering.** The first measurement found a real bug: the LLM labelled 33 of 51 mid-size judgments as MNC because the prompt said "or a multinational". The prompt now asks for a headcount estimate and code applies the thresholds: 78% to 99% on the development set, 20/20 on a held-out set. The held-out set has no borderline companies, so behaviour near a size threshold remains uncertain (Datadog, ~6,500 staff, gave mixed answers), and the MNC seed list adds nothing measurable once the prompt is fixed.

**Recommendations.** By an LLM judge (a proxy, not manual), the LLM matcher reaches 64% precision@10 versus 46% for keyword matching alone (+18 pts [+6, +32]). With 5 profiles the interval is wide, the frontend profile scored low for both systems (probably because the curated job boards hold few frontend roles, which I have not checked), and manual ratings are still needed.

**What still needs a human (nothing here is hidden):** (1) verify the tiering labels, which were drafted from public headcount knowledge; (2) rate `eval/results/p10_sheet.csv` for the manual precision@10; (3) fill in `eval/results/human_review_sheet.csv` (10 pairs) to check the LLM judge. Then run `p10-score`, `review-score` and `report --update-readme`.

**How the harness was debugged (kept for the record).** Running the experiment three times exposed bugs in the evaluation itself: a judge that omitted the baseline's preference fields and truncated postings, a cost comparison skewed by provider prompt caching (which also showed that `LLMClient` was undercounting cached input tokens, now fixed), a P@10 builder that crashed on a missing user row, and a report section that silently failed to render. Each is fixed and covered by a test; the earlier runs are kept in `eval/results/` and listed in the run-to-run table.

<!-- EVAL:START -->
## Results tables (generated)

### 1. Single-agent baseline vs multi-agent pipeline (n = 30 paired postings)

Same profile, posting and writer model for both systems. Differences are paired; brackets are 95% bootstrap confidence intervals.

| Metric | Baseline | Multi-agent | Difference (multi - baseline) | Reading |
|---|---|---|---|---|
| Pipeline Critic score (0-100)* | 79.6 [76.1, 82.8] | 86.9 [85.0, 88.5] | +7.2 [+4.0, +10.8] | multi-agent better |
| Critic score: first draft to final (rewrite loop effect) | n/a | 86.6 to 86.9 | +0.2 [-2.1, +2.5] | inconclusive |
| Invented / unsupported claims per draft (independent fact-check) | 0.43 [0.20, 0.67] | 0.23 [0.07, 0.43] | -0.20 [-0.50, +0.10] | inconclusive |
| Overreaching claims per draft (true facts stretched) | 1.30 [0.83, 1.80] | 0.67 [0.47, 0.87] | -0.63 [-1.20, -0.10] | multi-agent better |
| Factual-error rate (unsupported / all claims) | 4.6% | 2.7% | -1.9 pts | point estimate |
| Overreach rate (overreaching / all claims) | 13.9% | 7.8% | -6.1 pts | point estimate |
| Drafts with at least one unsupported claim | 33% | 20% | | |
| Checkable claims per draft | 9.4 | 8.6 | | |
| Blind pairwise preference (judge) | 5 wins | 25 wins (0 ties) | multi share of decisive: 83% [66, 93] | multi-agent better |
| Cost per draft | $0.0058 | $0.0549 | x9.5 | |
| Tokens / model calls per draft | 1226 / 1.0 | 11345 / 8.0 | | |
| Latency p50 / p90 (s) | 2.3 / 2.7 | 16.1 / 29.3 | | |

Pipeline detail: critic pass rate 90%; mean 2.07 drafts per run (16 of 30 needed a rewrite); research found sourced facts for 30 of 30 runs; mean length 111 (baseline) vs 127 (multi-agent) words. Drafts with a rule violation (URL, placeholder): baseline 1, multi-agent 0.

\* The pipeline's own Critic is part of the multi-agent system (it rewrites until the Critic is satisfied), so this row favours it by construction. The independent fact-check and blind preference rows are the fairer comparison. Models: fast `deepseek-flash`, strong `deepseek-v4-pro`; cost uses $3.0/$15.0 per million input/output tokens (set `PRICE_*` to your provider before quoting costs).
#### Run-to-run variation

The experiment was run three times while the harness was being corrected. All runs are kept in `eval/results/`; only the last uses the corrected method end to end. Quality differences that keep their sign and interval across runs are trustworthy; ones that swing are noise.

| Run | Critic score diff | Unsupported claims/draft diff | Overreach/draft diff | Judge preference (multi-baseline) | Token ratio |
|---|---|---|---|---|---|
| Run 1 (superseded) | +10.7 [+7.2, +14.5] | +0.00 [-0.17, +0.17] | -1.10 [-1.73, -0.53] | 19-11 (63%) | x6.2 |
| Run 2 | +12.6 [+8.3, +17.2] | -0.17 [-0.43, +0.07] | -0.67 [-1.07, -0.30] | 17-13 (57%) | x23.2 |
| Run 3 (reported in the main table) | +7.2 [+4.0, +10.8] | -0.20 [-0.50, +0.10] | -0.63 [-1.20, -0.10] | 25-5 (83%) | x9.3 |

- **Run 1 (superseded)**: the fact-check judge was not shown the baseline's preference fields and saw postings truncated to 3,000 characters, which mislabels some valid claims.
- **Run 2**: judge sources fixed. Quality metrics are valid, but cost and latency are confounded: the baseline's identical prompts were served from the provider's prompt cache, and only uncached input tokens were counted.
- **Run 3 (reported in the main table)**: judge fixed, every input token counted including cached ones, and a per-call nonce defeats provider prompt caching for both systems.

_Not run yet: `python -m eval.run_eval review-sheet`, fill it in, then `review-score`._

### 2a. Tiering accuracy, development set (50 hand-labeled companies, 3 runs each)

| Variant | Accuracy (mean, min-max) | Accuracy excl. borderline | Recall: startup / mid / MNC |
|---|---|---|---|
| Production path (seed list + LLM fallback) | 98% (98%-98%) | 100% (n=47) | 100% / 100% / 94% |
| LLM only (seed list disabled) | 99% (98%-100%) | 100% (n=47) | 100% / 100% / 96% |

Confusion matrix, LLM only (rows = label, columns = prediction, summed over runs):

| label \ predicted | startup | mid | mnc |
|---|---|---|---|
| startup | 45 | 0 | 0 |
| mid | 0 | 51 | 0 |
| mnc | 0 | 2 | 52 |

Companies the LLM-only variant got wrong or answered inconsistently (label, approx. employees, votes across runs): Datadog (mnc, ~6,500, borderline: {'mnc': 1, 'mid': 2}).

> Labels were drafted by the project author's assistant from public headcount knowledge and have not been independently verified; correct the files in `eval/datasets/` before quoting these numbers.

History: the first version of the tiering prompt scored 78% (LLM only). The eval showed it labelled mid-size companies as MNC (33 of 51 mid-size judgments) because the prompt defined MNC as 'over ~5000 employees or a multinational'. The prompt now asks for a headcount estimate and code applies the thresholds. That revision was made after seeing these results, so the development-set number is optimistic; the held-out set below was written afterwards, before any predictions on it were seen, and run once.

### 2b. Tiering accuracy, held-out set (20 hand-labeled companies, 3 runs each)

| Variant | Accuracy (mean, min-max) | Accuracy excl. borderline | Recall: startup / mid / MNC |
|---|---|---|---|
| Production path (seed list + LLM fallback) | 100% (100%-100%) | 100% (n=20) | 100% / 100% / 100% |
| LLM only (seed list disabled) | 100% (100%-100%) | 100% (n=20) | 100% / 100% / 100% |

Confusion matrix, LLM only (rows = label, columns = prediction, summed over runs):

| label \ predicted | startup | mid | mnc |
|---|---|---|---|
| startup | 18 | 0 | 0 |
| mid | 0 | 21 | 0 |
| mnc | 0 | 0 | 21 |

> Labels were drafted by the project author's assistant from public headcount knowledge and have not been independently verified; correct the files in `eval/datasets/` before quoting these numbers.

### 3. Recommendation relevance: precision@10 (5 sample profiles, rated by an LLM judge (proxy, NOT manual))

| Profile | LLM matcher (production) | Keyword baseline |
|---|---|---|
| p1_backend_newgrad | 80% | 70% |
| p2_ml_intern | 60% | 60% |
| p3_frontend_junior | 30% | 0% |
| p4_platform_mid | 50% | 40% |
| p5_fullstack_senior | 100% | 60% |
| **Macro average** [95% CI] | **64%** [44%, 84%] | **46%** [22%, 64%] |

Difference (matcher - keyword): +18 pts [+6, +32], matcher better. With only 5 profiles the interval is wide.

<!-- EVAL:END -->

