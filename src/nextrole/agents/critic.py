"""Critic agent: scores a draft on a rubric and checks it for invented claims.

Two layers, deliberately:
- Deterministic rules (code, cannot be talked around): no URLs, no placeholders, every claim
  cites a real fact id, word count in range. These produce `violations` and the length score.
- LLM judgment: specificity, tone, no-fluff, and *grounding*: does each statement follow from
  the facts it cites? Statements not supported by any fact go in `unsupported_claims`.
A draft passes only if the overall score clears the threshold AND there are no unsupported
claims AND no rule violations. Any invented claim forces a rewrite regardless of score.
"""
import re

from pydantic import BaseModel, Field

from nextrole.agents.factsheet import render
from nextrole.agents.writer import WORD_RANGE
from nextrole.config import Settings
from nextrole.llm.client import LLMClient
from nextrole.models.outreach import CriticReport, OutreachDraft
from nextrole.models.research import Fact

WEIGHTS = {"specificity": 0.25, "grounding": 0.30, "tone": 0.15, "no_fluff": 0.20, "length": 0.10}
_URL = re.compile(r"https?://|www\.", re.IGNORECASE)
_PLACEHOLDER = re.compile(r"\[[^\]]{2,}\]|\{\{|<[A-Za-z ]+>")

SYSTEM = (
    "You are a strict reviewer of cold outreach drafts. You receive a FACT SHEET (the only "
    "allowed source of truth) and a DRAFT with the claims its author cited. Score 0-100 each:\n"
    "- specificity: ties concrete candidate facts to concrete role/company details; generic = low.\n"
    "- tone: professional, warm, concise, human; not pushy, sycophantic or robotic.\n"
    "- grounding: every statement is supported by the fact sheet. Penalise exaggeration "
    "(e.g. 'led', 'expert', 'built at scale' when facts do not say so).\n"
    "- no_fluff: no clichés, filler or empty enthusiasm.\n"
    "List in `unsupported_claims` any statement in the body (cited or not) that is NOT "
    "supported by the fact sheet, quoting it briefly. If the draft is fully grounded, return an "
    "empty list. In `rewrite_instructions` give 1-3 concrete fixes (empty if nothing to fix)."
)


class _CriticOut(BaseModel):
    specificity: int = Field(ge=0, le=100)
    tone: int = Field(ge=0, le=100)
    grounding: int = Field(ge=0, le=100)
    no_fluff: int = Field(ge=0, le=100)
    unsupported_claims: list[str] = Field(default_factory=list, max_length=8)
    rewrite_instructions: str = Field(default="", max_length=600)


def word_count(text: str) -> int:
    return len(text.split())


def length_score(words: int, lo: int, hi: int) -> int:
    """100 inside the range, dropping 3 points per word outside it."""
    gap = lo - words if words < lo else words - hi if words > hi else 0
    return max(0, 100 - 3 * gap)


def rule_violations(draft: OutreachDraft, facts: list[Fact]) -> list[str]:
    """Deterministic checks that don't need a model."""
    known = {f.id for f in facts}
    out: list[str] = []
    text = f"{draft.subject}\n{draft.body}"
    if _URL.search(text):
        out.append("contains a URL; links must not be written in the message")
    if _PLACEHOLDER.search(text):
        out.append("contains a placeholder like [Name]")
    if not draft.claims:
        out.append("cites no facts (claims is empty)")
    bad = sorted({i for c in draft.claims for i in c.fact_ids if i not in known})
    if bad:
        out.append(f"cites fact ids that do not exist: {', '.join(bad)}")
    if draft.channel == "email" and not draft.subject.strip():
        out.append("email has no subject")
    return out


class CriticAgent:
    def __init__(self, llm: LLMClient, settings: Settings) -> None:
        self.llm, self.settings = llm, settings

    async def review(self, draft: OutreachDraft, facts: list[Fact]) -> CriticReport:
        claims = "\n".join(f"- {c.text}  (cites {', '.join(c.fact_ids)})" for c in draft.claims)
        user = (f"FACT SHEET:\n{render(facts)}\n\nDRAFT ({draft.channel})\nSubject: "
                f"{draft.subject}\n{draft.body}\n\nCLAIMS CITED BY AUTHOR:\n{claims or '(none)'}")
        out = await self.llm.complete_json(
            agent="critic", model=self.settings.model_strong, system=SYSTEM, user=user,
            schema=_CriticOut, max_tokens=2000,
        )
        lo, hi = WORD_RANGE[draft.channel]
        scores = {
            "specificity": out.specificity, "tone": out.tone, "grounding": out.grounding,
            "no_fluff": out.no_fluff, "length": length_score(word_count(draft.body), lo, hi),
        }
        overall = round(sum(scores[k] * w for k, w in WEIGHTS.items()))
        violations = rule_violations(draft, facts)
        passed = (overall >= self.settings.critic_threshold and not out.unsupported_claims
                  and not violations)
        return CriticReport(
            scores=scores, overall=overall, unsupported_claims=out.unsupported_claims,
            violations=violations, verdict="pass" if passed else "revise",
            rewrite_instructions=out.rewrite_instructions,
        )
