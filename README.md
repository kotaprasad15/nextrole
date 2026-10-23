# NextRole

Agentic job search and outreach: parse a resume, find real openings from legitimate sources (Greenhouse, Lever, Ashby, Adzuna), tier companies (Startup / Mid-size / MNC), explain fit, link to the real application page, and draft a grounded, human-approved outreach message. Built with prompting, tool use and LangGraph orchestration only.

> Status: the agent pipeline and its evaluation (milestones a to g), the Next.js frontend, and a second round of work: security hardening, server-side saved jobs, role synonyms, company alerts, interview experiences with moderation, and an admin usage dashboard. See [What the app does](#what-the-app-does), [Security](#security) and the roadmap below.

## What the app does
- **Find and rank real jobs** from public ATS boards, tiered by company size, explained and linked to the source apply page. Wanted roles go through a **synonym layer** (SDE = Software Engineer = Software Development Engineer, FDE = Forward Deployed Engineer ...), so titles do not have to match exactly.
- **Outreach drafts** written only from a closed set of facts, reviewed by a Critic, and never sent for you: a human approves.
- **Saved jobs** (account-level): a snapshot of the posting taken when you save it (so it survives expiry), a status (Saved, Applied, Interview, Offer, Rejected), notes, filters, and a "no longer listed" flag when the employer removes the posting.
- **Companies to watch and alerts**: pick companies; when one posts a role that fits what you want, even under a different title, you get an in-app alert and, if you opt in, an email to yourself. Matching = role synonyms, then embedding similarity, then an LLM check for the borderline cases, with a "why this matched" line, a confidence threshold, de-duplication, a daily cap and one-click unsubscribe.
- **Interview experiences**: members share structured accounts (rounds, kinds of questions, difficulty, outcome, tips, optional anonymity); others browse, search, filter and upvote. Every post is checked automatically (rules plus an LLM) and **approved by an admin before it is visible**; there are report buttons and rate limits, and a clear "do not share confidential information" notice.
- **Admin dashboard**: total tokens, cost (by model and stage), request counts, error rates and trends, plus a moderation queue. Totals only: nothing is broken down by person.
- Light and dark themes, an ATS keyword checker that runs entirely in your browser, and a data export / delete-my-account flow.

## Setup
```bash
uv sync
cp .env.example .env   # add ANTHROPIC_API_KEY
uv run python -m nextrole.security genkey   # prints ENCRYPTION_KEYS=...; paste it into .env (required for personal data)
uv run pytest -q
uv run python -m nextrole.baseline_demo
```

## Run the app
Two processes: the FastAPI backend and the Next.js frontend (the old UI that FastAPI used to serve has been removed).

```bash
# 1) backend (needs .env with an LLM key and RESUME_ENCRYPTION_KEY)
uv run uvicorn nextrole.api.main:app --reload          # http://127.0.0.1:8000 (API docs at /docs)

# 2) frontend
cd frontend
cp .env.example .env.local                             # real API by default; BACKEND_URL=http://127.0.0.1:8000
npm install
npm run dev -- -p 3100                                 # open http://127.0.0.1:3100
```

The browser only talks to the Next app, which proxies `/api/*` to the backend, so the session cookie is same-origin and the backend needs no CORS setup. For a production UI use `npm run build && npm start`. To explore the UI with sample data and no backend or model calls, set `NEXT_PUBLIC_API_MODE=mock` in `frontend/.env.local`. Frontend details: [`frontend/README.md`](frontend/README.md).

## Security
Full threat model, controls, operating notes and honest limits: [`docs/SECURITY.md`](docs/SECURITY.md). In short:
- **Prompt injection**: resumes, postings, fetched pages and interview posts are untrusted DATA. They reach a model only inside delimited blocks with a random per-call id, under a system rule that block contents are never instructions; the agents that read them have no tools; outputs are schema-validated; links come only from source records (model output is link-stripped, and links a model adds to a restated resume are removed); drafts pass the Critic plus an independent output guard (secrets, prompt leaks, invented contacts).
- **Files**: magic-byte type check, size and page limits, scripts / macros / embedded objects / zip bombs rejected, hidden text (white, tiny, off-page) removed and, if it addresses an AI, the file rejected; a sanitized copy is what is stored; parsing runs in a child process with a timeout.
- **SSRF**: public addresses only (IPv6 tricks included), redirects re-checked, size and time capped, the connection pinned to the validated address.
- **Data**: AES-256-GCM field encryption with a key ring and a rotation command, TLS in transit (at your proxy), PII-scrubbed traces, data export, full account deletion.
- **Web**: Argon2id, password rules enforced on the server, login throttling and lockout, HttpOnly SameSite cookies, CSRF token plus Origin check, CSP and other security headers, rate limits, role-based access enforced on the server, dependency and secret scanning (`bash scripts/audit.sh`).

### Adversarial test results
Run `uv run pytest -q tests/security` (and `uv run python scripts/security_report.py --readme` to refresh this table).

<!-- security-report:start -->
| Area | Tests | Passed | Failed | Pass rate |
|---|---:|---:|---:|---:|
| Prompt injection through resumes, postings, tool results and interview posts (hijacked models) | 129 | 129 | 0 | 100.0% |
| Prompt-injection defences: data blocks, scanner, output guard, link stripping | 71 | 71 | 0 | 100.0% |
| Malicious PDF / DOCX uploads (scripts, hidden text, bombs, spoofed types, isolation) | 32 | 32 | 0 | 100.0% |
| SSRF (private ranges, IPv6 tricks, redirects, DNS rebinding, size caps) | 37 | 37 | 0 | 100.0% |
| Access control on every route, CSRF, admin role, information leaks, cookie flags | 12 | 12 | 0 | 100.0% |
| Encryption at rest, data export, account deletion, trace redaction | 5 | 5 | 0 | 100.0% |
| Secrets committed to the repository | 2 | 2 | 0 | 100.0% |
| Login lockout, rate limits, CSRF, security headers, admin role | 15 | 15 | 0 | 100.0% |
| Field encryption (AES-256-GCM), key rotation, migrations | 11 | 11 | 0 | 100.0% |
| Interview posts: XSS sanitising, personal data, moderation, reports | 59 | 59 | 0 | 100.0% |
| Admin dashboard: totals only (no per-user data), traces, budgets | 13 | 13 | 0 | 100.0% |
| Alerts: dedup, caps, email opt-in, unsubscribe tokens | 22 | 22 | 0 | 100.0% |
| **All** | **408** | **408** | **0** | **100.0%** |

The injection corpus has 28 payloads (direct overrides, role changes, chat-template tokens, delimiter forgery, prompt extraction, link and score manipulation, tool requests), each delivered through up to four channels, plus 10 harmless look-alikes that must NOT be flagged.

How to read this: the models in these tests are mocked, and for the injection tests they are *hijacked* on purpose (they obey whatever the injected text says). A pass means the system around the model contained the damage: untrusted text stays inside data blocks, outputs are schema-validated and link-stripped, rules and an output guard run independently of the model, and a human approves anything public. It does **not** measure how often a real model is fooled; that needs live calls. Regenerate with `uv run python scripts/security_report.py --readme`.
<!-- security-report:end -->

## Roadmap
a. Foundations + baseline (done) · b. Job connectors (done) · c. Auth + resume parsing (done) · d. Tiering, ranking, dashboard (done) · e. Researcher/Writer/Critic (done) · f. Orchestrator, budgets, memory (done) · g. Evaluation (done; three human steps remain, listed under Evaluation)

Second round (this branch): A quick wins (theme, signup rules, read-only profile, robots) · B security foundation · C saved jobs, role synonyms, watched companies · D alerts · E interview experiences and moderation · F admin dashboard · G adversarial tests and docs.

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

