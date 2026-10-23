"""Alert storage: per-user settings, alerts (deduplicated), cached decisions, embeddings, run log.

Deduplication is a database guarantee, not a convention: `UNIQUE(user_id, job_id)` on `alerts` means a
job can never alert the same user twice, however often the job runs or two runs overlap.
`alert_checked` remembers jobs that were already judged (matched or not) so the LLM is never asked
twice. `why` and the snapshot are encrypted at rest (they reveal what the user is looking for).
"""
import hashlib
import hmac
import json
import secrets
import sqlite3
from datetime import UTC, datetime, timedelta

from nextrole.security.crypto import protect, reveal

FREQUENCIES = ("instant", "daily", "weekly", "off")


def _now() -> str:
    return datetime.now(UTC).isoformat()


# ---- settings ----
def get_settings_row(conn: sqlite3.Connection, user_id: int) -> dict:
    """The user's alert settings, created with safe defaults on first use (email is opt-in)."""
    row = conn.execute("SELECT * FROM alert_settings WHERE user_id = ?", (user_id,)).fetchone()
    if row is None:
        conn.execute("INSERT INTO alert_settings (user_id, unsubscribe_secret, created_at) VALUES (?, ?, ?)",
                     (user_id, secrets.token_urlsafe(24), _now()))
        conn.commit()
        row = conn.execute("SELECT * FROM alert_settings WHERE user_id = ?", (user_id,)).fetchone()
    return dict(row)


def update_settings(conn: sqlite3.Connection, user_id: int, *, in_app: bool, email: bool, frequency: str) -> dict:
    get_settings_row(conn, user_id)
    conn.execute("UPDATE alert_settings SET in_app = ?, email = ?, frequency = ? WHERE user_id = ?",
                 (int(in_app), int(email), frequency, user_id))
    conn.commit()
    return get_settings_row(conn, user_id)


def unsubscribe_token(user_id: int, secret: str) -> str:
    mac = hmac.new(secret.encode(), b"nextrole-unsubscribe", hashlib.sha256).hexdigest()[:32]
    return f"{user_id}.{mac}"


def user_for_unsubscribe_token(conn: sqlite3.Connection, token: str) -> int | None:
    """Constant-time check; an unknown or tampered token reveals nothing."""
    uid_text, _, mac = token.partition(".")
    if not uid_text.isdigit() or not mac:
        return None
    row = conn.execute("SELECT unsubscribe_secret FROM alert_settings WHERE user_id = ?", (int(uid_text),)).fetchone()
    if row is None:
        return None
    return int(uid_text) if hmac.compare_digest(unsubscribe_token(int(uid_text), row["unsubscribe_secret"]), token) else None


def disable_email(conn: sqlite3.Connection, user_id: int) -> None:
    conn.execute("UPDATE alert_settings SET email = 0 WHERE user_id = ?", (user_id,))
    conn.commit()


def mark_emailed(conn: sqlite3.Connection, user_id: int, alert_ids: list[int], at: str | None = None) -> None:
    now = at or _now()
    conn.executemany("UPDATE alerts SET emailed_at = ? WHERE id = ? AND user_id = ?", [(now, i, user_id) for i in alert_ids])
    conn.execute("UPDATE alert_settings SET last_email_at = ? WHERE user_id = ?", (now, user_id))
    conn.commit()


# ---- alerts ----
def _open(row: sqlite3.Row) -> dict:
    uid = row["user_id"]
    out = {k: row[k] for k in ("id", "job_id", "company_key", "score", "confidence", "method", "created_at", "read_at", "emailed_at")}
    out["why"] = reveal(row["why"], "alerts", "why", uid)
    out["role"] = reveal(row["role_text"], "alerts", "role_text", uid)
    out.update(json.loads(reveal(row["snapshot_json"], "alerts", "snapshot_json", uid)))
    out["read"] = row["read_at"] is not None
    return out


def create_alert(
    conn: sqlite3.Connection, user_id: int, *, job_id: str, company_key: str, role: str, score: float,
    confidence: float, method: str, why: str, snapshot: dict, created_at: str | None = None,
) -> dict | None:
    """Insert once per (user, job). Returns None if it already existed (the dedup guarantee)."""
    try:
        cur = conn.execute(
            """INSERT INTO alerts (user_id, job_id, company_key, role_text, score, confidence, method, why,
                                   snapshot_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (user_id, job_id, company_key, protect(role, "alerts", "role_text", user_id), score, confidence, method,
             protect(why, "alerts", "why", user_id), protect(json.dumps(snapshot), "alerts", "snapshot_json", user_id), created_at or _now()))
    except sqlite3.IntegrityError:
        return None
    conn.commit()
    return get_alert(conn, user_id, cur.lastrowid)


def get_alert(conn: sqlite3.Connection, user_id: int, alert_id: int) -> dict | None:
    row = conn.execute("SELECT * FROM alerts WHERE id = ? AND user_id = ?", (alert_id, user_id)).fetchone()
    return _open(row) if row else None


def list_alerts(conn: sqlite3.Connection, user_id: int, *, unread_only: bool = False, limit: int = 100) -> list[dict]:
    sql = "SELECT * FROM alerts WHERE user_id = ?" + (" AND read_at IS NULL" if unread_only else "")
    rows = conn.execute(sql + " ORDER BY created_at DESC, id DESC LIMIT ?", (user_id, limit)).fetchall()
    return [_open(r) for r in rows]


def unread_count(conn: sqlite3.Connection, user_id: int) -> int:
    return conn.execute("SELECT COUNT(*) FROM alerts WHERE user_id = ? AND read_at IS NULL", (user_id,)).fetchone()[0]


def mark_read(conn: sqlite3.Connection, user_id: int, alert_id: int | None = None) -> int:
    sql, args = "UPDATE alerts SET read_at = ? WHERE user_id = ? AND read_at IS NULL", [_now(), user_id]
    if alert_id is not None:
        sql, args = sql + " AND id = ?", [*args, alert_id]
    cur = conn.execute(sql, args)
    conn.commit()
    return cur.rowcount


def delete_alert(conn: sqlite3.Connection, user_id: int, alert_id: int) -> bool:
    """Dismiss. The row is the dedup record, so first remember the job as judged: a dismissed alert
    must never come back on the next run."""
    row = conn.execute("SELECT job_id FROM alerts WHERE id = ? AND user_id = ?", (alert_id, user_id)).fetchone()
    if row is None:
        return False
    conn.execute("INSERT OR IGNORE INTO alert_checked (user_id, job_id, checked_at) VALUES (?, ?, ?)", (user_id, row["job_id"], _now()))
    conn.execute("DELETE FROM alerts WHERE id = ? AND user_id = ?", (alert_id, user_id))
    conn.commit()
    return True


def alerts_in_last_day(conn: sqlite3.Connection, user_id: int, now: datetime | None = None) -> int:
    since = ((now or datetime.now(UTC)) - timedelta(hours=24)).isoformat()
    return conn.execute("SELECT COUNT(*) FROM alerts WHERE user_id = ? AND created_at >= ?", (user_id, since)).fetchone()[0]


def unsent_email_alerts(conn: sqlite3.Connection, user_id: int) -> list[dict]:
    rows = conn.execute("SELECT * FROM alerts WHERE user_id = ? AND emailed_at IS NULL ORDER BY created_at, id",
                        (user_id,)).fetchall()
    return [_open(r) for r in rows]


# ---- decisions already made ----
def checked_job_ids(conn: sqlite3.Connection, user_id: int) -> set[str]:
    """Jobs that already have an alert OR were judged and rejected: never evaluate them again."""
    done = {r[0] for r in conn.execute("SELECT job_id FROM alerts WHERE user_id = ?", (user_id,))}
    return done | {r[0] for r in conn.execute("SELECT job_id FROM alert_checked WHERE user_id = ?", (user_id,))}


def remember_rejected(conn: sqlite3.Connection, user_id: int, job_ids: list[str]) -> None:
    conn.executemany("INSERT OR IGNORE INTO alert_checked (user_id, job_id, checked_at) VALUES (?, ?, ?)",
                     [(user_id, j, _now()) for j in job_ids])
    conn.commit()


# ---- embeddings cache and run log ----
def cached_embeddings(conn: sqlite3.Connection, job_ids: list[str], model: str) -> dict[str, bytes]:
    out: dict[str, bytes] = {}
    for i in range(0, len(job_ids), 500):
        chunk = job_ids[i:i + 500]
        marks = ",".join("?" * len(chunk))
        for r in conn.execute(f"SELECT job_id, vec FROM job_embeddings WHERE model = ? AND job_id IN ({marks})", [model, *chunk]):
            out[r["job_id"]] = r["vec"]
    return out


def store_embeddings(conn: sqlite3.Connection, items: dict[str, bytes], model: str) -> None:
    conn.executemany("INSERT OR REPLACE INTO job_embeddings (job_id, model, vec, created_at) VALUES (?, ?, ?, ?)",
                     [(j, model, v, _now()) for j, v in items.items()])
    conn.commit()


def record_run(conn: sqlite3.Connection, started: str, stats: dict) -> None:
    """Aggregate numbers only (no user ids): the admin dashboard reads these."""
    conn.execute(
        """INSERT INTO alert_runs (started_at, finished_at, users, boards, jobs_fetched, candidates, verified,
                                   alerts_created, emails_sent, errors) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (started, _now(), *(stats[k] for k in ("users", "boards", "jobs_fetched", "candidates", "verified",
                                               "alerts_created", "emails_sent", "errors"))))
    conn.commit()
