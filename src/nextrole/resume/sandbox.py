"""Run resume inspection in an isolated child process (see resume/worker.py for why).

Controls: hard wall-clock timeout, capped stdout, a scrubbed environment (no API keys or
encryption keys reach the parser), a throwaway working directory, and on POSIX address-space and
CPU limits. Honest limits: this is process isolation, not a full sandbox (no seccomp/namespaces,
so no network blocking); run the API in a container for defence in depth.
"""
import asyncio
import base64
import dataclasses
import json
import os
import subprocess
import sys
import tempfile

from nextrole.config import Settings
from nextrole.resume.inspect import Finding, Inspection, Limits, ResumeError, inspect_resume

MEMORY_LIMIT = 1_500_000_000


def limits_from(settings: Settings) -> Limits:
    return Limits(max_bytes=settings.max_upload_mb * 1024 * 1024, max_pages=settings.max_resume_pages)


def _posix_limits(cpu_s: int):
    def apply() -> None:  # runs in the child between fork and exec
        import resource

        resource.setrlimit(resource.RLIMIT_AS, (MEMORY_LIMIT, MEMORY_LIMIT))
        resource.setrlimit(resource.RLIMIT_CPU, (cpu_s, cpu_s + 2))
        resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))

    return apply


def _run_child(data: bytes, limits: Limits, timeout_s: float) -> dict:
    env = {k: v for k, v in os.environ.items() if k in {"SYSTEMROOT", "PATH", "LANG", "LC_ALL", "TMP", "TEMP"}}
    with tempfile.TemporaryDirectory() as workdir:
        try:
            proc = subprocess.run(
                [sys.executable, "-I", "-m", "nextrole.resume.worker", json.dumps(dataclasses.asdict(limits))],
                input=data, capture_output=True, timeout=timeout_s, cwd=workdir, env=env, check=False,
                preexec_fn=_posix_limits(int(timeout_s)) if os.name == "posix" else None,
            )
        except subprocess.TimeoutExpired as exc:
            raise ResumeError("that file took too long to process") from exc
    if proc.returncode != 0 or not proc.stdout:
        raise ResumeError("could not process that file")
    if len(proc.stdout) > 4 * limits.max_bytes + 1_000_000:
        raise ResumeError("could not process that file")
    return json.loads(proc.stdout)


async def analyze_resume(data: bytes, settings: Settings) -> Inspection:
    limits = limits_from(settings)
    if not settings.resume_isolation:  # tests / debugging only
        return inspect_resume(data, limits)
    out = await asyncio.to_thread(_run_child, data, limits, settings.resume_parse_timeout_s)
    if not out.get("ok"):
        raise ResumeError(out.get("error") or "could not process that file")
    return Inspection(
        kind=out["kind"], text=out["text"], hidden_text=out["hidden_text"], pages=out["pages"],
        findings=[Finding(**f) for f in out["findings"]], sanitized=base64.b64decode(out["sanitized_b64"]),
    )
