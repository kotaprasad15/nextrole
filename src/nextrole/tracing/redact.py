"""Redaction for traces: no full resume text or other long free text is ever persisted.

Design decision: redact by default. Sensitive keys are dropped, and any long string is
replaced with its length, a short hash and a short prefix, so traces stay useful for demos
(you can see shapes and sizes) without leaking PII.
"""
import hashlib
from typing import Any

SENSITIVE_KEYS = {"resume_text", "raw_text", "resume", "password", "api_key", "email"}
MAX_STR = 200


def redact(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            k: "<redacted>" if str(k).lower() in SENSITIVE_KEYS else redact(v)
            for k, v in value.items()
        }
    if isinstance(value, (list, tuple)):
        return [redact(v) for v in value]
    if isinstance(value, str) and len(value) > MAX_STR:
        digest = hashlib.sha256(value.encode()).hexdigest()[:8]
        return f"<str len={len(value)} sha={digest}> {value[:60]}..."
    return value
