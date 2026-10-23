"""Admin-only read access to the JSONL traces kept for debugging.

Traces are written through `redact()` already (sensitive keys dropped, emails/phones/tokens masked, long
text reduced to length+hash). They are redacted AGAIN on the way out as defence in depth, the run id is
validated so it can never address a file outside the trace folder, and nothing here knows which user a
run belongs to.
"""
import json
import re
from datetime import UTC, datetime
from pathlib import Path

from nextrole.tracing.redact import redact

_RUN_ID = re.compile(r"^[A-Za-z0-9_-]{4,64}$")
MAX_ENTRIES = 200


def valid_run_id(run_id: str) -> bool:
    return bool(_RUN_ID.match(run_id))


def list_traces(trace_dir: Path, limit: int = 50) -> list[dict]:
    root = Path(trace_dir)
    if not root.is_dir():
        return []
    files = sorted(root.glob("*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True)[:limit]
    out = []
    for f in files:
        if not valid_run_id(f.stem):
            continue
        st = f.stat()
        out.append({"run_id": f.stem, "modified": datetime.fromtimestamp(st.st_mtime, UTC).isoformat(), "size_bytes": st.st_size})
    return out


def read_trace(trace_dir: Path, run_id: str) -> list[dict] | None:
    if not valid_run_id(run_id):
        return None
    path = Path(trace_dir) / f"{run_id}.jsonl"
    if not path.is_file():
        return None
    entries = []
    for line in path.read_text(encoding="utf-8").splitlines()[:MAX_ENTRIES]:
        try:
            e = json.loads(line)
        except json.JSONDecodeError:
            continue
        entries.append(redact({k: e.get(k) for k in ("run_id", "ts", "agent", "inputs", "outputs", "latency_ms", "input_tokens",
                                                     "output_tokens", "cost_usd", "error")}))
    return entries
