"""In-process scheduler for the alert job (no extra dependency, no separate worker).

A single asyncio task wakes every `alerts_interval_hours`, runs `run_alerts` (guarded by a lock so two
passes can never overlap) and sleeps again. It is started from the FastAPI lifespan when
`ALERTS_ENABLED=true` and cancelled on shutdown. Limits, stated plainly: it only runs while the API
process runs, and with several API workers each would run its own pass (alert dedup keeps results
correct, but fetches are repeated); for that, set `ALERTS_ENABLED=false` and run the job from cron:
`uv run python -m nextrole.alerts_job`.
"""
import asyncio
import logging
from collections.abc import Awaitable, Callable

log = logging.getLogger(__name__)


class AlertScheduler:
    def __init__(self, run_once: Callable[[], Awaitable[dict]], interval_s: float, first_delay_s: float = 120.0) -> None:
        self._run_once, self.interval_s, self.first_delay_s = run_once, interval_s, first_delay_s
        self._task: asyncio.Task | None = None
        self._lock = asyncio.Lock()

    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._loop(), name="alert-scheduler")

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None

    async def run_now(self) -> dict | None:
        """One guarded pass; returns None if one is already running."""
        if self._lock.locked():
            return None
        async with self._lock:
            return await self._run_once()

    async def _loop(self) -> None:
        await asyncio.sleep(self.first_delay_s)
        while True:
            try:
                stats = await self.run_now()
                log.info("alert pass finished: %s", stats)
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("alert pass failed")
            await asyncio.sleep(self.interval_s)
