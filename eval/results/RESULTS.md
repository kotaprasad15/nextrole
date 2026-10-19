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
