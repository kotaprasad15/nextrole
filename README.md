# NextRole

Agentic job search and outreach: parse a resume, find real openings from legitimate sources (Greenhouse, Lever, Ashby, Adzuna), tier companies (Startup / Mid-size / MNC), explain fit, link to the real application page, and draft a grounded, human-approved outreach message. Built with prompting, tool use and LangGraph orchestration only.

> Status: milestone f (LangGraph orchestrator, live SSE feed, memory, paste-a-job). See the roadmap below.

## Setup
```bash
uv sync
cp .env.example .env   # add ANTHROPIC_API_KEY
uv run pytest -q
uv run python -m nextrole.baseline_demo
```

## Roadmap
a. Foundations + baseline (done) · b. Job connectors (done) · c. Auth + resume parsing (done) · d. Tiering, ranking, dashboard (done) · e. Researcher/Writer/Critic (done) · f. Orchestrator, budgets, memory (done) · g. Evaluation

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

## Evaluation results
_Added in milestone g._
