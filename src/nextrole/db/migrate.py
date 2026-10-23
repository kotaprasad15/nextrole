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


# (version, name, function). Append new migrations at the end.
MIGRATIONS: list[tuple[int, str, Callable[[sqlite3.Connection], None]]] = [
    (1, "baseline", _001_baseline),
    (2, "user_security", _002_user_security),
    (3, "saved_jobs_and_companies", _003_saved_jobs_and_companies),
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
