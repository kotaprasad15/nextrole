"""Independent judges used ONLY by the evaluation (never by the product pipeline).

Why independent: the product's Critic is part of the system under test (the pipeline rewrites
until the Critic is happy), so scoring the pipeline with that same Critic would be circular.
These judges use different prompts, are blind to which system produced a draft, and see only
the sources that system actually had. They are still LLMs from the same provider, so the
report states that as a limitation instead of treating them as ground truth.
"""
from typing import Literal

from pydantic import BaseModel, Field

from nextrole.config import Settings
from nextrole.llm.client import LLMClient
from nextrole.models.job import Job
from nextrole.models.profile import Profile
from nextrole.models.research import Fact

FACT_SYSTEM = (
    "You are a meticulous fact-checker. You receive SOURCES (the only information the author "
    "had) and an outreach DRAFT. List every verifiable factual claim the draft makes about the "
    "candidate, the company or the role. Ignore greetings, requests, sign-offs and statements "
    "that assert no fact. For each claim choose exactly one verdict:\n"
    "- 'supported': stated in, or directly implied by, the SOURCES.\n"
    "- 'overreach': built from facts that ARE in the SOURCES but claims more than they justify "
    "(an evaluative leap such as 'maps directly to', 'strong experience in', 'perfect fit', or "
    "calling a project 'production-scale' when the sources only say it exists).\n"
    "- 'unsupported': states something that is NOT in the SOURCES or contradicts them (an "
    "invented metric, employer, title, technology, team, news item or company detail).\n"
    "Be strict. 'led' is not 'contributed to'. Metrics, technologies, employers, titles and "
    "news must appear in the SOURCES. Quote each claim briefly."
)

PAIR_SYSTEM = (
    "You compare two cold outreach drafts, A and B, written for the same candidate and role. "
    "Pick the draft a hiring contact would more likely answer: specific to the role and "
    "company, truthful to the candidate profile and posting (invented claims make a draft "
    "worse), concise, natural, no clichés or flattery. Return 'tie' only if they are truly "
    "equal. Judge only the text; ignore length differences unless one is padded or too thin."
)

REL_SYSTEM = (
    "You judge whether a job is a relevant recommendation for a candidate. It is relevant if "
    "the candidate could reasonably apply and have a realistic chance: the role is in a field "
    "they target AND the seniority fits (a new grad should not be shown Staff or Director "
    "roles; a senior should not be shown internships). Judge from the profile and posting only."
)


class Claim(BaseModel):
    text: str
    verdict: Literal["supported", "overreach", "unsupported"]


class FactCheck(BaseModel):
    claims: list[Claim] = Field(default_factory=list, max_length=40)


class Pairwise(BaseModel):
    winner: Literal["A", "B", "tie"]
    reason: str = Field(default="", max_length=300)


class Relevance(BaseModel):
    relevant: bool
    reason: str = Field(default="", max_length=200)


def profile_text(p: Profile, include_preferences: bool = False) -> str:
    """Readable candidate facts (no contact details).

    `include_preferences` must be True when judging a system that was shown the full profile
    JSON (the baseline sees preferences such as remote_ok); the multi-agent fact sheet leaves
    them out, so it is judged without. The judge sees exactly what each system saw.
    """
    lines = [f"Name: {p.name}", f"Summary: {p.summary}", f"Skills: {', '.join(p.skills)}"]
    for e in p.experience:
        lines.append(f"Experience: {e.title} at {e.company} ({e.start}-{e.end})")
        lines += [f"  - {b}" for b in e.bullets]
    for pr in p.projects:
        lines.append(f"Project {pr.name}: {pr.description} [{', '.join(pr.tech)}]")
    for ed in p.education:
        lines.append(f"Education: {ed.degree}, {ed.institution} {ed.year}")
    if include_preferences:
        pr = p.preferences
        lines.append(f"Preferences: target roles {pr.roles}; locations {pr.locations or 'any'}; "
                     f"open to remote: {pr.remote_ok}; level: {pr.experience_level}; {pr.extras}")
    return "\n".join(lines)


def job_text(job: Job, limit: int = 3000) -> str:
    return f"{job.title} at {job.company} ({job.location})\n{job.description[:limit]}"


class Judges:
    def __init__(self, llm: LLMClient, settings: Settings) -> None:
        self.llm, self.model = llm, settings.model_strong

    async def fact_check(
        self, draft_body: str, profile: Profile, job: Job, research: list[Fact] | None = None,
        *, saw_preferences: bool = False,
    ) -> FactCheck:
        # The posting is passed whole (8000 chars): the writers saw up to 3500, and a shorter
        # judge view would mislabel valid claims from the tail as unsupported.
        sources = (f"CANDIDATE:\n{profile_text(profile, saw_preferences)}\n\n"
                   f"POSTING:\n{job_text(job, 8000)}")
        if research:
            sources += "\n\nCOMPANY RESEARCH:\n" + "\n".join(f"- {f.text}" for f in research)
        return await self.llm.complete_json(
            agent="eval_factcheck", model=self.model, system=FACT_SYSTEM,
            user=f"SOURCES:\n{sources}\n\nDRAFT:\n{draft_body}", schema=FactCheck, max_tokens=3000)

    async def pairwise(
        self, a_body: str, b_body: str, profile: Profile, job: Job
    ) -> Pairwise:
        user = (f"CANDIDATE:\n{profile_text(profile)}\n\nPOSTING:\n{job_text(job, 1500)}\n\n"
                f"DRAFT A:\n{a_body}\n\nDRAFT B:\n{b_body}")
        return await self.llm.complete_json(
            agent="eval_pairwise", model=self.model, system=PAIR_SYSTEM, user=user,
            schema=Pairwise, max_tokens=1000)

    async def relevant(self, profile: Profile, job: Job) -> Relevance:
        user = f"CANDIDATE:\n{profile_text(profile)}\n\nTARGET ROLES: " \
               f"{', '.join(profile.preferences.roles)}; LEVEL: {profile.preferences.experience_level}" \
               f"\n\nJOB:\n{job_text(job, 1500)}"
        return await self.llm.complete_json(
            agent="eval_relevance", model=self.model, system=REL_SYSTEM, user=user,
            schema=Relevance, max_tokens=800)
