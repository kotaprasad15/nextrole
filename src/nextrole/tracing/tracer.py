"""Structured tracing: one JSON line per agent step (inputs, outputs, latency, tokens).

Design decision: JSONL on disk, one file per run. It is append-only, easy to replay in a
demo, and needs no infrastructure. Everything passes through redact().
"""
import json
import time
import uuid
from pathlib import Path
from typing import Any

from nextrole.tracing.redact import redact


class Tracer:
    def __init__(self, trace_dir: Path, run_id: str | None = None) -> None:
        self.run_id = run_id or uuid.uuid4().hex[:12]
        self.path = Path(trace_dir) / f"{self.run_id}.jsonl"
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def record(
        self,
        agent: str,
        inputs: Any,
        outputs: Any,
        *,
        latency_ms: float,
        input_tokens: int = 0,
        output_tokens: int = 0,
        cost_usd: float = 0.0,
        error: str | None = None,
    ) -> None:
        entry = {
            "run_id": self.run_id,
            "ts": time.time(),
            "agent": agent,
            "inputs": redact(inputs),
            "outputs": redact(outputs),
            "latency_ms": round(latency_ms, 1),
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "cost_usd": round(cost_usd, 6),
            "error": error,
        }
        with self.path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry, default=str) + "\n")
