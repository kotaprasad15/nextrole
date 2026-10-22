"""Heuristic detector for instruction-like text hidden in untrusted content.

This is a TRIPWIRE, not the defence. The real defences are structural: untrusted text only ever
travels inside delimited data blocks (`llm/untrusted.py`), the agents that read it have no tools,
their outputs are schema-validated, and links never come from the model. This scanner exists to
(a) reject files that smuggle instructions in text a human cannot see, (b) log and flag everything
else for review, and (c) give the adversarial test suite something concrete to assert on.

Patterns target text that addresses the MODEL (ignore/disregard instructions, role reassignment,
chat-template tokens, requests to reveal the prompt or emit links), so ordinary prose, including a
security engineer writing "prompt injection" on a CV, does not match.
"""
import re
from dataclasses import dataclass

_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("override_instructions", re.compile(
        r"\b(ignore|disregard|forget|override|bypass)\b[^.]{0,40}\b(previous|prior|above|earlier|all|any|your|the)\b"
        r"[^.]{0,30}\b(instructions?|prompts?|rules?|guidelines?|directives?|system message)\b", re.IGNORECASE)),
    ("role_reassignment", re.compile(
        r"\b(you are now|from now on,? you|pretend (to be|you are)|act as (if you are|an? (ai|assistant|model|language model|system|developer|admin(istrator)?)))\b",
        re.IGNORECASE)),
    ("new_instructions", re.compile(r"\b(new|updated|revised|additional) (system )?instructions?\s*[:\-]", re.IGNORECASE)),
    ("reveal_prompt", re.compile(
        r"\b(reveal|show|print|repeat|output|leak|tell me)\b[^.\n]{0,40}\b(system prompt|your (instructions|prompt|rules)|"
        r"hidden (prompt|instructions)|initial prompt)\b", re.IGNORECASE)),
    ("chat_template_tokens", re.compile(
        r"(<\|?(im_start|im_end|system|assistant|endoftext)\|?>|\[/?INST\]|<</?SYS>>|^\s*(system|assistant)\s*:\s)",
        re.IGNORECASE | re.MULTILINE)),
    ("fake_delimiter", re.compile(r"</?\s*(untrusted_data|system|instructions?|data)\b[^>]*>", re.IGNORECASE)),
    ("exfiltrate_or_link", re.compile(
        r"\b(include|insert|add|append|output|write|embed)\b[^.\n]{0,40}\b(this|the following|my|a)\b[^.\n]{0,20}"
        r"\b(link|url|hyperlink|image|markdown image)\b", re.IGNORECASE)),
    ("score_manipulation", re.compile(
        r"\b(rate|score|rank|mark|recommend)\b[^.\n]{0,30}\b(this|me|candidate|resume|job)\b[^.\n]{0,30}"
        r"\b(100|perfect|highest|top|best|10/10|as a strong match|strongly)\b", re.IGNORECASE)),
    ("tool_or_action_request", re.compile(
        r"\b(you (must|should|will)|please|now)\b[^.\n]{0,15}\b(call|invoke|use|execute|run)\b[^.\n]{0,10}"
        r"\b(the |a )?(tool|function|command|shell|browser)\b", re.IGNORECASE)),
]


@dataclass(frozen=True)
class InjectionFinding:
    code: str
    excerpt: str


def scan(text: str) -> list[InjectionFinding]:
    """Every distinct pattern that matches, with a short excerpt (never the whole text)."""
    out: list[InjectionFinding] = []
    for code, pattern in _PATTERNS:
        m = pattern.search(text)
        if m:
            start = max(0, m.start() - 20)
            out.append(InjectionFinding(code, " ".join(text[start:m.end() + 20].split())[:120]))
    return out


def looks_like_injection(text: str) -> bool:
    return bool(scan(text))
