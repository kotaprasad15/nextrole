# NextRole

Agentic job search and outreach: parse a resume, find real openings from legitimate sources (Greenhouse, Lever, Ashby, Adzuna), tier companies (Startup / Mid-size / MNC), explain fit, link to the real application page, and draft a grounded, human-approved outreach message. Built with prompting, tool use and LangGraph orchestration only.

> Status: milestone c (auth, onboarding, resume parsing, profile edit). See the roadmap below.

## Setup
```bash
uv sync
cp .env.example .env   # add ANTHROPIC_API_KEY
uv run pytest -q
uv run python -m nextrole.baseline_demo
```

## Roadmap
a. Foundations + baseline (done) · b. Job connectors (done) · c. Auth + resume parsing (done) · d. Tiering, ranking, dashboard · e. Researcher/Writer/Critic · f. Orchestrator, budgets, memory · g. Evaluation

## Agent flow
_Diagram added in milestone f._

## Evaluation results
_Added in milestone g._
