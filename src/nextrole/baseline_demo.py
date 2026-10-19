"""Live demo: `uv run python -m nextrole.baseline_demo` (needs ANTHROPIC_API_KEY in .env)."""
import asyncio

from nextrole.agents.baseline import run_baseline
from nextrole.config import get_settings
from nextrole.llm.budget import Budget
from nextrole.llm.client import LLMClient
from nextrole.models.job import Job
from nextrole.models.profile import Experience, Profile
from nextrole.tracing.tracer import Tracer

PROFILE = Profile(
    name="Sample Candidate",
    skills=["Python", "FastAPI", "SQL"],
    experience=[Experience(company="Demo Co", title="Intern", bullets=["Built a REST API"])],
)
JOB = Job(
    source="demo", source_id="1", title="Backend Engineer", company="Example Inc",
    location="Remote", description="Build Python APIs for our platform.",
    apply_url="https://example.com/careers/1",
)


async def main() -> None:
    s = get_settings()
    llm = LLMClient(s, Budget.from_settings(s), Tracer(s.trace_dir))
    draft = await run_baseline(llm, s.model_fast, PROFILE, JOB)
    print(f"Subject: {draft.subject}\n\n{draft.body}")
    print(f"\ntokens={llm.budget.tokens_used} cost=${llm.budget.cost_usd:.4f} trace={llm.tracer.path}")


if __name__ == "__main__":
    asyncio.run(main())
