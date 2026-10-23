"""Field encryption, key rotation, legacy upgrade and versioned migrations."""
import sqlite3

import pytest
from cryptography.fernet import Fernet

from nextrole.db import repos
from nextrole.db.connection import connect
from nextrole.db.migrate import MIGRATIONS, applied_versions, run_data_migrations, run_migrations
from nextrole.models.profile import Profile
from nextrole.resume.storage import ResumeStore
from nextrole.security import crypto
from nextrole.security.crypto import DecryptionError, Keyring, generate_key
from nextrole.security.protect import encrypt_existing, rotate_all

K1, K2 = f"k1:{generate_key()}", f"k2:{generate_key()}"


def test_text_roundtrip_is_authenticated_and_bound_to_the_owner():
    ring = Keyring.parse(K1)
    token = ring.seal_text("Ada Lovelace, 12 Analytical St", "profiles.profile_json:7")
    assert token.startswith("enc:v1:k1:") and "Ada" not in token
    assert ring.open_text(token, "profiles.profile_json:7") == "Ada Lovelace, 12 Analytical St"
    with pytest.raises(DecryptionError):  # copied into another user's row
        ring.open_text(token, "profiles.profile_json:8")
    tampered = token[:-4] + ("AAAA" if not token.endswith("AAAA") else "BBBB")
    with pytest.raises(DecryptionError):
        ring.open_text(tampered, "profiles.profile_json:7")


def test_every_seal_uses_a_fresh_nonce():
    ring = Keyring.parse(K1)
    assert ring.seal_text("same", "a:1") != ring.seal_text("same", "a:1")


def test_keyring_parsing_rules():
    assert Keyring.parse("") is None
    ring = Keyring.parse(f"{K2},{K1}")
    assert ring.active == "k2" and set(ring.keys) == {"k1", "k2"}
    for bad in ("nokey", "k1:short", f"{K1},{K1}", "bad id:" + generate_key()):
        with pytest.raises(ValueError):
            Keyring.parse(bad)


def test_old_fernet_key_still_gives_a_working_keyring():
    ring = Keyring.parse("", Fernet.generate_key().decode())
    assert ring.active == "legacy"
    assert ring.open_text(ring.seal_text("x", "t.c:1"), "t.c:1") == "x"
    both = Keyring.parse(K1, Fernet.generate_key().decode())
    assert both.active == "k1" and "legacy" in both.keys  # decrypt-only


def test_no_plaintext_fallback_without_a_key():
    crypto.configure(None)
    with pytest.raises(crypto.CryptoNotConfigured):
        crypto.protect("secret", "profiles", "profile_json", 1)


def _db_with_user(tmp_path=None):
    conn = connect(":memory:")
    uid = repos.create_user(conn, "a@b.co", "hash")
    return conn, uid


def test_profile_is_encrypted_in_the_database_and_decrypted_on_read():
    conn, uid = _db_with_user()
    repos.save_profile(conn, uid, Profile(name="Ada Lovelace", summary="Analytical engines"))
    raw = conn.execute("SELECT profile_json FROM profiles").fetchone()["profile_json"]
    assert raw.startswith("enc:v1:") and "Ada" not in raw
    assert repos.get_profile(conn, uid).name == "Ada Lovelace"


def test_rotation_reseals_everything_under_the_new_key(tmp_path):
    conn, uid = _db_with_user()
    old = Keyring.parse(K1)
    crypto.configure(old)
    store = ResumeStore(tmp_path, old)
    name = store.save(b"%PDF resume bytes")
    repos.save_profile(conn, uid, Profile(name="Ada"), name)

    new = Keyring.parse(f"{K2},{K1}")  # k2 active, k1 kept to decrypt
    crypto.configure(new)
    counts = rotate_all(conn, new, tmp_path)
    assert counts["fields"] == 1 and counts["files"] == 1
    raw = conn.execute("SELECT profile_json FROM profiles").fetchone()["profile_json"]
    assert raw.startswith("enc:v1:k2:")
    assert (tmp_path / name).read_bytes().startswith(b"NRENC1\x02k2")
    assert repos.get_profile(conn, uid).name == "Ada"
    assert ResumeStore(tmp_path, new).load(name) == b"%PDF resume bytes"
    assert rotate_all(conn, new, tmp_path)["fields"] == 0  # idempotent

    only_new = Keyring.parse(K2)  # old key can now be dropped
    crypto.configure(only_new)
    assert repos.get_profile(conn, uid).name == "Ada"


def test_encrypt_existing_upgrades_plaintext_rows_and_fernet_files(tmp_path):
    conn, uid = _db_with_user()
    fernet_key = Fernet.generate_key().decode()
    legacy_name = "legacy.enc"
    (tmp_path / legacy_name).write_bytes(Fernet(fernet_key.encode()).encrypt(b"old resume"))
    conn.execute(
        "INSERT INTO profiles (user_id, profile_json, resume_path) VALUES (?, ?, ?)",
        (uid, Profile(name="Old Row").model_dump_json(), legacy_name))
    conn.commit()

    ring = Keyring.parse(K1, fernet_key)
    crypto.configure(ring)
    counts = encrypt_existing(conn, ring, tmp_path, fernet_key)
    assert counts == {"fields": 1, "files": 1, "files_skipped": 0}
    assert conn.execute("SELECT profile_json FROM profiles").fetchone()[0].startswith("enc:v1:")
    assert ResumeStore(tmp_path, ring).load(legacy_name) == b"old resume"
    assert (tmp_path / legacy_name).read_bytes().startswith(b"NRENC1")
    assert encrypt_existing(conn, ring, tmp_path, fernet_key)["fields"] == 0


def test_files_that_cannot_be_decrypted_are_skipped_not_destroyed(tmp_path):
    conn, uid = _db_with_user()
    (tmp_path / "x.enc").write_bytes(b"not-a-known-format")
    conn.execute("INSERT INTO profiles (user_id, profile_json, resume_path) VALUES (?, '{}', 'x.enc')", (uid,))
    ring = Keyring.parse(K1)
    counts = encrypt_existing(conn, ring, tmp_path, "")
    assert counts["files_skipped"] == 1
    assert (tmp_path / "x.enc").read_bytes() == b"not-a-known-format"


def test_data_migration_is_recorded_only_when_complete(tmp_path):
    db = tmp_path / "n.db"
    conn = connect(db)
    uid = repos.create_user(conn, "a@b.co", "h")
    conn.execute("INSERT INTO profiles (user_id, profile_json) VALUES (?, ?)",
                 (uid, Profile(name="Plain").model_dump_json()))
    conn.commit()
    ring = Keyring.parse(K1)
    crypto.configure(ring)
    run_data_migrations(conn, ring, tmp_path / "up", "", db)
    assert 1001 in applied_versions(conn)
    assert conn.execute("SELECT profile_json FROM profiles").fetchone()[0].startswith("enc:v1:")
    assert list((tmp_path / "backups").glob("*pre-encrypt.db"))  # backed up before touching data


def test_migrations_apply_once_add_columns_and_back_up_existing_databases(tmp_path):
    db = tmp_path / "data" / "n.db"
    conn = connect(db)  # new database: migrations ran, no backup needed
    assert applied_versions(conn) == {v for v, _, _ in MIGRATIONS}
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(users)")}
    assert {"role", "failed_logins", "locked_until"} <= cols
    assert not (db.parent / "backups").exists()
    repos.create_user(conn, "keep@b.co", "h")
    conn.close()

    # Simulate an old database: forget the migration record and drop the new columns' bookkeeping.
    old = sqlite3.connect(db)
    old.execute("DELETE FROM schema_migrations WHERE version = 2")
    old.commit()
    old.close()
    conn2 = connect(db)  # existing file with a pending migration: backed up first
    assert 2 in applied_versions(conn2)
    assert list((db.parent / "backups").glob("*.db"))
    assert conn2.execute("SELECT email, role FROM users").fetchone()["email"] == "keep@b.co"
    assert run_migrations(conn2, db, True) == []  # nothing pending: idempotent
