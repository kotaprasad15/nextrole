# NextRole evaluation

Three experiments, each runnable on its own. Everything calls the real model configured in
`.env` and spends real tokens (the outreach experiment makes roughly 12 model calls per
posting). Raw results are saved to `results/*.json`, so tables can be regenerated without
re-running anything.

```bash
uv run python -m eval.run_eval tiering                    # 50 hand-labeled companies (cheap)
uv run python -m eval.run_eval tiering --dataset holdout  # 20 more, written after the prompt fix
uv run python -m eval.run_eval outreach                   # baseline vs multi-agent, 30 postings
uv run python -m eval.run_eval p10-sheet --llm-proxy      # build the blinded rating sheet
uv run python -m eval.run_eval p10-score                  # precision@10 from YOUR ratings
uv run python -m eval.run_eval report --update-readme     # render tables into the README
```

Set `LLM_DISABLE_THINKING=true` when using DeepSeek, and set `PRICE_IN_PER_MTOK` /
`PRICE_OUT_PER_MTOK` to your provider's real prices, or the cost column is wrong.

## What is measured, and how it avoids fooling itself

**1. Baseline vs multi-agent outreach** (`outreach_eval.py`). 30 real postings (frozen in
`datasets/postings_30.jsonl`, 6 per sample profile). Both systems write one email from the same
profile and posting with the same writer model. The baseline is one prompt with no research or
critic; the multi-agent system is the production graph (research, fact sheet, writer, critic
loop).

- *Factual errors* come from an **independent fact-checker** (`judge.py`), not the product's
  Critic. It sees only the sources each system actually had and labels every claim `supported`,
  `overreach` (true facts stretched, e.g. "maps directly to") or `unsupported` (not in the
  sources: the real factual error). The two are reported separately.
- *Preference* is a **blind, order-randomised pairwise judge** (seeded, so reproducible).
- The *pipeline Critic score* is reported too, but it is circular (the pipeline rewrites until
  the Critic is satisfied), so it is flagged as favouring the pipeline by construction. The
  first-draft vs final comparison isolates what the rewrite loop adds.
- Cost and latency are cold-start (a fresh DB per run, so no research cache is shared);
  judging cost is excluded from system cost.
- n is small, so every difference is **paired** and has a **bootstrap 95% CI**. An interval
  that spans zero is reported as inconclusive, never as a win.

**2. Tiering accuracy** (`tiering_eval.py`). Two variants: the production path (seed list +
LLM) and LLM-only (seed list disabled), because the seed list inflates accuracy on famous
companies. Each runs 3 times on a fresh DB. Borderline companies (near a size threshold) are
flagged and reported separately. `tiering_holdout_20.csv` was written *after* the prompt was
fixed using the first set, and run once, so it is a fairer estimate than the development set.
**Labels are the author's assistant's, from public headcount knowledge, and are not independently
verified**: please correct them before quoting numbers.

**3. Precision@10** (`p10_eval.py`). The production recommender is compared against a
keyword-only baseline on the same job pool per profile. Relevance must be rated by a human:
the sheet is blinded (shuffled, no system column). Fill `relevant` with 1/0 ("would this
candidate reasonably apply, right field and right seniority?") and run `p10-score`. An
LLM-judge proxy (`--llm-proxy`) can pre-fill ratings, but results from it are always labelled
"LLM-judged (proxy), NOT manual".

## Known limitations (read before quoting results)

- Judges are LLMs from the same provider as the systems, so they are not ground truth and may
  share biases with the writer.
- 30 postings, 5 synthetic profiles and 50 + 20 labeled companies: small samples, wide CIs.
- Posting-profile pairs are selected by keyword match, so some are weak fits. That stresses the
  Writer's temptation to over-connect, but is not representative of a user's real shortlist.
- Research uses free public sources (Wikipedia, Hacker News), which know little about small
  startups; the multi-agent system's research advantage is therefore limited for them.
- The tiering prompt was tuned on the development set; only the held-out set is unseen.
