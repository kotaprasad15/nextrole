# NextRole — CLAUDE.md

Multi-agent job search + outreach platform. Prompting, tool use and orchestration only (no fine-tuning).
Full design: see the approved proposal (agents, schemas, data model, milestones a–g).

## Commands
- Install: `uv sync`
- Tests: `uv run pytest -q` (LLM and HTTP always mocked)
- Lint: `uv run ruff check .`
- Live baseline demo: `uv run python -m nextrole.baseline_demo` (needs `.env` with `ANTHROPIC_API_KEY`)

- Live job discovery (no key needed): `uv run python -m nextrole.jobs_demo "software engineer" "remote"`

- App (API + UI): `uv run uvicorn nextrole.api.main:app --reload`, open http://localhost:8000 (set `RESUME_ENCRYPTION_KEY` in `.env` first)

## Architecture (current: milestone d)
- `config.py`: all tunables from `.env` (model names, budgets, prices). Never hardcode a model.
- `llm/client.py`: the only gateway to Anthropic. Retries (transient only), timeout, budget check, tracing, JSON output validated by Pydantic with one repair retry.
- Provider: `LLM_BASE_URL` (empty = Anthropic) points the same SDK at any Anthropic-compatible endpoint, e.g. DeepSeek `https://api.deepseek.com/anthropic` with `MODEL_FAST=deepseek-flash`, `MODEL_STRONG=deepseek-v4-pro`. Set `PRICE_*` to that provider's rates. PII caveat: DeepSeek hosted API is for sample resumes only.
- `llm/budget.py`: per-run token/cost cap (`BudgetExceeded`).
- `tracing/`: JSONL trace per run in `traces/`, always passed through `redact()` (no resume text).
- `models/`: Pydantic types. `HttpsUrl` enforces https; `Job.apply_url` is set only by source connectors.
- `sources/`: `BoardSource` connectors (Greenhouse, Lever, Ashby) normalize public ATS payloads into `Job`; `registry.discover()` fans out in parallel with timeouts/retries, records per-board errors instead of failing, filters by `Preferences`, and dedupes. Boards are curated in `data/boards.json`. Apply URLs are copied verbatim from the API; non-https rows are skipped.
- `db/`: sqlite3 + `schema.sql` + `repos.py` functions (no ORM). Cascade deletes: deleting a user removes sessions/profile; the encrypted resume file is deleted by the caller (`DELETE /me`). One shared connection (`check_same_thread=False`) is fine for the demo; use per-request connections before real deployment.
- `auth/`: Argon2 password hashes; opaque server-side sessions (only SHA-256 of the token stored; HttpOnly SameSite=Lax cookie). Not yet: login throttling.
- `resume/`: `extract_text` (magic-byte type check + size cap, PDF/DOCX) and `ResumeStore` (Fernet-encrypted at rest, needs `RESUME_ENCRYPTION_KEY`).
- `agents/intake.py`: resume text -> `Profile` via `ExtractedProfile` schema; resume is untrusted data (injection guard in prompt, schema-constrained output).
- `api/`: `create_app(settings, conn, llm_factory)` factory (injectable for tests). Routes: `/auth/signup|login|logout`, `DELETE /me`, `POST /onboarding` (multipart), `GET /me`, `GET|PUT /profile`. Run: `uv run uvicorn nextrole.api.main:app --reload`.
- `web/`: framework-free frontend (index.html, app.css, app.js), served same-origin by FastAPI at `/` and `/static` (no CORS, no build step). `h()` helper builds DOM; user/LLM text is only set via textContent/value, never innerHTML. Views: auth, onboarding, dashboard (`#/dashboard`, three tier sections, Apply opens source URL in new tab), profile editor (`#/profile`).
- `agents/tiering.py`: startup/mid/mnc. Order: DB cache -> `data/mnc_seed.json` -> employee-count thresholds (`tier_from_employee_count`, no source supplies counts yet) -> one batched LLM call. Every confident (>=0.6) decision is cached in `company_tiers`; low-confidence ones are not.
- `agents/matcher.py`: `select_candidates` (rank within each tier by keyword overlap + seniority fit, per-company cap, round-robin across tiers so every dashboard section gets candidates) then `MatcherAgent` scores each with the LLM (0-100, strengths, gaps, 1-sentence rationale; concurrent, one failure drops one job, budget exhaustion stops cleanly). Prompt contains no URLs.
- `recommend.py`: pipeline discover -> tier all companies -> select -> match -> persist (`jobs`, `matches` tables). Milestone f wraps it in LangGraph. API: `POST /recommendations/refresh`, `GET /recommendations` (grouped by tier; `apply_url` read from stored source data). Prices in `.env` (`PRICE_*`) must match the provider or reported cost is wrong.
- Reasoning models (e.g. DeepSeek) can spend `max_tokens` before emitting text; keep generous headroom (matcher 1000, tiering 400+80/company) because a truncated JSON reply costs a retry.
- `agents/baseline.py`: single-agent baseline (control for the eval).

## Conventions
- Type hints everywhere; small functions; docstrings explain *why*.
- The LLM never generates or edits URLs. Agent outputs reference `job_id` only.
- Drafts are never auto-sent; human approval gates "ready to send".
- Ask before adding dependencies or making major architectural changes.
- Never commit secrets; `.env` is gitignored.
