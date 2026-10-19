"""Small SQLite-backed TTL cache plus a per-host rate limiter for external calls.

Design decision: caching stops us re-hitting Wikipedia/HN for the same company on every draft
(faster, cheaper, polite), and the limiter spaces calls per host so a burst of drafts can't
hammer a free public API.
"""
import asyncio
import sqlite3
import time
from datetime import UTC, datetime, timedelta


class HttpCache:
    def __init__(self, conn: sqlite3.Connection) -> None:
        self.conn = conn

    def get(self, key: str) -> str | None:
        row = self.conn.execute(
            "SELECT body, expires_at FROM http_cache WHERE key = ?", (key,)
        ).fetchone()
        if row and row["expires_at"] > datetime.now(UTC).isoformat():
            return row["body"]
        return None

    def set(self, key: str, body: str, ttl_hours: float) -> None:
        expires = (datetime.now(UTC) + timedelta(hours=ttl_hours)).isoformat()
        self.conn.execute(
            """INSERT INTO http_cache (key, body, expires_at) VALUES (?, ?, ?)
               ON CONFLICT(key) DO UPDATE SET body = excluded.body,
                                              expires_at = excluded.expires_at""",
            (key, body, expires),
        )
        self.conn.commit()


class HostRateLimiter:
    """Enforces a minimum interval between requests to the same host."""

    def __init__(self, min_interval_s: float = 0.3) -> None:
        self.min_interval = min_interval_s
        self._last: dict[str, float] = {}
        self._lock = asyncio.Lock()

    async def wait(self, host: str) -> None:
        async with self._lock:
            delay = self._last.get(host, 0.0) + self.min_interval - time.monotonic()
            if delay > 0:
                await asyncio.sleep(delay)
            self._last[host] = time.monotonic()
