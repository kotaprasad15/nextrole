"""Output guard: checks model-written text BEFORE it is shown to the user.

Models can be steered (by an injected posting, a poisoned page, a stale memory) into saying things
we never want in a draft: secrets, our own instructions, contact details of people who are not in
the facts, or links nobody vetted. The Critic already checks grounding; this is the independent,
deterministic last line:

- secrets: API keys, tokens, private keys (CRITICAL: the draft is withheld);
- system-prompt leakage: the per-process canary or signature phrases from our prompts (CRITICAL);
- URLs: none are allowed in a draft, links are added by the UI from source data;
- emails and phone numbers: the Writer is never given any contact details, so one in the output was
  invented or leaked from somewhere it should not have been;
- injected-instruction echoes: text that looks like it addresses a model.
Invented claims are the Critic's job (it compares each claim with the fact sheet).
"""
import re
from dataclasses import dataclass, field

from nextrole.llm.untrusted import CANARY
from nextrole.security.injection import scan

SECRET_PATTERNS = [
    re.compile(r"\bsk-(?:ant-)?[A-Za-z0-9_-]{16,}"),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(r"\bgh[pousr]_[A-Za-z0-9]{30,}"),
    re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{10,}"),
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}"),  # JWT
    re.compile(r"\bBearer\s+[A-Za-z0-9._~+/=-]{20,}"),
    re.compile(r"(?i)\b(api[_-]?key|secret|password|token)\s*[:=]\s*\S{8,}"),
    re.compile(r"\benc:v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16,}"),  # one of OUR ciphertexts
]
_SYSTEM_SIGNATURES = ["SECURITY RULES (highest priority", "untrusted DATA supplied by third parties",
                      "HARD RULES:", "You are a strict reviewer", "FACT SHEET (the only"]
_URL = re.compile(r"(?i)\b(?:https?://|www\.)[^\s<>\"')]+")
_EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
_PHONE = re.compile(r"(?<![\w.])\+?\d[\d\s().-]{8,}\d(?![\w.])")


@dataclass
class GuardReport:
    problems: list[str] = field(default_factory=list)
    critical: bool = False  # secret or prompt leak: do not show the text at all

    @property
    def ok(self) -> bool:
        return not self.problems


def check_text(text: str, *, allowed_urls: set[str] = frozenset(), allowed_contacts: set[str] = frozenset()) -> GuardReport:
    report = GuardReport()
    if any(p.search(text) for p in SECRET_PATTERNS):
        report.problems.append("contains what looks like a secret or credential")
        report.critical = True
    if CANARY in text or any(sig in text for sig in _SYSTEM_SIGNATURES):
        report.problems.append("repeats the assistant's internal instructions")
        report.critical = True
    bad_urls = [u for u in _URL.findall(text) if u.rstrip(".,;") not in allowed_urls]
    if bad_urls:
        report.problems.append("contains a link that did not come from a source record")
    contacts = {m.lower() for m in _EMAIL.findall(text)} | {re.sub(r"\D", "", m) for m in _PHONE.findall(text)}
    if contacts - {c.lower() for c in allowed_contacts}:
        report.problems.append("contains an email address or phone number that is not in the facts")
    if scan(text):
        report.problems.append("contains text that looks like instructions to an AI")
    return report


WITHHELD = "[Draft withheld: it contained content that must not be shown. Please regenerate it.]"
