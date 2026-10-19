# NextRole — CLAUDE.md

Multi-agent job search + outreach platform. Prompting, tool use and orchestration only (no fine-tuning).
Full design: see the approved proposal (agents, schemas, data model, milestones a–g).

## Commands
- Install: `uv sync`
- Tests: `uv run pytest -q` (LLM and HTTP always mocked)
- Lint: `uv run ruff check .`
- Live baseline demo: `uv run python -m nextrole.baseline_demo` (needs `.env` with `ANTHROPIC_API_KEY`)

## Architecture (current: milestone a)
- `config.py`: all tunables from `.env` (model names, budgets, prices). Never hardcode a model.
- `llm/client.py`: the only gateway to Anthropic. Retries (transient only), timeout, budget check, tracing, JSON output validated by Pydantic with one repair retry.
- `llm/budget.py`: per-run token/cost cap (`BudgetExceeded`).
- `tracing/`: JSONL trace per run in `traces/`, always passed through `redact()` (no resume text).
- `models/`: Pydantic types. `HttpsUrl` enforces https; `Job.apply_url` is set only by source connectors.
- `agents/baseline.py`: single-agent baseline (control for the eval).

## Conventions
- Type hints everywhere; small functions; docstrings explain *why*.
- The LLM never generates or edits URLs. Agent outputs reference `job_id` only.
- Drafts are never auto-sent; human approval gates "ready to send".
- Ask before adding dependencies or making major architectural changes.
- Never commit secrets; `.env` is gitignored.
