"""Interview experiences, votes, reports and the moderation log.

Visibility rule, enforced HERE (not in the routes): only `approved` rows are ever returned by the public
queries. Authors can additionally read their own rows in any status. The author is stored (needed to
stop abuse and to let people edit or delete their own posts) but the public shape never contains the
user id; whether the first name is shown is the author's choice (`anonymous`).
"""
import json
import sqlite3
from datetime import UTC, datetime

from nextrole.interviews.schemas import ExperienceIn
from nextrole.models.company import normalize_company
from nextrole.roles.taxonomy import roles_match

AUTO_HIDE_REPORTS = 3  # distinct open reports on a published post send it back to review
MAX_PENDING_PER_USER = 10
PAGE_SIZE = 20


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _author_label(conn: sqlite3.Connection, row: sqlite3.Row) -> str | None:
    """First name only, and only if the author chose not to be anonymous and has a name on their profile."""
    if row["anonymous"]:
        return None
    from nextrole.db import repos  # local import: repos pulls in the whole model layer

    profile = repos.get_profile(conn, row["user_id"])
    first = (profile.name.split() or [""])[0] if profile else ""
    return first or None


def _shape(conn: sqlite3.Connection, row: sqlite3.Row, viewer_id: int | None, *, admin: bool = False) -> dict:
    out = {
        "id": row["id"], "company": row["company"], "role": row["role"], "level": row["level"],
        "interviewed_on": row["interviewed_on"], "rounds": json.loads(row["rounds_json"]), "difficulty": row["difficulty"],
        "outcome": row["outcome"], "tips": row["tips"], "created_at": row["created_at"],
        "author": _author_label(conn, row), "mine": viewer_id is not None and row["user_id"] == viewer_id,
        "upvotes": conn.execute("SELECT COUNT(*) FROM interview_votes WHERE exp_id = ?", (row["id"],)).fetchone()[0],
        "upvoted": bool(viewer_id) and conn.execute(
            "SELECT 1 FROM interview_votes WHERE exp_id = ? AND user_id = ?", (row["id"], viewer_id)).fetchone() is not None,
    }
    if out["mine"] or admin:
        out["status"] = row["status"]
        out["moderator_note"] = row["moderator_note"]
    if admin:
        out["author_id"] = row["user_id"]
        out["auto_check"] = json.loads(row["auto_check_json"])
        out["open_reports"] = conn.execute(
            "SELECT COUNT(*) FROM interview_reports WHERE exp_id = ? AND status = 'open'", (row["id"],)).fetchone()[0]
    return out


def _log(conn: sqlite3.Connection, exp_id: int, actor: str, action: str, note: str = "") -> None:
    conn.execute("INSERT INTO moderation_log (exp_id, actor, action, note, created_at) VALUES (?, ?, ?, ?, ?)",
                 (exp_id, actor, action, note, _now()))


def _search_text(data: ExperienceIn) -> str:
    """What the search box looks at: the words people wrote, not field names or enum values."""
    return data.all_text().lower()


def pending_count(conn: sqlite3.Connection, user_id: int) -> int:
    return conn.execute("SELECT COUNT(*) FROM interview_experiences WHERE user_id = ? AND status = 'pending'", (user_id,)).fetchone()[0]


def create(conn: sqlite3.Connection, user_id: int, data: ExperienceIn, auto_check: dict) -> int:
    cur = conn.execute(
        """INSERT INTO interview_experiences (user_id, anonymous, company, company_key, role, level, interviewed_on,
               rounds_json, search_text, difficulty, outcome, tips, status, auto_check_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)""",
        (user_id, int(data.anonymous), data.company, normalize_company(data.company), data.role, data.level, data.interviewed_on,
         json.dumps([r.model_dump() for r in data.rounds]), _search_text(data), data.difficulty, data.outcome, data.tips, json.dumps(auto_check), _now()))
    _log(conn, cur.lastrowid, "auto", "submitted", f"risk={auto_check.get('risk')}")
    conn.commit()
    return int(cur.lastrowid)


def update_own(conn: sqlite3.Connection, user_id: int, exp_id: int, data: ExperienceIn, auto_check: dict) -> bool:
    """Editing sends the post back to review (an approved post can be edited into something else)."""
    cur = conn.execute(
        """UPDATE interview_experiences SET anonymous = ?, company = ?, company_key = ?, role = ?, level = ?,
               interviewed_on = ?, rounds_json = ?, search_text = ?, difficulty = ?, outcome = ?, tips = ?, status = 'pending',
               auto_check_json = ?, moderator_note = '', reviewed_at = NULL WHERE id = ? AND user_id = ?""",
        (int(data.anonymous), data.company, normalize_company(data.company), data.role, data.level, data.interviewed_on,
         json.dumps([r.model_dump() for r in data.rounds]), _search_text(data), data.difficulty, data.outcome, data.tips, json.dumps(auto_check),
         exp_id, user_id))
    if cur.rowcount:
        _log(conn, exp_id, "auto", "edited", f"risk={auto_check.get('risk')}")
    conn.commit()
    return cur.rowcount > 0


def delete_own(conn: sqlite3.Connection, user_id: int, exp_id: int) -> bool:
    cur = conn.execute("DELETE FROM interview_experiences WHERE id = ? AND user_id = ?", (exp_id, user_id))
    conn.commit()
    return cur.rowcount > 0


def get_visible(conn: sqlite3.Connection, exp_id: int, viewer_id: int) -> dict | None:
    """Approved posts, or the viewer's own post in any status."""
    row = conn.execute("SELECT * FROM interview_experiences WHERE id = ?", (exp_id,)).fetchone()
    if row is None or (row["status"] != "approved" and row["user_id"] != viewer_id):
        return None
    return _shape(conn, row, viewer_id)


def list_public(
    conn: sqlite3.Connection, viewer_id: int, *, company: str = "", role: str = "", difficulty: int | None = None,
    outcome: str = "", level: str = "", q: str = "", sort: str = "recent", page: int = 1,
) -> dict:
    sql, args = "SELECT * FROM interview_experiences WHERE status = 'approved'", []
    if company.strip():
        sql += " AND company_key LIKE ? ESCAPE '\\'"
        args.append(f"%{_like(normalize_company(company))}%")
    if difficulty:
        sql += " AND difficulty = ?"
        args.append(difficulty)
    if outcome:
        sql += " AND outcome = ?"
        args.append(outcome)
    if level:
        sql += " AND level = ?"
        args.append(level)
    if q.strip():
        sql += " AND search_text LIKE ? ESCAPE '\\'"
        args.append(f"%{_like(q.strip().lower())}%")
    rows = conn.execute(sql + " ORDER BY created_at DESC, id DESC", args).fetchall()
    if role.strip():  # through the role taxonomy: "SDE" finds "Software Development Engineer" write-ups
        rows = [r for r in rows if roles_match(r["role"], [role.strip()])]
    shaped = [_shape(conn, r, viewer_id) for r in rows]
    if sort == "helpful":
        shaped.sort(key=lambda e: -e["upvotes"])  # stable: ties stay newest first
    total = len(shaped)
    start = (max(page, 1) - 1) * PAGE_SIZE
    return {"items": shaped[start:start + PAGE_SIZE], "total": total, "page": max(page, 1), "page_size": PAGE_SIZE}


def _like(text: str) -> str:
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def list_mine(conn: sqlite3.Connection, user_id: int) -> list[dict]:
    rows = conn.execute("SELECT * FROM interview_experiences WHERE user_id = ? ORDER BY created_at DESC, id DESC", (user_id,)).fetchall()
    return [_shape(conn, r, user_id) for r in rows]


# ---- votes ----
def vote(conn: sqlite3.Connection, user_id: int, exp_id: int, on: bool) -> dict | None:
    row = conn.execute("SELECT user_id, status FROM interview_experiences WHERE id = ?", (exp_id,)).fetchone()
    if row is None or row["status"] != "approved" or row["user_id"] == user_id:
        return None
    if on:
        conn.execute("INSERT OR IGNORE INTO interview_votes (user_id, exp_id, created_at) VALUES (?, ?, ?)", (user_id, exp_id, _now()))
    else:
        conn.execute("DELETE FROM interview_votes WHERE user_id = ? AND exp_id = ?", (user_id, exp_id))
    conn.commit()
    return get_visible(conn, exp_id, user_id)


# ---- reports ----
def report(conn: sqlite3.Connection, reporter_id: int, exp_id: int, reason: str, detail: str) -> str:
    """Returns 'ok', 'duplicate', 'own' or 'missing'. Enough distinct reports hide the post for re-review."""
    row = conn.execute("SELECT user_id, status FROM interview_experiences WHERE id = ?", (exp_id,)).fetchone()
    if row is None or row["status"] != "approved":
        return "missing"
    if row["user_id"] == reporter_id:
        return "own"
    try:
        conn.execute("INSERT INTO interview_reports (exp_id, reporter_id, reason, detail, status, created_at) VALUES (?, ?, ?, ?, 'open', ?)",
                     (exp_id, reporter_id, reason, detail, _now()))
    except sqlite3.IntegrityError:
        return "duplicate"
    open_n = conn.execute("SELECT COUNT(*) FROM interview_reports WHERE exp_id = ? AND status = 'open'", (exp_id,)).fetchone()[0]
    if open_n >= AUTO_HIDE_REPORTS:
        conn.execute("UPDATE interview_experiences SET status = 'pending', moderator_note = ? WHERE id = ? AND status = 'approved'",
                     ("Hidden for re-review after several reports.", exp_id))
        _log(conn, exp_id, "auto", "hidden_by_reports", f"{open_n} open reports")
    conn.commit()
    return "ok"


# ---- admin ----
def queue(conn: sqlite3.Connection, status: str = "pending") -> list[dict]:
    rows = conn.execute("SELECT * FROM interview_experiences WHERE status = ? ORDER BY created_at, id", (status,)).fetchall()
    shaped = [_shape(conn, r, None, admin=True) for r in rows]
    rank = {"high": 0, "medium": 1, "low": 2}
    shaped.sort(key=lambda e: (rank.get(e["auto_check"].get("risk", "medium"), 1), -e["open_reports"], e["created_at"]))
    return shaped


def admin_get(conn: sqlite3.Connection, exp_id: int) -> dict | None:
    row = conn.execute("SELECT * FROM interview_experiences WHERE id = ?", (exp_id,)).fetchone()
    return _shape(conn, row, None, admin=True) if row else None


def set_status(conn: sqlite3.Connection, exp_id: int, status: str, note: str = "") -> bool:
    cur = conn.execute("UPDATE interview_experiences SET status = ?, moderator_note = ?, reviewed_at = ? WHERE id = ?",
                       (status, note, _now(), exp_id))
    if cur.rowcount:
        if status == "approved":  # approving clears the open reports that sent it back to review
            conn.execute("UPDATE interview_reports SET status = 'dismissed' WHERE exp_id = ? AND status = 'open'", (exp_id,))
        _log(conn, exp_id, "admin", status, note)
    conn.commit()
    return cur.rowcount > 0


def open_reports(conn: sqlite3.Connection) -> list[dict]:
    """Reports without reporter identity: moderators judge the content, not who complained."""
    rows = conn.execute(
        """SELECT r.id, r.exp_id, r.reason, r.detail, r.created_at, e.company, e.role, e.status AS exp_status
           FROM interview_reports r JOIN interview_experiences e ON e.id = r.exp_id
           WHERE r.status = 'open' ORDER BY r.created_at""").fetchall()
    return [dict(r) for r in rows]


def dismiss_report(conn: sqlite3.Connection, report_id: int) -> bool:
    cur = conn.execute("UPDATE interview_reports SET status = 'dismissed' WHERE id = ? AND status = 'open'", (report_id,))
    conn.commit()
    return cur.rowcount > 0


def export_for(conn: sqlite3.Connection, user_id: int) -> dict:
    mine = list_mine(conn, user_id)
    votes = [r[0] for r in conn.execute("SELECT exp_id FROM interview_votes WHERE user_id = ?", (user_id,))]
    reports = [dict(r) for r in conn.execute(
        "SELECT exp_id, reason, detail, status, created_at FROM interview_reports WHERE reporter_id = ?", (user_id,))]
    return {"experiences": mine, "upvoted": votes, "reports_filed": reports}
