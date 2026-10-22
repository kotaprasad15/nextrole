"""Subprocess entry point: parse ONE untrusted resume from stdin, print a JSON result to stdout.

Why a separate process: PDF/DOCX parsers are large, complex and have a history of crashes, hangs
and memory blow-ups on hostile input. Running them here means such a failure kills only this child
(the parent applies a timeout and, on POSIX, memory/CPU limits) and the API process never touches
the parsed object graph. The child sees no secrets (the parent passes a minimal environment) and
only ever emits plain data. Usage: `python -I -m nextrole.resume.worker '<limits json>' < file`.
"""
import base64
import json
import sys

from nextrole.resume.inspect import Limits, ResumeError, inspect_resume


def main() -> int:
    limits = Limits(**json.loads(sys.argv[1])) if len(sys.argv) > 1 else Limits()
    data = sys.stdin.buffer.read(limits.max_bytes + 1)
    try:
        result = inspect_resume(data, limits)
    except ResumeError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}))
        return 0
    except Exception:  # never leak parser internals; the parent shows a generic message
        print(json.dumps({"ok": False, "error": "could not process that file"}))
        return 0
    print(json.dumps({
        "ok": True, "kind": result.kind, "text": result.text, "hidden_text": result.hidden_text,
        "pages": result.pages,
        "findings": [{"code": f.code, "severity": f.severity, "detail": f.detail} for f in result.findings],
        "sanitized_b64": base64.b64encode(result.sanitized).decode(),
    }))
    return 0


if __name__ == "__main__":
    sys.exit(main())
