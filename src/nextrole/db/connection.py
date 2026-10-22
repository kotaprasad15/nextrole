"""SQLite connection helpers.

Design decision: stdlib sqlite3 with small repository functions (no ORM) keeps the SQL
visible and the dependency list short. Foreign keys are enabled per connection because
SQLite disables them by default (needed for cascade deletes).

Schema changes: `schema.sql` only uses CREATE TABLE IF NOT EXISTS, which never alters an
existing table. Columns added before versioned migrations existed are listed in
COLUMN_MIGRATIONS (kept for old databases); everything newer is a numbered migration in
`db/migrate.py`, applied on connect with a backup of the existing file first.
"""
import sqlite3
from pathlib import Path

from nextrole.db.migrate import run_migrations

SCHEMA = Path(__file__).with_name("schema.sql")

# (table, column, DDL fragment) added after the table's first release.
COLUMN_MIGRATIONS = [
    ("matches", "pinned", "INTEGER NOT NULL DEFAULT 0"),
]


def _migrate(conn: sqlite3.Connection) -> None:
    for table, column, ddl in COLUMN_MIGRATIONS:
        existing = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}
        if column not in existing:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}")
    conn.commit()


def connect(db_path: Path | str) -> sqlite3.Connection:
    on_disk = str(db_path) != ":memory:"
    had_data = on_disk and Path(db_path).exists() and Path(db_path).stat().st_size > 0
    if on_disk:
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.executescript(SCHEMA.read_text(encoding="utf-8"))
    _migrate(conn)
    run_migrations(conn, Path(db_path) if on_disk else None, had_data)
    return conn
