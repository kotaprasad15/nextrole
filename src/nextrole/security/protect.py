"""Which database columns and files are encrypted, plus the one-off backfill and key rotation.

`encrypt_existing` upgrades rows written before field encryption existed (plaintext, or resume
files sealed with the old Fernet scheme). `rotate_all` re-seals everything under the active key.
Both are idempotent and safe to re-run; each row is rewritten in its own statement.
"""
import os
import sqlite3
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken

from nextrole.security.crypto import Keyring, is_file_blob, is_text_token

# (table, column): every value is bound to its owner via `table.column:user_id`.
ENCRYPTED_COLUMNS = [
    ("profiles", "profile_json"),
    ("outreach", "draft_json"),
    ("outreach", "facts_json"),
    ("outreach", "critic_json"),
    ("outreach", "recipient_email"),
    ("feedback", "note"),
    ("saved_jobs", "notes"),
    ("saved_jobs", "snapshot_json"),
]


def _rewrite_text(conn: sqlite3.Connection, keyring: Keyring, *, rotate: bool) -> int:
    changed = 0
    for table, column in ENCRYPTED_COLUMNS:
        rows = conn.execute(
            f"SELECT rowid AS rid, user_id, {column} AS v FROM {table} WHERE {column} IS NOT NULL"
        ).fetchall()
        for r in rows:
            aad = f"{table}.{column}:{r['user_id']}"
            if is_text_token(r["v"]):
                if not rotate or keyring.text_key_id(r["v"]) == keyring.active:
                    continue
                plain = keyring.open_text(r["v"], aad)
            else:
                plain = r["v"]
            conn.execute(f"UPDATE {table} SET {column} = ? WHERE rowid = ?",
                         (keyring.seal_text(plain, aad), r["rid"]))
            changed += 1
    conn.commit()
    return changed


def _write_atomic(path: Path, data: bytes) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_bytes(data)
    os.replace(tmp, path)


def _rewrite_files(
    conn: sqlite3.Connection, keyring: Keyring, upload_dir: Path, legacy_fernet_key: str, *,
    rotate: bool,
) -> tuple[int, int]:
    changed = skipped = 0
    legacy = Fernet(legacy_fernet_key.encode()) if legacy_fernet_key else None
    for row in conn.execute("SELECT resume_path FROM profiles WHERE resume_path IS NOT NULL"):
        path = Path(upload_dir) / Path(row["resume_path"]).name
        if not path.exists():
            continue
        blob = path.read_bytes()
        if is_file_blob(blob):
            if not rotate or keyring.file_key_id(blob) == keyring.active:
                continue
            plain = keyring.open_file(blob)
        else:  # old Fernet file
            try:
                plain = legacy.decrypt(blob) if legacy else None
            except InvalidToken:
                plain = None
            if plain is None:
                skipped += 1
                continue
        _write_atomic(path, keyring.seal_file(plain))
        changed += 1
    return changed, skipped


def encrypt_existing(
    conn: sqlite3.Connection, keyring: Keyring, upload_dir: Path, legacy_fernet_key: str = "",
) -> dict[str, int]:
    files, skipped = _rewrite_files(conn, keyring, upload_dir, legacy_fernet_key, rotate=False)
    return {"fields": _rewrite_text(conn, keyring, rotate=False), "files": files,
            "files_skipped": skipped}


def rotate_all(
    conn: sqlite3.Connection, keyring: Keyring, upload_dir: Path, legacy_fernet_key: str = "",
) -> dict[str, int]:
    files, skipped = _rewrite_files(conn, keyring, upload_dir, legacy_fernet_key, rotate=True)
    return {"fields": _rewrite_text(conn, keyring, rotate=True), "files": files,
            "files_skipped": skipped}
