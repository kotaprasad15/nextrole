"""Encrypted-at-rest resume storage (AES-256-GCM via the shared keyring).

Design decision: the original file is stored encrypted under a random name so a stolen disk
or backup does not expose resumes, and file names never contain PII. Files are only ever read back
to be re-encrypted (key rotation) or exported to their owner; they are never served or rendered.
Files written by the first release (Fernet) are still readable and are upgraded by
`security.protect.encrypt_existing`.
"""
import uuid
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken

from nextrole.security.crypto import DecryptionError, Keyring, is_file_blob


class StorageNotConfigured(RuntimeError):
    pass


class ResumeStore:
    def __init__(self, upload_dir: Path, keyring: Keyring | None, legacy_fernet_key: str = "") -> None:
        if keyring is None:
            raise StorageNotConfigured("ENCRYPTION_KEYS is not set")
        self.dir = Path(upload_dir)
        self.dir.mkdir(parents=True, exist_ok=True)
        self._keyring = keyring
        self._legacy = Fernet(legacy_fernet_key.encode()) if legacy_fernet_key else None

    def save(self, data: bytes) -> str:
        path = self.dir / f"{uuid.uuid4().hex}.enc"
        path.write_bytes(self._keyring.seal_file(data))
        return path.name

    def load(self, name: str) -> bytes:
        blob = (self.dir / Path(name).name).read_bytes()  # .name blocks path traversal
        if is_file_blob(blob):
            return self._keyring.open_file(blob)
        if self._legacy is not None:
            try:
                return self._legacy.decrypt(blob)
            except InvalidToken:
                pass
        raise DecryptionError("cannot decrypt stored resume")

    def delete(self, name: str | None) -> None:
        if name:
            (self.dir / Path(name).name).unlink(missing_ok=True)  # .name blocks path traversal
