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
    """A refresh replaces the user's previous recommendations atomically."""
    with conn:
        conn.execute("DELETE FROM matches WHERE user_id = ?", (user_id,))
        conn.executemany(
            "INSERT INTO matches (user_id, job_id, score, match_json) VALUES (?, ?, ?, ?)",
            [(user_id, m.job_id, m.score, m.model_dump_json()) for m in matches],
        )


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
