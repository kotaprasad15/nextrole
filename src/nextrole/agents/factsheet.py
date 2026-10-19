"""FactSheet: the closed set of facts the Writer may use, each with a stable id.

Design decision: this is the grounding contract. Outreach may only assert things present
here (profile + job posting + retrieved research). Ids are prefixed by origin: F-P (profile),
F-J (job), F-R (research, assigned by the Researcher). The Critic checks every claim in the
draft against these ids and texts.
"""
import re

from nextrole.models.job import Job
from nextrole.models.profile import Profile
from nextrole.models.research import CompanyResearch, Fact

_SENTENCE = re.compile(r"(?<=[.!?])\s+")
MAX_JOB_SENTENCES = 10


def build_fact_sheet(profile: Profile, job: Job, research: CompanyResearch | None) -> list[Fact]:
    facts: list[Fact] = []

    def add(prefix: str, text: str, source: str, ref: str | None = None) -> None:
        text = " ".join(text.split())
        if text:
            n = sum(f.id.startswith(prefix) for f in facts) + 1
            facts.append(Fact(id=f"{prefix}{n}", text=text[:300], source=source, source_ref=ref))

    # --- candidate (never includes contact details) ---
    if profile.name:
        add("F-P", f"Candidate name: {profile.name}", "profile")
    if profile.summary:
        add("F-P", f"Candidate summary: {profile.summary}", "profile")
    if profile.skills:
        add("F-P", "Candidate skills: " + ", ".join(profile.skills[:20]), "profile")
    for e in profile.experience:
        dates = f" ({e.start}-{e.end})" if e.start or e.end else ""
        add("F-P", f"Experience: {e.title} at {e.company}{dates}", "profile")
        for b in e.bullets[:4]:
            add("F-P", f"At {e.company}: {b}", "profile")
    for p in profile.projects:
        tech = f" using {', '.join(p.tech)}" if p.tech else ""
        add("F-P", f"Project {p.name}: {p.description}{tech}", "profile")
    for ed in profile.education:
        add("F-P", f"Education: {ed.degree} at {ed.institution} {ed.year}".strip(), "profile")

    # --- the job posting (from the source API) ---
    add("F-J", f"Role: {job.title} at {job.company}", "job", job.apply_url)
    if job.location:
        add("F-J", f"Job location: {job.location}", "job", job.apply_url)
    sentences = [s for s in _SENTENCE.split(job.description) if len(s) > 40]
    for s in sentences[:MAX_JOB_SENTENCES]:
        add("F-J", f"Job posting says: {s}", "job", job.apply_url)

    # --- company research (tool results) ---
    if research:
        facts.extend(research.facts)
    return facts


def render(facts: list[Fact]) -> str:
    """Prompt form: one fact per line, id first."""
    return "\n".join(f"[{f.id}] {f.text}" for f in facts)
