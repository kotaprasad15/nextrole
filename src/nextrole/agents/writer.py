"""Writer agent: drafts outreach strictly from the FactSheet.

Design decisions:
- The Writer sees only the fact sheet and the job title/company, never raw resume text or
  the posting's URL. Every factual statement must cite fact ids in `claims`, which is what
  makes grounding checkable (Critic) and measurable (eval).
- Rewrites receive the previous draft plus the Critic's concrete instructions, so each retry
  targets specific failures instead of regenerating blindly.
- The model is told not to write URLs; the Critic also enforces it. Links are added by the UI.
"""
from pydantic import BaseModel, Field

from nextrole.agents.factsheet import render
from nextrole.config import Settings
from nextrole.llm.client import LLMClient
from nextrole.memory import StyleMemory, render_memory
from nextrole.models.job import Job
from nextrole.models.outreach import Channel, Claim, CriticReport, OutreachDraft
from nextrole.models.research import Fact

WORD_RANGE: dict[str, tuple[int, int]] = {"email": (90, 170), "message": (40, 100)}

SYSTEM = (
    "You write a concise, personalized cold outreach {kind} from a job seeker to someone at a "
    "company about a specific role. HARD RULES:\n"
    "1. Use ONLY facts from the FACT SHEET. Never invent or exaggerate anything about the "
    "candidate, the company or the role (no made-up metrics, titles, tools, or news).\n"
    "2. In `claims`, list every factual statement you make about the candidate, company or role, "
    "each with the fact ids (like F-P2, F-J3, F-R1) that support it.\n"
    "3. Length: {lo}-{hi} words in the body. No URLs, no placeholders like [Name], no "
    "attachments mentioned unless a fact says so.\n"
    "4. Be specific: connect one or two concrete candidate facts to something concrete about the "
    "role or company. No clichés ('passionate', 'excited to apply', 'I believe I would be a "
    "great fit'), no flattery.\n"
    "5. Never mention controversies, lawsuits, layoffs or other negative news about the company; "
    "if you reference news, keep it neutral or positive and relevant to the role.\n"
    "6. Greeting: 'Hi {greet},'. Sign off with the candidate's name from the fact sheet. End "
    "with a small, easy ask (e.g. a short call or who to talk to).\n"
    "{subject_rule}"
)


class _WriterOut(BaseModel):
    subject: str = Field(default="", max_length=120)
    body: str
    claims: list[Claim]


class WriterAgent:
    def __init__(self, llm: LLMClient, settings: Settings) -> None:
        self.llm, self.settings = llm, settings

    async def write(
        self, *, facts: list[Fact], job: Job, channel: Channel, recipient_name: str = "",
        previous: tuple[OutreachDraft, CriticReport] | None = None,
        memory: StyleMemory | None = None,
    ) -> OutreachDraft:
        lo, hi = WORD_RANGE[channel]
        system = SYSTEM.format(
            kind="email" if channel == "email" else "direct message",
            lo=lo, hi=hi, greet=recipient_name.split()[0] if recipient_name.strip() else "there",
            subject_rule=("7. Include a specific subject line under 70 characters.\n"
                          if channel == "email" else "7. Leave `subject` empty.\n"),
        )
        user = f"ROLE: {job.title} at {job.company}\n\nFACT SHEET:\n{render(facts)}"
        if memory:
            user += render_memory(memory)
        if previous:
            draft, report = previous
            user += (
                f"\n\nYOUR PREVIOUS DRAFT:\nSubject: {draft.subject}\n{draft.body}\n\n"
                f"A reviewer rejected it. Fix these problems and keep what worked:\n"
                f"{report.rewrite_instructions}\n"
                + "".join(f"- Unsupported: {c}\n" for c in report.unsupported_claims)
                + "".join(f"- Rule violation: {v}\n" for v in report.violations)
            )
        out = await self.llm.complete_json(
            agent="writer", model=self.settings.model_strong, system=system, user=user,
            schema=_WriterOut, max_tokens=3000,
        )
        return OutreachDraft(
            job_id=job.id, channel=channel, subject=out.subject if channel == "email" else "",
            body=out.body.strip(), claims=out.claims,
        )
