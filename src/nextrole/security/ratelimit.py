"""Sliding-window rate limiter (in memory).

Why in-house: a few dozen lines, no dependency, and exactly the semantics we need (N events per
window per key, with a Retry-After). Limitation, stated plainly: state lives in this process, so
with several workers each has its own counters and a restart forgets them. For a multi-process
deployment swap `RateLimiter` for a Redis-backed class with the same `check` signature. Login
lockout is ALSO stored in the database (users.locked_until), so that part survives restarts.
"""
import threading
import time
from collections import deque
from collections.abc import Callable

MAX_KEYS = 50_000  # bound memory if someone sprays unique keys


class RateLimiter:
    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self._clock = clock
        self._hits: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def check(self, key: str, limit: int, window_s: float) -> tuple[bool, float]:
        """Record one attempt. Returns (allowed, retry_after_seconds)."""
        now = self._clock()
        with self._lock:
            if len(self._hits) > MAX_KEYS:
                self._prune(now)
            q = self._hits.setdefault(key, deque())
            while q and q[0] <= now - window_s:
                q.popleft()
            if len(q) >= limit:
                return False, max(0.0, q[0] + window_s - now)
            q.append(now)
            return True, 0.0

    def reset(self, key: str) -> None:
        with self._lock:
            self._hits.pop(key, None)

    def _prune(self, now: float, horizon_s: float = 3600) -> None:
        for k in [k for k, q in self._hits.items() if not q or q[-1] <= now - horizon_s]:
            del self._hits[k]
