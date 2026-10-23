"""Field-level encryption at rest: AES-256-GCM with a versioned keyring.

Why: a stolen database file or backup must not expose resumes, profiles or drafts. Every
protected value is sealed with AES-256-GCM (authenticated: tampering is detected) under a random
96-bit nonce, and bound to its owner with associated data (`table.column:user_id`), so a
ciphertext copied into another user's row fails to decrypt.

Token format (text columns): ``enc:v1:<key id>:<base64url(nonce || ciphertext+tag)>``.
File format (resume uploads): ``NRENC1`` | 1-byte key-id length | key id | nonce || ciphertext+tag.

Keys come from the environment, never the repo: ``ENCRYPTION_KEYS="k2:<b64>,k1:<b64>"`` where each
value is 32 random bytes in URL-safe base64 and the FIRST entry encrypts new data while all
entries can decrypt. Rotation: generate a key, put it first, run
``python -m nextrole.security rotate``, then drop the old key. Generate one with
``python -m nextrole.security genkey``.

Back-compat: if only the old ``RESUME_ENCRYPTION_KEY`` (a Fernet key) is set, a key is derived from
it with HKDF so existing deployments keep working; if both are set it stays available as a
decrypt-only key.
"""
import base64
import os
import re
from dataclasses import dataclass

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

TEXT_PREFIX = "enc:v1:"
FILE_MAGIC = b"NRENC1"
_KEY_ID = re.compile(r"^[A-Za-z0-9_-]{1,32}$")
_NONCE_BYTES = 12


class CryptoNotConfigured(RuntimeError):
    """No encryption key is available; personal data cannot be stored safely."""


class DecryptionError(ValueError):
    """Wrong key, wrong owner (associated data) or tampered ciphertext."""


def _b64e(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _b64d(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def generate_key() -> str:
    """A fresh 256-bit key, URL-safe base64 (the value half of an ENCRYPTION_KEYS entry)."""
    return _b64e(os.urandom(32))


def is_text_token(value: str | None) -> bool:
    return bool(value) and value.startswith(TEXT_PREFIX)


def is_file_blob(blob: bytes) -> bool:
    return blob.startswith(FILE_MAGIC)


@dataclass(frozen=True)
class Keyring:
    keys: dict[str, bytes]  # insertion order: first = active
    active: str

    @classmethod
    def parse(cls, spec: str, legacy_fernet_key: str = "") -> "Keyring | None":
        keys: dict[str, bytes] = {}
        for part in filter(None, (p.strip() for p in spec.split(","))):
            kid, _, value = part.partition(":")
            if not _KEY_ID.match(kid) or kid in keys:
                raise ValueError("ENCRYPTION_KEYS entries must be unique `id:base64key` pairs")
            raw = _b64d(value)
            if len(raw) != 32:
                raise ValueError(f"encryption key {kid!r} must be 32 bytes (use `genkey`)")
            keys[kid] = raw
        if legacy_fernet_key:
            derived = HKDF(algorithm=hashes.SHA256(), length=32, salt=None,
                           info=b"nextrole-field-encryption-v1").derive(legacy_fernet_key.encode())
            keys.setdefault("legacy", derived)  # last, so it only encrypts when it is the sole key
        if not keys:
            return None
        return cls(keys=keys, active=next(iter(keys)))

    def _aes(self, kid: str) -> AESGCM:
        try:
            return AESGCM(self.keys[kid])
        except KeyError as exc:
            raise DecryptionError(f"unknown encryption key id {kid!r}") from exc

    # ---- bytes ----
    def seal(self, plaintext: bytes, aad: bytes) -> bytes:
        nonce = os.urandom(_NONCE_BYTES)
        return nonce + self._aes(self.active).encrypt(nonce, plaintext, aad)

    def open(self, kid: str, blob: bytes, aad: bytes) -> bytes:
        aes = self._aes(kid)
        try:
            return aes.decrypt(blob[:_NONCE_BYTES], blob[_NONCE_BYTES:], aad)
        except Exception as exc:  # InvalidTag and malformed input: never echo details
            raise DecryptionError("cannot decrypt (wrong key, owner or corrupted data)") from exc

    # ---- text columns ----
    def seal_text(self, plaintext: str, aad: str) -> str:
        return f"{TEXT_PREFIX}{self.active}:{_b64e(self.seal(plaintext.encode(), aad.encode()))}"

    def open_text(self, token: str, aad: str) -> str:
        if not is_text_token(token):
            return token  # legacy plaintext row, not yet migrated
        kid, _, body = token[len(TEXT_PREFIX):].partition(":")
        return self.open(kid, _b64d(body), aad.encode()).decode()

    def text_key_id(self, token: str) -> str | None:
        return token[len(TEXT_PREFIX):].partition(":")[0] if is_text_token(token) else None

    # ---- files ----
    def seal_file(self, data: bytes, aad: bytes = b"resume-file") -> bytes:
        kid = self.active.encode()
        return FILE_MAGIC + bytes([len(kid)]) + kid + self.seal(data, aad)

    def open_file(self, blob: bytes, aad: bytes = b"resume-file") -> bytes:
        if not is_file_blob(blob):
            raise DecryptionError("not an AES-GCM file")
        n = blob[len(FILE_MAGIC)]
        start = len(FILE_MAGIC) + 1
        return self.open(blob[start:start + n].decode(), blob[start + n:], aad)

    def file_key_id(self, blob: bytes) -> str | None:
        if not is_file_blob(blob):
            return None
        n = blob[len(FILE_MAGIC)]
        return blob[len(FILE_MAGIC) + 1:len(FILE_MAGIC) + 1 + n].decode()


# ---- process-wide keyring -------------------------------------------------------------------
# Repository functions are module-level and take only a connection, so the keyring is configured
# once at startup (create_app) and read through these helpers. There is deliberately NO plaintext
# fallback: without a key, storing personal data fails loudly.
_keyring: Keyring | None = None


def configure(keyring: Keyring | None) -> None:
    global _keyring
    _keyring = keyring


def get_keyring() -> Keyring:
    if _keyring is None:
        raise CryptoNotConfigured(
            "No encryption key configured. Set ENCRYPTION_KEYS (see `python -m nextrole.security genkey`)."
        )
    return _keyring


def protect(plaintext: str, table: str, column: str, user_id: int) -> str:
    return get_keyring().seal_text(plaintext, f"{table}.{column}:{user_id}")


def reveal(stored: str, table: str, column: str, user_id: int) -> str:
    return get_keyring().open_text(stored, f"{table}.{column}:{user_id}")
