"""Versioned schema migrations.

`schema.sql` (CREATE TABLE IF NOT EXISTS) creates the baseline tables but can never alter or
backfill an existing one, so every later change is a numbered migration here. Rules:
- append only; never edit or reorder a released migration;
- each migration is idempotent (checks before it alters) and never drops user data;
- before the first pending migration touches an existing database file, it is copied to
  `<db dir>/backups/` (the last few are kept), so a bad migration is recoverable;
- applied versions are recorded in `schema_migrations`.

Migrations that need the encryption keyring (re-encrypting existing rows) cannot run inside
`connect()`; they run at app startup via `run_data_migrations` once the keyring is configured.
"""
import sqlite3
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path

KEEP_BACKUPS = 5


def _columns(conn: sqlite3.Connection, table: str) -> set[str]:
    return {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}


def add_column(conn: sqlite3.Connection, table: str, column: str, ddl: str) -> None:
    if column not in _columns(conn, table):
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}")


def _001_baseline(conn: sqlite3.Connection) -> None:
    """Records that the tables in schema.sql plus the old COLUMN_MIGRATIONS are version 1."""


def _002_user_security(conn: sqlite3.Connection) -> None:
    """Roles (RBAC) and login throttling state. Existing users become plain 'user's."""
    add_column(conn, "users", "role", "TEXT NOT NULL DEFAULT 'user'")
    add_column(conn, "users", "failed_logins", "INTEGER NOT NULL DEFAULT 0")
    add_column(conn, "users", "locked_until", "TEXT")
    add_column(conn, "users", "last_login_at", "TEXT")


def _003_saved_jobs_and_companies(conn: sqlite3.Connection) -> None:
    """Server-side saved jobs (snapshot + status + notes) and watched companies. New tables only."""
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS saved_jobs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            job_id TEXT NOT NULL,
            source TEXT NOT NULL DEFAULT '',
            tier TEXT NOT NULL DEFAULT 'mid',
            status TEXT NOT NULL DEFAULT 'saved'
                CHECK (status IN ('saved', 'applied', 'interview', 'offer', 'rejected')),
            notes TEXT NOT NULL DEFAULT '',          -- encrypted
            snapshot_json TEXT NOT NULL,             -- encrypted
            listed INTEGER NOT NULL DEFAULT 1,
            delisted_at TEXT,
            saved_at TEXT NOT NULL,
            status_updated_at TEXT NOT NULL,
            last_seen_at TEXT,
            UNIQUE (user_id, job_id)
        );
        CREATE INDEX IF NOT EXISTS idx_saved_jobs_user ON saved_jobs(user_id, status);
        CREATE TABLE IF NOT EXISTS user_companies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            company_key TEXT NOT NULL,
            display_name TEXT NOT NULL,
            created_at TEXT NOT NULL,
            UNIQUE (user_id, company_key)
        );
        """
    )


def _004_alerts(conn: sqlite3.Connection) -> None:
    """Alerts: per-user delivery settings, deduplicated alerts, remembered decisions, cached embeddings,
    and an aggregate run log (no user ids). New tables only."""
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS alert_settings (
            user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            in_app INTEGER NOT NULL DEFAULT 1,
            email INTEGER NOT NULL DEFAULT 0,        -- opt-in
            frequency TEXT NOT NULL DEFAULT 'daily' CHECK (frequency IN ('instant', 'daily', 'weekly', 'off')),
            unsubscribe_secret TEXT NOT NULL,
            last_email_at TEXT,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS alerts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            job_id TEXT NOT NULL,
            company_key TEXT NOT NULL,
            role_text TEXT NOT NULL,                 -- encrypted
            score REAL NOT NULL,
            confidence REAL NOT NULL,
            method TEXT NOT NULL CHECK (method IN ('taxonomy', 'embedding', 'llm')),
            why TEXT NOT NULL,                       -- encrypted
            snapshot_json TEXT NOT NULL,             -- encrypted
            created_at TEXT NOT NULL,
            read_at TEXT,
            emailed_at TEXT,
            UNIQUE (user_id, job_id)                 -- the dedup guarantee: never alert the same job twice
        );
        CREATE INDEX IF NOT EXISTS idx_alerts_user ON alerts(user_id, created_at);
        CREATE TABLE IF NOT EXISTS alert_checked (
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            job_id TEXT NOT NULL,
            checked_at TEXT NOT NULL,
            PRIMARY KEY (user_id, job_id)
        );
        CREATE TABLE IF NOT EXISTS job_embeddings (
            job_id TEXT NOT NULL,
            model TEXT NOT NULL,
            vec BLOB NOT NULL,
            created_at TEXT NOT NULL,
            PRIMARY KEY (job_id, model)
        );
        CREATE TABLE IF NOT EXISTS alert_runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            started_at TEXT NOT NULL,
            finished_at TEXT NOT NULL,
            users INTEGER NOT NULL, boards INTEGER NOT NULL, jobs_fetched INTEGER NOT NULL,
            candidates INTEGER NOT NULL, verified INTEGER NOT NULL, alerts_created INTEGER NOT NULL,
            emails_sent INTEGER NOT NULL, errors INTEGER NOT NULL
        );
        """
    )


def _005_interview_experiences(conn: sqlite3.Connection) -> None:
    """Interview experiences with moderation. New tables only. Deleting an account deletes its posts,
    votes and reports (cascade); `moderation_log` keeps only aggregate-safe facts (no user ids)."""
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS interview_experiences (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            anonymous INTEGER NOT NULL DEFAULT 1,
            company TEXT NOT NULL,
            company_key TEXT NOT NULL,
            role TEXT NOT NULL,
            level TEXT NOT NULL,
            interviewed_on TEXT NOT NULL,
            rounds_json TEXT NOT NULL,
            search_text TEXT NOT NULL DEFAULT '',     -- lowercased company, role, tips and round notes
            difficulty INTEGER NOT NULL CHECK (difficulty BETWEEN 1 AND 5),
            outcome TEXT NOT NULL,
            tips TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'removed')),
            auto_check_json TEXT NOT NULL DEFAULT '{}',
            moderator_note TEXT NOT NULL DEFAULT '',
            reviewed_at TEXT,
            created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_interviews_status ON interview_experiences(status, created_at);
        CREATE INDEX IF NOT EXISTS idx_interviews_user ON interview_experiences(user_id);
        CREATE TABLE IF NOT EXISTS interview_votes (
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            exp_id INTEGER NOT NULL REFERENCES interview_experiences(id) ON DELETE CASCADE,
            created_at TEXT NOT NULL,
            PRIMARY KEY (user_id, exp_id)
        );
        CREATE TABLE IF NOT EXISTS interview_reports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            exp_id INTEGER NOT NULL REFERENCES interview_experiences(id) ON DELETE CASCADE,
            reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            reason TEXT NOT NULL,
            detail TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'dismissed')),
            created_at TEXT NOT NULL,
            UNIQUE (exp_id, reporter_id)
        );
        CREATE TABLE IF NOT EXISTS moderation_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            exp_id INTEGER NOT NULL REFERENCES interview_experiences(id) ON DELETE CASCADE,
            actor TEXT NOT NULL,
            action TEXT NOT NULL,
            note TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL
        );
        """
    )


def _006_usage_metrics(conn: sqlite3.Connection) -> None:
    """Aggregate usage for the admin dashboard. `usage_events` has NO user id on purpose: one row per model
    call (model, stage, tokens, cost, outcome, latency). Existing `runs` are backfilled as coarse events
    (total tokens and cost per run, model unknown) so the history is not empty on day one."""
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS usage_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts TEXT NOT NULL,
            model TEXT NOT NULL,
            agent TEXT NOT NULL,
            input_tokens INTEGER NOT NULL DEFAULT 0,
            output_tokens INTEGER NOT NULL DEFAULT 0,
            cost_usd REAL NOT NULL DEFAULT 0,
            status TEXT NOT NULL CHECK (status IN ('ok', 'error')),
            latency_ms REAL NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_usage_ts ON usage_events(ts);
        CREATE TABLE IF NOT EXISTS http_daily (
            day TEXT NOT NULL,
            status_class TEXT NOT NULL CHECK (status_class IN ('ok', 'client_error', 'server_error')),
            count INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (day, status_class)
        );
        INSERT INTO usage_events (ts, model, agent, input_tokens, output_tokens, cost_usd, status, latency_ms)
            SELECT replace(started_at, ' ', 'T'), 'historical (before tracking)', mode, tokens, 0, cost_usd,
                   CASE WHEN status = 'failed' THEN 'error' ELSE 'ok' END, 0
            FROM runs WHERE tokens > 0 AND NOT EXISTS (SELECT 1 FROM usage_events);
        """
    )


# (version, name, function). Append new migrations at the end.
MIGRATIONS: list[tuple[int, str, Callable[[sqlite3.Connection], None]]] = [
    (1, "baseline", _001_baseline),
    (2, "user_security", _002_user_security),
    (3, "saved_jobs_and_companies", _003_saved_jobs_and_companies),
    (4, "alerts", _004_alerts),
    (5, "interview_experiences", _005_interview_experiences),
    (6, "usage_metrics", _006_usage_metrics),
]


def _ensure_table(conn: sqlite3.Connection) -> None:
    conn.execute(
        "CREATE TABLE IF NOT EXISTS schema_migrations ("
        "version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)"
    )
    conn.commit()


def applied_versions(conn: sqlite3.Connection) -> set[int]:
    _ensure_table(conn)
    return {row["version"] for row in conn.execute("SELECT version FROM schema_migrations")}


def _record(conn: sqlite3.Connection, version: int, name: str) -> None:
    conn.execute("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
                 (version, name, datetime.now(UTC).isoformat()))
    conn.commit()


def backup_database(conn: sqlite3.Connection, db_path: Path, label: str) -> Path:
    """Consistent copy (sqlite backup API, safe while open) into <db dir>/backups/."""
    dest_dir = db_path.parent / "backups"
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / f"{db_path.stem}-{datetime.now(UTC):%Y%m%dT%H%M%S%f}-{label}.db"
    target = sqlite3.connect(dest)
    try:
        conn.backup(target)
    finally:
        target.close()
    for old in sorted(dest_dir.glob(f"{db_path.stem}-*.db"))[:-KEEP_BACKUPS]:
        old.unlink(missing_ok=True)
    return dest


def run_migrations(conn: sqlite3.Connection, db_path: Path | None, had_data: bool) -> list[int]:
    """Apply pending migrations; returns the versions applied. `had_data` = the DB file already
    existed, so a backup is worth taking."""
    done = applied_versions(conn)
    pending = [m for m in MIGRATIONS if m[0] not in done]
    if not pending:
        return []
    # A brand-new database has nothing to lose; an existing one gets a backup first.
    if db_path is not None and had_data and done:
        backup_database(conn, db_path, f"pre-v{pending[0][0]}")
    elif db_path is not None and had_data and not done:
        backup_database(conn, db_path, "pre-migrations")
    for version, name, fn in pending:
        fn(conn)
        conn.commit()
        _record(conn, version, name)
    return [m[0] for m in pending]


# ---- data migrations that need the encryption keyring ---------------------------------------
DATA_ENCRYPT_EXISTING = 1001


def run_data_migrations(conn, keyring, upload_dir: Path, legacy_fernet_key: str, db_path) -> dict:
    """Encrypt rows and resume files written before field encryption existed. Idempotent: the
    backfill only touches values that are not already sealed, and it runs on every startup until
    nothing is left (cheap), so a restart with a key finishes an interrupted run."""
    from nextrole.security.protect import encrypt_existing  # local: avoids an import cycle

    result = {"fields": 0, "files": 0, "files_skipped": 0}
    done = applied_versions(conn)
    first = DATA_ENCRYPT_EXISTING not in done
    if first and db_path is not None and Path(db_path).exists() and conn.execute(
            "SELECT 1 FROM profiles LIMIT 1").fetchone():
        backup_database(conn, Path(db_path), "pre-encrypt")
    result = encrypt_existing(conn, keyring, upload_dir, legacy_fernet_key)
    if first and not result["files_skipped"]:
        _record(conn, DATA_ENCRYPT_EXISTING, "encrypt_existing_pii")
    return result
