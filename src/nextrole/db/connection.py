"""SQLite connection helpers.

Design decision: stdlib sqlite3 with small repository functions (no ORM) keeps the SQL
visible and the dependency list short. Foreign keys are enabled per connection because
SQLite disables them by default (needed for cascade deletes).
"""
import sqlite3
from pathlib import Path

SCHEMA = Path(__file__).with_name("schema.sql")


def connect(db_path: Path | str) -> sqlite3.Connection:
    if str(db_path) != ":memory:":
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.executescript(SCHEMA.read_text(encoding="utf-8"))
    return conn
