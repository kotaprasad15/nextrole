"""Does this posting fit one of the roles the user wants? (Without requiring the same title.)

Three tiers, cheapest first, so the model is only asked about the genuinely uncertain ones:
1. taxonomy (`roles.taxonomy.role_matches`): a known synonym or a custom role whose words all appear.
   Certain; the "why" is a template.
2. embedding similarity between the posting title and the wanted role (plus its known aliases):
   at or above `alert_auto_threshold` it is accepted outright (template "why").
3. the borderline band (`alert_verify_threshold` up to the auto threshold) goes to an LLM verifier
   in ONE batched call per user. It must say yes, with confidence at or above `alert_min_confidence`,
   and gives a one-line reason that is shown to the user.
Postings are third-party text and the wanted roles are user text: both go to the model inside
untrusted-data blocks, the model has no tools, its answer is a validated schema, and the reason it
returns is stripped of links before anything stores it.
"""
from dataclasses import dataclass

from pydantic import BaseModel, Field, field_validator

from nextrole.alerts.embedder import Embedder, cosine
from nextrole.config import Settings
from nextrole.llm.client import LLMClient
from nextrole.llm.untrusted import with_data_rule, wrap
from nextrole.models.job import Job
from nextrole.roles import taxonomy
from nextrole.security.text import strip_links

MAX_DESC_FOR_MODEL = 700


@dataclass
class Candidate:
    job: Job
    role: str  # the wanted role it best matches
    score: float  # 1.0 for a taxonomy match, else the cosine similarity
    method: str  # "taxonomy" | "embedding" | "llm"
    why: str = ""
    confidence: float = 0.0


def role_phrases(role: str) -> list[str]:
    """The role itself plus what we know it is also called (so SDE is compared as Software Engineer too)."""
    canonical = taxonomy.canonicalize(role)
    extra = [taxonomy.label(canonical), *taxonomy.aliases(canonical)[:8]] if canonical else []
    seen, out = set(), []
    for p in [role, *extra]:
        if p.lower() not in seen:
            seen.add(p.lower())
            out.append(p)
    return out


def template_why(job: Job, role: str, method: str) -> str:
    canonical = taxonomy.canonicalize(job.title)
    kind = taxonomy.label(canonical) if canonical else None
    if method == "taxonomy":
        return (f"“{job.title}” is a {kind} role, the same kind of job as your wanted role “{role}”."
                if kind else f"“{job.title}” matches your wanted role “{role}”.")
    return f"“{job.title}” reads very close to your wanted role “{role}”."


class RoleScorer:
    """Scores postings against one user's wanted roles; role vectors are computed once."""

    def __init__(self, embedder: Embedder, roles: list[str]) -> None:
        self.embedder, self.roles = embedder, [r.strip() for r in roles if r.strip()]
        self._phrase_vecs: list[tuple[str, list[float]]] = []
        for role in self.roles:
            phrases = role_phrases(role)
            self._phrase_vecs += list(zip([role] * len(phrases), embedder.embed(phrases), strict=True))

    def score(self, job: Job, job_vec: list[float]) -> Candidate | None:
        for role in self.roles:  # certain matches first
            if taxonomy.role_matches(job.title, role):
                return Candidate(job, role, 1.0, "taxonomy", template_why(job, role, "taxonomy"), 0.95)
        best_role, best = "", 0.0
        for role, vec in self._phrase_vecs:
            sim = cosine(job_vec, vec)
            if sim > best:
                best_role, best = role, sim
        return Candidate(job, best_role, best, "embedding") if best_role else None


class _Verdict(BaseModel):
    id: int
    match: bool
    confidence: float = Field(ge=0, le=1)
    why: str = Field(default="", max_length=200)

    @field_validator("why", mode="after")
    @classmethod
    def _no_links(cls, v: str) -> str:
        return strip_links(v)[:160]


class _Verdicts(BaseModel):
    results: list[_Verdict] = Field(max_length=60)


VERIFY_SYSTEM = (
    "You decide whether job postings are the kind of role a candidate is looking for. Companies name the "
    "same job differently (SDE = Software Development Engineer = Member of Technical Staff; FDE = Forward "
    "Deployed Engineer = Customer Engineer), so judge the WORK, not the exact title. For every numbered "
    "posting answer: match (true only if the day-to-day work is genuinely the kind of role in the wanted "
    "list; a different field, such as sales or recruiting, is false even if one word overlaps), confidence "
    "0 to 1, and `why`: ONE short sentence (under 150 characters) addressed to the candidate saying why it "
    "fits, naming the title. Use only what the posting says. No links."
)


async def verify_borderline(
    llm: LLMClient, settings: Settings, wanted_roles: list[str], items: list[Candidate],
) -> dict[int, _Verdict]:
    """One batched call. Returns verdicts keyed by item index; items the model skipped are absent."""
    if not items:
        return {}
    postings = "\n\n".join(
        wrap(f"posting_{i}", f"{c.job.title} at {c.job.company} ({c.job.location})\n{c.job.description[:MAX_DESC_FOR_MODEL]}")
        for i, c in enumerate(items))
    user = ("Roles the candidate wants:\n" + wrap("wanted_roles", "\n".join(f"- {r}" for r in wanted_roles))
            + "\n\nPostings, numbered by the label of their block (posting_0, posting_1, ...):\n" + postings)
    out = await llm.complete_json(
        agent="alert_verify", model=settings.model_fast, system=with_data_rule(VERIFY_SYSTEM), user=user,
        schema=_Verdicts, max_tokens=300 + 140 * len(items))
    return {v.id: v for v in out.results if 0 <= v.id < len(items)}
