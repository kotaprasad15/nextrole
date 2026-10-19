"""RunManager: runs orchestrated pipelines in the background and keeps their history.

Design decisions:
- A run is an asyncio task owned by the app, so the HTTP request that starts it returns
  immediately (202) and the UI follows progress over SSE.
- One active run per user: a second start is rejected (409). That bounds spend and prevents a
  double-click from launching two budgets of LLM calls.
- Each run gets its own LLM client (so its own `Budget` and trace file); the trace id doubles
  as the run id, linking the live feed, the history row and the JSONL trace.
- The `run_finished` event is emitted and the history row written in one synchronous stretch
  (no await between), so a client that sees `run_finished` can immediately read the final row.
"""
import asyncio
import logging
import sqlite3
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import httpx

from nextrole.config import Settings
from nextrole.db import repos
from nextrole.llm.client import LLMClient
from nextrole.orchestrator.events import EventSink
from nextrole.orchestrator.graph import run_graph
from nextrole.orchestrator.state import Deps

log = logging.getLogger(__name__)


class RunConflict(Exception):
    """The user already has a run in progress."""


@dataclass
class ActiveRun:
    run_id: str
    user_id: int
    sink: EventSink
    task: asyncio.Task


class RunManager:
    def __init__(
        self, conn: sqlite3.Connection, settings: Settings, llm_factory: Callable[[], LLMClient],
        http_factory: Callable[[], httpx.AsyncClient], discover: Callable[..., Any],
    ) -> None:
        self.conn, self.settings = conn, settings
        self.llm_factory, self.http_factory, self.discover = llm_factory, http_factory, discover
        self.active: dict[str, ActiveRun] = {}

    def start(self, *, user_id: int, mode: str, initial: dict) -> str:
        if any(a.user_id == user_id for a in self.active.values()):
            raise RunConflict("a run is already in progress")
        llm = self.llm_factory()
        run_id = llm.tracer.run_id if llm.tracer else uuid.uuid4().hex[:12]
        repos.create_run(self.conn, run_id, user_id, mode)
        sink = EventSink()
        task = asyncio.create_task(self._execute(run_id, user_id, mode, initial, llm, sink))
        self.active[run_id] = ActiveRun(run_id, user_id, sink, task)
        return run_id

    def sink_for(self, user_id: int, run_id: str) -> EventSink | None:
        run = self.active.get(run_id)
        return run.sink if run and run.user_id == user_id else None

    def cancel_user(self, user_id: int) -> None:
        """Stop a user's in-flight run (used when they delete their account)."""
        for run in list(self.active.values()):
            if run.user_id == user_id:
                # Called from a worker thread (sync endpoint): cancel on the task's own loop.
                run.task.get_loop().call_soon_threadsafe(run.task.cancel)
                self.active.pop(run.run_id, None)

    async def _execute(
        self, run_id: str, user_id: int, mode: str, initial: dict, llm: LLMClient, sink: EventSink
    ) -> None:
        status, error, result = "failed", None, {}
        try:
            async with self.http_factory() as http:
                deps = Deps(llm=llm, settings=self.settings, conn=self.conn, http=http,
                            discover=self.discover, sink=sink)
                final = await run_graph(mode, deps, {**initial, "user_id": user_id})
            status = final.get("status", "failed")
            result = final.get("result", {})
            error = result.get("error")
        except asyncio.CancelledError:
            self.active.pop(run_id, None)
            sink.close()
            raise
        except Exception:
            log.exception("run %s crashed", run_id)
            error = "internal error"
        budget = llm.budget
        # Emit, persist and close with no await in between (see module docstring).
        sink.emit("run_finished", detail=status, tokens=budget.tokens_used,
                  cost_usd=round(budget.cost_usd, 6),
                  data={"status": status, "result": result, "error": error})
        repos.finish_run(
            self.conn, run_id, status=status, job_id=result.get("job_id"),
            tokens=budget.tokens_used, cost_usd=round(budget.cost_usd, 6), error=error,
            events=[e.model_dump() for e in sink.events], result=result)
        sink.close()
        self.active.pop(run_id, None)
