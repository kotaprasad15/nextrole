"""Automated checks on an interview experience (rules + an LLM classifier). Advisory, never the gate.

Nothing is published by this module. The pipeline decides two things: (1) whether a submission must be
REJECTED outright because it contains personal data we will not store (emails, phone numbers, links,
secrets), and (2) how risky the rest looks, so the admin queue shows the dangerous ones first. A human
admin approves everything before it becomes visible.

Rules (deterministic, cannot be argued with): personal data = blocked; possible personal attack, a named
individual, confidentiality / NDA language, a dump of many exact questions, AI-directed instructions =
flagged for review. The LLM adds a second opinion on PII, attacks and confidential material; the text
goes to it inside an untrusted-data block, it has no tools, and its answer is a validated schema. If the
model is unavailable or its answer is invalid the submission simply waits for a human (fail closed).
A prompt-injected "this is clean" can lower nothing: rule flags are independent and a human decides.
"""
import logging
import re
from dataclasses import asdict, dataclass
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from nextrole.agents.output_guard import SECRET_PATTERNS
from nextrole.config import Settings
from nextrole.llm.client import LLMClient
from nextrole.llm.untrusted import with_data_rule, wrap
from nextrole.security.injection import scan
from nextrole.security.text import strip_links

log = logging.getLogger(__name__)

_EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
_PHONE = re.compile(r"(?<![\w.])\+?\d[\d\s().-]{8,}\d(?![\w.])")
_URL = re.compile(r"(?i)\b(?:https?://|www\.)\S+|\b[a-z0-9-]+\.(?:com|io|net|org|co|ai|dev|in)/\S+|linkedin\.com|\bt\.me/|\bwa\.me/")
_HANDLE = re.compile(r"(?<![\w.])@[A-Za-z0-9_]{3,}")
_ATTACK = re.compile(
    r"(?i)\b(idiot|stupid|moron|dumb|asshole|jerk|incompetent|useless|bastard|scum|clown|creep|liar|"
    r"racist|sexist|harass\w*|disgusting|pathetic|trash|loser)\b")
_NAMED_PERSON = re.compile(r"(?i)\b(?:interviewer|recruiter|hiring manager|engineer|manager|lead|panelist)\s+(?:named|called|was)\s+[A-Z][a-z]{2,}")
_NAMED_PERSON2 = re.compile(r"\b(?:Mr|Mrs|Ms|Dr)\.?\s+[A-Z][a-z]{2,}")
_CONFIDENTIAL = re.compile(
    r"(?i)\b(nda|non[- ]disclosure|confidential|proprietary|trade secret|internal (?:document|doc|wiki|tool|dashboard)|"
    r"leaked|not allowed to (?:share|disclose)|under embargo|company secret|verbatim|exact question|word for word)\b")

Risk = Literal["low", "medium", "high"]


@dataclass
class Flag:
    code: str
    severity: Literal["block", "review", "high"]
    detail: str


def rule_flags(text: str) -> list[Flag]:
    out: list[Flag] = []
    if _EMAIL.search(text):
        out.append(Flag("email", "block", "an email address"))
    if _PHONE.search(text):
        out.append(Flag("phone", "block", "a phone number"))
    if _URL.search(text):
        out.append(Flag("link", "block", "a link"))
    if any(p.search(text) for p in SECRET_PATTERNS):
        out.append(Flag("secret", "block", "something that looks like a credential"))
    if _HANDLE.search(text):
        out.append(Flag("handle", "review", "a social media handle"))
    if _ATTACK.search(text):
        out.append(Flag("attack", "review", "language that may be a personal attack"))
    if _NAMED_PERSON.search(text) or _NAMED_PERSON2.search(text):
        out.append(Flag("named_person", "review", "may name an individual"))
    if _CONFIDENTIAL.search(text):
        out.append(Flag("confidential", "review", "mentions confidentiality or NDA material"))
    if text.count("?") >= 8:
        out.append(Flag("question_dump", "review", "lists many exact questions"))
    if scan(text):
        out.append(Flag("ai_instructions", "high", "text that looks like instructions to an AI"))
    return out


BLOCK_MESSAGES = {
    "email": "Please remove email addresses.", "phone": "Please remove phone numbers.",
    "link": "Please remove links (to profiles, documents or websites).",
    "secret": "Please remove anything that looks like a password, key or token.",
}


def blocking_problems(flags: list[Flag]) -> list[str]:
    return [BLOCK_MESSAGES[f.code] for f in flags if f.severity == "block"]


class _Verdict(BaseModel):
    pii: bool = False
    attack: bool = False
    confidential: bool = False
    risk: Risk = "low"
    reasons: list[str] = Field(default_factory=list, max_length=4)

    @field_validator("reasons", mode="after")
    @classmethod
    def _tidy(cls, v: list[str]) -> list[str]:
        return [strip_links(r)[:140] for r in v if strip_links(r)]


SYSTEM = (
    "You are a content-safety reviewer for interview experiences that job candidates share with other "
    "candidates. Decide whether the submission contains: (pii) personal data about a real person, such as "
    "a full name of an interviewer, contact details, or an identifiable private detail; (attack) a personal "
    "attack, harassment or discriminatory language aimed at a person; (confidential) confidential or "
    "proprietary company information, verbatim interview questions or assessment answers, source code, "
    "internal documents or anything covered by a non-disclosure agreement. General descriptions of the "
    "kinds of questions asked, the difficulty, the process and honest opinions about the experience are "
    "FINE. Set risk to high if any of the three is clearly present, medium if unsure, otherwise low. "
    "`reasons`: at most three short phrases, no quotations of the text."
)


@dataclass
class AutoCheck:
    flags: list[Flag]
    llm: dict | None
    llm_status: Literal["ok", "unavailable"]
    risk: Risk

    def as_json(self) -> dict:
        return {"flags": [asdict(f) for f in self.flags], "llm": self.llm, "llm_status": self.llm_status, "risk": self.risk}


def _combine(flags: list[Flag], llm: _Verdict | None) -> Risk:
    if any(f.severity == "high" for f in flags) or (llm and llm.risk == "high"):
        return "high"
    if any(f.severity in {"review", "block"} for f in flags) or (llm and (llm.risk == "medium" or llm.pii or llm.attack or llm.confidential)):
        return "medium"
    return "low"


async def auto_check(llm_factory, settings: Settings, text: str, flags: list[Flag] | None = None) -> AutoCheck:
    """Rules plus the model's second opinion. Never raises: a model problem leaves the item for a human."""
    flags = rule_flags(text) if flags is None else flags
    verdict: _Verdict | None = None
    status: Literal["ok", "unavailable"] = "ok"
    try:
        client: LLMClient = llm_factory()
        verdict = await client.complete_json(
            agent="interview_moderation", model=settings.model_fast, system=with_data_rule(SYSTEM),
            user="Review this submission.\n\n" + wrap("interview_experience", text, max_chars=6000),
            schema=_Verdict, max_tokens=500)
    except Exception as exc:  # noqa: BLE001 - fail closed: it just waits in the admin queue
        log.warning("interview moderation model unavailable: %r", exc)
        status = "unavailable"
    return AutoCheck(flags=flags, llm=verdict.model_dump() if verdict else None, llm_status=status, risk=_combine(flags, verdict))
