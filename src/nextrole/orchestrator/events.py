"""Run events: the live step feed shown in the UI (via SSE) and stored for replay.

Design decision: events are plain, redacted, human-readable facts about progress (step name,
short detail, latency, cumulative tokens/cost), never prompts or resume text. The sink keeps
the full list (replayed to late subscribers, persisted with the run) and fans out to any
number of live SSE subscribers. Emit and subscribe both run on the event loop thread with no
await between the snapshot and the registration, so a subscriber can neither miss nor
duplicate an event.
"""
import asyncio
import time
from collections.abc import AsyncIterator
from typing import Any, Literal

from pydantic import BaseModel, Field

EventType = Literal["run_started", "plan", "step_started", "step_finished", "step_failed",
                    "run_finished"]


class RunEvent(BaseModel):
    seq: int
    ts: float
    type: EventType
    step: str = ""
    detail: str = ""
    latency_ms: float = 0.0
    tokens: int = 0  # cumulative for the run
    cost_usd: float = 0.0
    data: dict[str, Any] = Field(default_factory=dict)


class EventSink:
    def __init__(self) -> None:
        self.events: list[RunEvent] = []
        self._subscribers: list[asyncio.Queue[RunEvent | None]] = []
        self.closed = False

    def emit(self, type: EventType, **fields: Any) -> RunEvent:
        event = RunEvent(seq=len(self.events), ts=time.time(), type=type, **fields)
        self.events.append(event)
        for q in self._subscribers:
            q.put_nowait(event)
        return event

    def close(self) -> None:
        self.closed = True
        for q in self._subscribers:
            q.put_nowait(None)

    async def stream(self, heartbeat: float | None = None) -> AsyncIterator[RunEvent | None]:
        """Replay everything so far, then follow live until the run closes.

        With `heartbeat` set, yields None whenever that many seconds pass without an event,
        so an SSE endpoint can send keep-alive comments (and notice client disconnects).
        """
        backlog = list(self.events)
        queue: asyncio.Queue[RunEvent | None] = asyncio.Queue()
        if not self.closed:
            self._subscribers.append(queue)
        try:
            for event in backlog:
                yield event
            while not self.closed or not queue.empty():
                try:
                    item = await asyncio.wait_for(queue.get(), heartbeat)
                except TimeoutError:
                    yield None
                    continue
                if item is None:
                    return
                yield item
        finally:
            if queue in self._subscribers:
                self._subscribers.remove(queue)
