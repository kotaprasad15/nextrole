"""Usage metrics for the admin dashboard: TOTAL aggregates only, never per user.

Design rule: nothing stored here can identify a person. `usage_events` has no user id (just the model,
the pipeline stage, tokens, cost, outcome and latency of each model call), HTTP counters are per day and
status class, and the report is built from sums. There is deliberately no function that groups by user,
and a test asserts no user field appears in the payload. Per-run budgets (`llm/budget.py`) are enforced
independently inside each run and do not depend on this module.
"""
import contextlib
import sqlite3
import threading
from collections.abc import Callable
from datetime import UTC, datetime, timedelta

_write_lock = threading.Lock()


def _now() -> datetime:
    return datetime.now(UTC)


def make_usage_sink(conn: sqlite3.Connection) -> Callable[[dict], None]:
    """A callable `LLMClient` uses to record each model call. It must never break the call itself."""

    def sink(event: dict) -> None:
        with contextlib.suppress(Exception), _write_lock:  # best effort: metrics must never break a model call
            conn.execute(
                """INSERT INTO usage_events (ts, model, agent, input_tokens, output_tokens, cost_usd, status, latency_ms)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (_now().isoformat(), event["model"], event["agent"], event["input_tokens"], event["output_tokens"],
                 event["cost_usd"], event["status"], event["latency_ms"]))
            conn.commit()

    return sink


class HttpCounters:
    """Per-day request counts by status class, kept in memory and flushed to `http_daily`."""

    def __init__(self) -> None:
        self._pending: dict[tuple[str, str], int] = {}
        self._lock = threading.Lock()

    @staticmethod
    def _klass(status: int) -> str:
        return "server_error" if status >= 500 else "client_error" if status >= 400 else "ok"

    def hit(self, status: int, now: datetime | None = None) -> None:
        key = ((now or _now()).strftime("%Y-%m-%d"), self._klass(status))
        with self._lock:
            self._pending[key] = self._pending.get(key, 0) + 1

    def flush(self, conn: sqlite3.Connection) -> None:
        with self._lock:
            pending, self._pending = self._pending, {}
        if not pending:
            return
        with _write_lock:
            for (day, klass), n in pending.items():
                conn.execute(
                    """INSERT INTO http_daily (day, status_class, count) VALUES (?, ?, ?)
                       ON CONFLICT(day, status_class) DO UPDATE SET count = count + excluded.count""", (day, klass, n))
            conn.commit()


class MetricsMiddleware:
    """Pure ASGI (no response buffering, so SSE is unaffected): counts each HTTP response by status class."""

    def __init__(self, app, counters: HttpCounters) -> None:
        self.app, self.counters = app, counters

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        started = False

        async def wrapped(message: dict) -> None:
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
                self.counters.hit(message["status"])
            await send(message)

        try:
            await self.app(scope, receive, wrapped)
        except Exception:
            if not started:  # an unhandled error: the server's outer handler will answer 500, which we count here
                self.counters.hit(500)
            raise


def _rate(part: int, whole: int) -> float:
    return round(part / whole, 4) if whole else 0.0


def _totals(conn: sqlite3.Connection, since: str, until: str) -> dict:
    r = conn.execute(
        """SELECT COUNT(*) AS n, COALESCE(SUM(status = 'error'), 0) AS errors, COALESCE(SUM(input_tokens), 0) AS tin,
                  COALESCE(SUM(output_tokens), 0) AS tout, COALESCE(SUM(cost_usd), 0) AS cost,
                  COALESCE(AVG(NULLIF(latency_ms, 0)), 0) AS latency
           FROM usage_events WHERE ts >= ? AND ts < ?""", (since, until)).fetchone()
    return {"llm_requests": r["n"], "llm_errors": r["errors"], "error_rate": _rate(r["errors"], r["n"]),
            "tokens_in": r["tin"], "tokens_out": r["tout"], "tokens": r["tin"] + r["tout"],
            "cost_usd": round(r["cost"], 6), "avg_latency_ms": round(r["latency"], 1)}


def build_metrics(conn: sqlite3.Connection, days: int = 30, now: datetime | None = None) -> dict:
    now = now or _now()
    days = max(1, min(days, 365))
    start_day = (now - timedelta(days=days - 1)).strftime("%Y-%m-%d")
    since, until = f"{start_day}T00:00:00", (now + timedelta(days=1)).strftime("%Y-%m-%dT00:00:00")
    prev_since = (now - timedelta(days=2 * days - 1)).strftime("%Y-%m-%dT00:00:00")

    totals = _totals(conn, since, until)
    previous = _totals(conn, prev_since, since)

    def group(column: str) -> list[dict]:
        rows = conn.execute(
            f"""SELECT {column} AS k, COUNT(*) AS n, SUM(status = 'error') AS errors, SUM(input_tokens + output_tokens) AS tokens,
                       SUM(cost_usd) AS cost FROM usage_events WHERE ts >= ? AND ts < ? GROUP BY {column}
                ORDER BY cost DESC, n DESC""", (since, until)).fetchall()
        return [{"name": r["k"], "requests": r["n"], "errors": r["errors"] or 0, "error_rate": _rate(r["errors"] or 0, r["n"]),
                 "tokens": r["tokens"] or 0, "cost_usd": round(r["cost"] or 0, 6)} for r in rows]

    by_day = {r["d"]: r for r in conn.execute(
        """SELECT substr(ts, 1, 10) AS d, COUNT(*) AS n, SUM(status = 'error') AS errors, SUM(input_tokens + output_tokens) AS tokens,
                  SUM(cost_usd) AS cost FROM usage_events WHERE ts >= ? AND ts < ? GROUP BY d""", (since, until))}
    series = []
    for i in range(days):
        day = (now - timedelta(days=days - 1 - i)).strftime("%Y-%m-%d")
        r = by_day.get(day)
        series.append({"day": day, "requests": r["n"] if r else 0, "errors": (r["errors"] or 0) if r else 0,
                       "tokens": (r["tokens"] or 0) if r else 0, "cost_usd": round(r["cost"] or 0, 6) if r else 0.0})

    runs = conn.execute(
        """SELECT mode, COUNT(*) AS n, COALESCE(SUM(status = 'failed'), 0) AS failed,
                  COALESCE(SUM(status = 'completed'), 0) AS completed FROM runs WHERE started_at >= ? GROUP BY mode""", (since.replace("T", " "),)).fetchall()
    run_total = sum(r["n"] for r in runs)
    run_failed = sum(r["failed"] for r in runs)

    http_rows = conn.execute("SELECT day, status_class, count FROM http_daily WHERE day >= ?", (start_day,)).fetchall()
    http_total = sum(r["count"] for r in http_rows)
    http_5xx = sum(r["count"] for r in http_rows if r["status_class"] == "server_error")
    http_4xx = sum(r["count"] for r in http_rows if r["status_class"] == "client_error")
    http_by_day: dict[str, int] = {}
    for r in http_rows:
        http_by_day[r["day"]] = http_by_day.get(r["day"], 0) + r["count"]

    alerts = conn.execute(
        """SELECT COUNT(*) AS passes, COALESCE(SUM(alerts_created), 0) AS created, COALESCE(SUM(emails_sent), 0) AS emails,
                  COALESCE(SUM(errors), 0) AS errors FROM alert_runs WHERE started_at >= ?""", (since,)).fetchone()
    interviews = {r["status"]: r["n"] for r in conn.execute("SELECT status, COUNT(*) AS n FROM interview_experiences GROUP BY status")}

    return {
        "range": {"days": days, "from": start_day, "to": now.strftime("%Y-%m-%d")},
        "totals": totals,
        "previous": previous,  # the same-length period before, for trend arrows
        "by_model": group("model"),
        "by_stage": group("agent"),  # pipeline stage (intake, matcher, writer...), not a person
        "series": series,
        "runs": {"total": run_total, "failed": run_failed, "error_rate": _rate(run_failed, run_total),
                 "by_mode": [{"mode": r["mode"], "total": r["n"], "failed": r["failed"], "completed": r["completed"]} for r in runs]},
        "http": {"requests": http_total, "client_errors": http_4xx, "server_errors": http_5xx, "error_rate": _rate(http_5xx, http_total),
                 "series": [{"day": s["day"], "requests": http_by_day.get(s["day"], 0)} for s in series]},
        "alerts": {"passes": alerts["passes"], "alerts_created": alerts["created"], "emails_sent": alerts["emails"], "errors": alerts["errors"]},
        "interviews": {"pending": interviews.get("pending", 0), "approved": interviews.get("approved", 0),
                       "rejected": interviews.get("rejected", 0), "removed": interviews.get("removed", 0),
                       "open_reports": conn.execute("SELECT COUNT(*) FROM interview_reports WHERE status = 'open'").fetchone()[0]},
        "accounts": {"total": conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]},
    }
