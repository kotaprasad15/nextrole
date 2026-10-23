"""Plain-text extraction from a resume (compatibility wrapper around `resume.inspect`).

The upload path uses `resume.sandbox.analyze_resume` (isolated process, sanitized copy, hidden-text
report). This helper runs the same checks in-process and returns only the visible text; it is for
scripts, tests and the evaluation tools.
"""
from nextrole.resume.inspect import Limits, ResumeError, inspect_resume

__all__ = ["ResumeError", "extract_text"]


def extract_text(data: bytes, max_bytes: int) -> str:
    return inspect_resume(data, Limits(max_bytes=max_bytes)).text
