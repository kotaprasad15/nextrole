"""Repository functions for users, sessions and profiles."""
import json
import sqlite3
from datetime import UTC, datetime

from nextrole.models.company import CompanyTier, normalize_company
from nextrole.models.job import Job
from nextrole.models.match import MatchResult
from nextrole.models.outreach import CriticReport, OutreachDraft
from nextrole.models.profile import Profile
from nextrole.models.research import Fact


def _now() -> str:
    return datetime.now(UTC).isoformat()


def create_user(conn: sqlite3.Connection, email: str, pw_hash: str) -> int:
    cur = conn.execute("INSERT INTO users (email, pw_hash) VALUES (?, ?)", (email, pw_hash))
    conn.commit()
    return int(cur.lastrowid)


def get_user_by_email(conn: sqlite3.Connection, email: str) -> sqlite3.Row | None:
    return conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()


def create_session(conn: sqlite3.Connection, token_hash: str, user_id: int, expires: str) -> None:
    conn.execute(
        "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
        (token_hash, user_id, expires),
    )
    conn.commit()


def get_session_user_id(conn: sqlite3.Connection, token_hash: str) -> int | None:
    row = conn.execute(
        "SELECT user_id, expires_at FROM sessions WHERE token_hash = ?", (token_hash,)
    ).fetchone()
    if row is None:
        return None
    if row["expires_at"] <= _now():
        delete_session(conn, token_hash)
        return None
    return int(row["user_id"])


def delete_session(conn: sqlite3.Connection, token_hash: str) -> None:
    conn.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash,))
    conn.commit()


def save_profile(
    conn: sqlite3.Connection, user_id: int, profile: Profile, resume_path: str | None = None
) -> None:
    """Upsert the profile; keep the existing resume path unless a new one is given."""
    conn.execute(
        """INSERT INTO profiles (user_id, profile_json, resume_path, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(user_id) DO UPDATE SET
             profile_json = excluded.profile_json,
             resume_path = COALESCE(excluded.resume_path, profiles.resume_path),
             updated_at = excluded.updated_at""",
        (user_id, profile.model_dump_json(), resume_path, _now()),
    )
    conn.commit()


def get_profile(conn: sqlite3.Connection, user_id: int) -> Profile | None:
    row = conn.execute(
        "SELECT profile_json FROM profiles WHERE user_id = ?", (user_id,)
    ).fetchone()
    return Profile.model_validate_json(row["profile_json"]) if row else None


def get_resume_path(conn: sqlite3.Connection, user_id: int) -> str | None:
    row = conn.execute("SELECT resume_path FROM profiles WHERE user_id = ?", (user_id,)).fetchone()
    return row["resume_path"] if row else None


def delete_user(conn: sqlite3.Connection, user_id: int) -> None:
    """Cascades to sessions and profiles. The caller must delete the resume file itself."""
    conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
    conn.commit()


# ---- jobs / tiers / matches (milestone d) ----

def save_jobs(conn: sqlite3.Connection, jobs: list[Job]) -> None:
    conn.executemany(
        """INSERT INTO jobs (id, company_key, job_json) VALUES (?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET job_json = excluded.job_json,
                                         fetched_at = datetime('now')""",
        [(j.id, normalize_company(j.company), j.model_dump_json()) for j in jobs],
    )
    conn.commit()


def get_cached_tiers(conn: sqlite3.Connection, keys: list[str]) -> dict[str, CompanyTier]:
    if not keys:
        return {}
    marks = ",".join("?" * len(keys))
    rows = conn.execute(
        f"SELECT company_key, tier, method, confidence FROM company_tiers "
        f"WHERE company_key IN ({marks})", keys,
    ).fetchall()
    return {r["company_key"]: CompanyTier(**dict(r)) for r in rows}


def save_tiers(conn: sqlite3.Connection, tiers: list[CompanyTier]) -> None:
    conn.executemany(
        """INSERT INTO company_tiers (company_key, tier, method, confidence) VALUES (?, ?, ?, ?)
           ON CONFLICT(company_key) DO UPDATE SET tier = excluded.tier, method = excluded.method,
             confidence = excluded.confidence, updated_at = datetime('now')""",
        [(t.company_key, t.tier, t.method, t.confidence) for t in tiers],
    )
    conn.commit()


def replace_matches(conn: sqlite3.Connection, user_id: int, matches: list[MatchResult]) -> None:
    """A refresh replaces the user's recommendations atomically, but never touches pinned
    (user-pasted) jobs; OR IGNORE keeps a pinned row if a refresh also re-discovers it."""
    with conn:
        conn.execute("DELETE FROM matches WHERE user_id = ? AND pinned = 0", (user_id,))
        conn.executemany(
            "INSERT OR IGNORE INTO matches (user_id, job_id, score, match_json) VALUES (?, ?, ?, ?)",
            [(user_id, m.job_id, m.score, m.model_dump_json()) for m in matches],
        )


def add_pinned_match(conn: sqlite3.Connection, user_id: int, match: MatchResult) -> None:
    """Store a user-pasted job's match so it appears on the dashboard and can be drafted for."""
    conn.execute(
        """INSERT INTO matches (user_id, job_id, score, match_json, pinned) VALUES (?, ?, ?, ?, 1)
           ON CONFLICT(user_id, job_id) DO UPDATE SET score = excluded.score,
             match_json = excluded.match_json, pinned = 1""",
        (user_id, match.job_id, match.score, match.model_dump_json()),
    )
    conn.commit()


def list_featured_jobs(conn: sqlite3.Connection, limit: int = 3) -> list[tuple[Job, str | None]]:
    """Real postings for the PUBLIC homepage: recent, connector-sourced, one per company.

    Privacy: only the shared `jobs` cache is read (never `matches`, so no user id or score), and
    user-pasted jobs are excluded. Tier comes from the shared tier cache when known, else None.
    Picks different tiers first so the sample is varied.
    """
    rows = conn.execute(
        """SELECT j.company_key, j.job_json, t.tier
           FROM jobs j LEFT JOIN company_tiers t ON t.company_key = j.company_key
           ORDER BY j.fetched_at DESC, j.rowid DESC LIMIT 300"""
    ).fetchall()
    seen: set[str] = set()
    candidates: list[tuple[Job, str | None]] = []
    for r in rows:
        if r["company_key"] in seen:
            continue
        job = Job.model_validate_json(r["job_json"])  # re-runs the https validation on read
        if job.source == "pasted" or job.apply_url is None or not job.is_open:
            continue
        seen.add(r["company_key"])
        candidates.append((job, r["tier"]))
    picked: list[tuple[Job, str | None]] = []
    tiers_used: set[str] = set()
    for c in candidates:  # first pass: one per KNOWN tier, so the sample is varied
        if c[1] is not None and c[1] not in tiers_used and len(picked) < limit:
            tiers_used.add(c[1])
            picked.append(c)
    for c in candidates:  # second pass: fill up (including companies whose tier is not known yet)
        if c not in picked and len(picked) < limit:
            picked.append(c)
    return picked


def list_matches(conn: sqlite3.Connection, user_id: int) -> list[tuple[Job, MatchResult, str]]:
    """(job, match, tier) rows, best score first. Jobs are rebuilt through the Job model, so
    the https validation runs again on read."""
    rows = conn.execute(
        """SELECT j.job_json, m.match_json, COALESCE(t.tier, 'mid') AS tier
           FROM matches m JOIN jobs j ON j.id = m.job_id
           LEFT JOIN company_tiers t ON t.company_key = j.company_key
           WHERE m.user_id = ? ORDER BY m.score DESC""",
        (user_id,),
    ).fetchall()
    return [
        (Job.model_validate_json(r["job_json"]), MatchResult.model_validate_json(r["match_json"]),
         r["tier"])
        for r in rows
    ]


# ---- outreach (milestone e) ----

def get_job_for_user(conn: sqlite3.Connection, user_id: int, job_id: str) -> Job | None:
    """The job, only if it is in this user's recommendations (authorization by ownership)."""
    row = conn.execute(
        """SELECT j.job_json FROM jobs j JOIN matches m ON m.job_id = j.id
           WHERE m.user_id = ? AND j.id = ?""", (user_id, job_id)).fetchone()
    return Job.model_validate_json(row["job_json"]) if row else None


def upsert_outreach(
    conn: sqlite3.Connection, user_id: int, job_id: str, draft: OutreachDraft,
    critic: CriticReport, facts: list[Fact], warnings: list[str], attempts: int,
) -> int:
    """One record per (user, job). Regenerating replaces content and resets approval, but keeps
    the recipient address the user already entered."""
    conn.execute(
        """INSERT INTO outreach (user_id, job_id, status, draft_json, critic_json, facts_json,
                                 warnings_json, attempts)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id, job_id) DO UPDATE SET
             status = excluded.status, draft_json = excluded.draft_json,
             critic_json = excluded.critic_json, facts_json = excluded.facts_json,
             warnings_json = excluded.warnings_json, attempts = excluded.attempts,
             approved_at = NULL, updated_at = datetime('now')""",
        (user_id, job_id, draft.status, draft.model_dump_json(), critic.model_dump_json(),
         json.dumps([f.model_dump() for f in facts]), json.dumps(warnings), attempts),
    )
    conn.commit()
    return int(conn.execute("SELECT id FROM outreach WHERE user_id = ? AND job_id = ?",
                            (user_id, job_id)).fetchone()["id"])


def get_outreach(conn: sqlite3.Connection, user_id: int, outreach_id: int) -> sqlite3.Row | None:
    return conn.execute("SELECT * FROM outreach WHERE id = ? AND user_id = ?",
                        (outreach_id, user_id)).fetchone()


def get_outreach_by_job(conn: sqlite3.Connection, user_id: int, job_id: str) -> sqlite3.Row | None:
    return conn.execute("SELECT * FROM outreach WHERE job_id = ? AND user_id = ?",
                        (job_id, user_id)).fetchone()


def list_outreach_status(conn: sqlite3.Connection, user_id: int) -> list[sqlite3.Row]:
    return conn.execute("SELECT id, job_id, status FROM outreach WHERE user_id = ?",
                        (user_id,)).fetchall()


def edit_outreach(
    conn: sqlite3.Connection, user_id: int, outreach_id: int, subject: str, body: str,
    recipient_email: str,
) -> bool:
    """A user edit invalidates both the critic verdict and any prior approval: status returns
    to 'draft' and the stale critic report is cleared."""
    row = get_outreach(conn, user_id, outreach_id)
    if row is None:
        return False
    draft = OutreachDraft.model_validate_json(row["draft_json"])
    draft.subject, draft.body, draft.status = subject, body, "draft"
    conn.execute(
        """UPDATE outreach SET draft_json = ?, status = 'draft', critic_json = NULL,
           recipient_email = ?, approved_at = NULL, updated_at = datetime('now')
           WHERE id = ? AND user_id = ?""",
        (draft.model_dump_json(), recipient_email, outreach_id, user_id))
    conn.commit()
    return True


def approve_outreach(conn: sqlite3.Connection, user_id: int, outreach_id: int) -> bool:
    """The human approval gate: only this explicit call sets 'user_approved'."""
    row = get_outreach(conn, user_id, outreach_id)
    if row is None:
        return False
    draft = OutreachDraft.model_validate_json(row["draft_json"])
    draft.status = "user_approved"
    conn.execute(
        """UPDATE outreach SET status = 'user_approved', draft_json = ?, approved_at = ?
           WHERE id = ? AND user_id = ?""",
        (draft.model_dump_json(), _now(), outreach_id, user_id))
    conn.commit()
    return True


def delete_outreach(conn: sqlite3.Connection, user_id: int, outreach_id: int) -> bool:
    cur = conn.execute("DELETE FROM outreach WHERE id = ? AND user_id = ?", (outreach_id, user_id))
    conn.commit()
    return cur.rowcount > 0


# ---- runs (milestone f) ----

def create_run(conn: sqlite3.Connection, run_id: str, user_id: int, mode: str) -> None:
    conn.execute("INSERT INTO runs (id, user_id, mode, status) VALUES (?, ?, ?, 'running')",
                 (run_id, user_id, mode))
    conn.commit()


def finish_run(
    conn: sqlite3.Connection, run_id: str, *, status: str, job_id: str | None, tokens: int,
    cost_usd: float, error: str | None, events: list[dict], result: dict,
) -> None:
    conn.execute(
        """UPDATE runs SET status = ?, job_id = ?, tokens = ?, cost_usd = ?, error = ?,
           events_json = ?, result_json = ?, finished_at = ? WHERE id = ?""",
        (status, job_id, tokens, cost_usd, error, json.dumps(events), json.dumps(result),
         _now(), run_id))
    conn.commit()


def get_run(conn: sqlite3.Connection, user_id: int, run_id: str) -> sqlite3.Row | None:
    return conn.execute("SELECT * FROM runs WHERE id = ? AND user_id = ?",
                        (run_id, user_id)).fetchone()


def list_runs(conn: sqlite3.Connection, user_id: int, limit: int = 20) -> list[sqlite3.Row]:
    return conn.execute(
        """SELECT id, mode, status, job_id, tokens, cost_usd, error, started_at, finished_at
           FROM runs WHERE user_id = ? ORDER BY started_at DESC, rowid DESC LIMIT ?""",
        (user_id, limit)).fetchall()


def fail_stale_runs(conn: sqlite3.Connection) -> None:
    """A server restart orphans 'running' rows (their task died); mark them failed on startup."""
    conn.execute("UPDATE runs SET status = 'failed', error = 'server restarted', finished_at = ? "
                 "WHERE status = 'running'", (_now(),))
    conn.commit()


# ---- feedback / memory (milestone f) ----

def save_feedback(
    conn: sqlite3.Connection, user_id: int, outreach_id: int, rating: int, note: str
) -> None:
    conn.execute(
        """INSERT INTO feedback (user_id, outreach_id, rating, note) VALUES (?, ?, ?, ?)
           ON CONFLICT(outreach_id) DO UPDATE SET rating = excluded.rating, note = excluded.note,
             created_at = datetime('now')""",
        (user_id, outreach_id, rating, note))
    conn.commit()


def get_feedback(conn: sqlite3.Connection, user_id: int, outreach_id: int) -> sqlite3.Row | None:
    return conn.execute("SELECT rating, note FROM feedback WHERE outreach_id = ? AND user_id = ?",
                        (outreach_id, user_id)).fetchone()


def recent_feedback(conn: sqlite3.Connection, user_id: int, limit: int) -> list[sqlite3.Row]:
    """Latest feedback that carries a note (ratings alone give the Writer nothing to act on)."""
    return conn.execute(
        """SELECT rating, note FROM feedback WHERE user_id = ? AND note != ''
           ORDER BY created_at DESC, id DESC LIMIT ?""", (user_id, limit)).fetchall()


def approved_drafts(
    conn: sqlite3.Connection, user_id: int, limit: int, exclude_job_id: str | None = None
) -> list[OutreachDraft]:
    """The user's most recent approved drafts, used as tone examples (never as facts)."""
    rows = conn.execute(
        """SELECT draft_json FROM outreach WHERE user_id = ? AND status = 'user_approved'
           AND job_id != ? ORDER BY approved_at DESC, id DESC LIMIT ?""",
        (user_id, exclude_job_id or "", limit)).fetchall()
    return [OutreachDraft.model_validate_json(r["draft_json"]) for r in rows]
