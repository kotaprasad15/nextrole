"""Redaction for traces and logs: no PII and no full free text is ever persisted.

Design decision: redact by default. Sensitive keys are dropped, long strings are replaced by their
length and a short hash (NO text prefix: the first lines of a resume are a name and an email),
and in every remaining string emails, phone numbers and key-like tokens are masked. Traces stay
useful for debugging (shapes, sizes, latencies, which agent failed) without leaking personal data.
"""
import hashlib
import re
from typing import Any

SENSITIVE_KEYS = {"resume_text", "raw_text", "resume", "password", "api_key", "email", "phone", "address",
                  "name", "token", "secret", "authorization", "cookie", "recipient_email", "summary",
                  "profile", "profile_json", "draft", "body", "subject", "text", "note"}
MAX_STR = 200

_EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
_PHONE = re.compile(r"(?<![\w.])\+?\d[\d\s().-]{8,}\d(?![\w.])")
_TOKEN = re.compile(r"\b(?:sk-[A-Za-z0-9_-]{12,}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+|enc:v1:\S+)")


def scrub_pii(text: str) -> str:
    """Mask emails, phone numbers and key-like tokens inside a string."""
    return _TOKEN.sub("<secret>", _PHONE.sub("<phone>", _EMAIL.sub("<email>", text)))


def redact(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            k: "<redacted>" if str(k).lower() in SENSITIVE_KEYS else redact(v)
            for k, v in value.items()
        }
    if isinstance(value, (list, tuple)):
        return [redact(v) for v in value]
    if isinstance(value, str):
        if len(value) > MAX_STR:
            digest = hashlib.sha256(value.encode()).hexdigest()[:8]
            return f"<str len={len(value)} sha={digest}>"
        return scrub_pii(value)
    return value
