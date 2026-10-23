"""Saved jobs and watched companies.

A saved job keeps a SNAPSHOT of the posting (title, company, link, summary) taken from our own stored
source data at save time, so the entry survives the posting expiring or leaving the user's matches.
`listed` says whether the employer still lists it; it is flipped by `update_listing` after each
discovery pass. Notes and the snapshot are encrypted at rest (user-written / personal); the columns
the UI filters on (status, tier, dates, listed) stay plain.
"""
import json
import sqlite3
from datetime import UTC, datetime

from nextrole.models.company import normalize_company
from nextrole.models.job import Job
from nextrole.security.crypto import protect, reveal
from nextrole.security.text import plain_text

STATUSES = ("saved", "applied", "interview", "offer", "rejected")
MAX_NOTES = 2000
MAX_SAVED = 500
MAX_COMPANIES = 50
SUMMARY_CHARS = 500


def _now() -> str:
    return datetime.now(UTC).isoformat()


def summarize(description: str) -> str:
    """First ~500 characters of the posting as plain text, cut at a word boundary."""
    text = " ".join(plain_text(description, 5000).split())
    if len(text) <= SUMMARY_CHARS:
        return text
    return text[:SUMMARY_CHARS].rsplit(" ", 1)[0] + "..."


def snapshot_of(job: Job) -> dict:
    """Built ONLY from the stored job record, never from client input (links come from source data)."""
    return {"title": job.title, "company": job.company, "location": job.location, "remote": job.remote,
            "apply_url": job.apply_url, "summary": summarize(job.description), "source": job.source}


def _open(row: sqlite3.Row) -> dict:
    uid = row["user_id"]
    out = {k: row[k] for k in ("id", "job_id", "tier", "status", "saved_at", "status_updated_at", "delisted_at")}
    out["listed"] = bool(row["listed"])
    out["notes"] = reveal(row["notes"], "saved_jobs", "notes", uid)
    out.update(json.loads(reveal(row["snapshot_json"], "saved_jobs", "snapshot_json", uid)))
    return out


def count_saved(conn: sqlite3.Connection, user_id: int) -> int:
    return conn.execute("SELECT COUNT(*) FROM saved_jobs WHERE user_id = ?", (user_id,)).fetchone()[0]


def save_job(conn: sqlite3.Connection, user_id: int, job: Job, tier: str, status: str = "saved") -> tuple[dict, bool]:
    """Idempotent: saving a job twice returns the existing entry. Returns (entry, created)."""
    row = conn.execute("SELECT * FROM saved_jobs WHERE user_id = ? AND job_id = ?", (user_id, job.id)).fetchone()
    if row is not None:
        return _open(row), False
    now = _now()
    cur = conn.execute(
        """INSERT INTO saved_jobs (user_id, job_id, source, tier, status, notes, snapshot_json, saved_at,
                                   status_updated_at, last_seen_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (user_id, job.id, job.source, tier, status, protect("", "saved_jobs", "notes", user_id),
         protect(json.dumps(snapshot_of(job)), "saved_jobs", "snapshot_json", user_id), now, now, now))
    conn.commit()
    return get_saved(conn, user_id, cur.lastrowid), True  # type: ignore[return-value]


def get_saved(conn: sqlite3.Connection, user_id: int, saved_id: int) -> dict | None:
    row = conn.execute("SELECT * FROM saved_jobs WHERE id = ? AND user_id = ?", (saved_id, user_id)).fetchone()
    return _open(row) if row else None


def list_saved(
    conn: sqlite3.Connection, user_id: int, *, status: str | None = None, tier: str | None = None,
    listed: bool | None = None, q: str = "", sort: str = "saved_desc",
) -> list[dict]:
    sql, args = "SELECT * FROM saved_jobs WHERE user_id = ?", [user_id]
    if status:
        sql, args = sql + " AND status = ?", [*args, status]
    if tier:
        sql, args = sql + " AND tier = ?", [*args, tier]
    if listed is not None:
        sql, args = sql + " AND listed = ?", [*args, int(listed)]
    rows = [_open(r) for r in conn.execute(sql + " ORDER BY saved_at DESC, id DESC", args)]
    needle = q.strip().lower()
    if needle:  # title/company/notes are encrypted or free text: search after decrypting
        rows = [r for r in rows if needle in f"{r['title']} {r['company']} {r['notes']} {r['location']}".lower()]
    if sort == "saved_asc":
        rows.reverse()
    elif sort == "company":
        rows.sort(key=lambda r: (r["company"].lower(), r["title"].lower()))
    elif sort == "status":
        rows.sort(key=lambda r: STATUSES.index(r["status"]))
    return rows


def update_saved(
    conn: sqlite3.Connection, user_id: int, saved_id: int, *, status: str | None = None, notes: str | None = None,
) -> dict | None:
    row = conn.execute("SELECT * FROM saved_jobs WHERE id = ? AND user_id = ?", (saved_id, user_id)).fetchone()
    if row is None:
        return None
    if status is not None and status != row["status"]:
        conn.execute("UPDATE saved_jobs SET status = ?, status_updated_at = ? WHERE id = ? AND user_id = ?",
                     (status, _now(), saved_id, user_id))
    if notes is not None:
        conn.execute("UPDATE saved_jobs SET notes = ? WHERE id = ? AND user_id = ?",
                     (protect(plain_text(notes, MAX_NOTES), "saved_jobs", "notes", user_id), saved_id, user_id))
    conn.commit()
    return get_saved(conn, user_id, saved_id)


def delete_saved(conn: sqlite3.Connection, user_id: int, saved_id: int) -> bool:
    cur = conn.execute("DELETE FROM saved_jobs WHERE id = ? AND user_id = ?", (saved_id, user_id))
    conn.commit()
    return cur.rowcount > 0


def update_listing(
    conn: sqlite3.Connection, seen_ids: set[str], sources_checked: set[str], failed_sources: set[str],
) -> int:
    """Flip `listed` after a discovery pass. A job is only declared gone when its source answered with
    no errors at all and its id is absent; a source that failed leaves everything as it was. Pasted
    jobs have no board to check and are never touched. Returns how many rows changed."""
    reliable = sources_checked - failed_sources
    if not reliable:
        return 0
    now, changed = _now(), 0
    for row in conn.execute("SELECT id, job_id, source, listed FROM saved_jobs").fetchall():
        if row["source"] not in reliable:
            continue
        present = row["job_id"] in seen_ids
        if row["listed"] and not present:
            conn.execute("UPDATE saved_jobs SET listed = 0, delisted_at = ? WHERE id = ?", (now, row["id"]))
            changed += 1
        elif not row["listed"] and present:
            conn.execute("UPDATE saved_jobs SET listed = 1, delisted_at = NULL, last_seen_at = ? WHERE id = ?",
                         (now, row["id"]))
            changed += 1
        elif present:
            conn.execute("UPDATE saved_jobs SET last_seen_at = ? WHERE id = ?", (now, row["id"]))
    conn.commit()
    return changed


# ---- watched companies ----
def list_companies(conn: sqlite3.Connection, user_id: int) -> list[dict]:
    return [dict(r) for r in conn.execute(
        "SELECT id, company_key, display_name, created_at FROM user_companies WHERE user_id = ? ORDER BY display_name COLLATE NOCASE",
        (user_id,))]


def add_company(conn: sqlite3.Connection, user_id: int, name: str) -> tuple[dict | None, str]:
    """Returns (entry, error). `error` is a user-safe reason when nothing was added."""
    name = " ".join(plain_text(name, 80).split())
    key = normalize_company(name)
    if not name or not key:
        return None, "Enter a company name."
    existing = conn.execute("SELECT id, company_key, display_name, created_at FROM user_companies "
                            "WHERE user_id = ? AND company_key = ?", (user_id, key)).fetchone()
    if existing:
        return dict(existing), ""
    n = conn.execute("SELECT COUNT(*) FROM user_companies WHERE user_id = ?", (user_id,)).fetchone()[0]
    if n >= MAX_COMPANIES:
        return None, f"You can watch up to {MAX_COMPANIES} companies."
    cur = conn.execute("INSERT INTO user_companies (user_id, company_key, display_name, created_at) VALUES (?, ?, ?, ?)",
                       (user_id, key, name, _now()))
    conn.commit()
    return dict(conn.execute("SELECT id, company_key, display_name, created_at FROM user_companies WHERE id = ?",
                             (cur.lastrowid,)).fetchone()), ""


def delete_company(conn: sqlite3.Connection, user_id: int, company_id: int) -> bool:
    cur = conn.execute("DELETE FROM user_companies WHERE id = ? AND user_id = ?", (company_id, user_id))
    conn.commit()
    return cur.rowcount > 0
