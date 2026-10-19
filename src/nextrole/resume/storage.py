"""Encrypted-at-rest resume storage (Fernet = AES-128-CBC + HMAC).

Design decision: the original file is stored encrypted under a random name so a stolen disk
or backup does not expose resumes, and file names never contain PII.
"""
import uuid
from pathlib import Path

from cryptography.fernet import Fernet


class StorageNotConfigured(RuntimeError):
    pass


class ResumeStore:
    def __init__(self, upload_dir: Path, key: str) -> None:
        if not key:
            raise StorageNotConfigured("RESUME_ENCRYPTION_KEY is not set")
        self.dir = Path(upload_dir)
        self.dir.mkdir(parents=True, exist_ok=True)
        self._fernet = Fernet(key.encode())

    def save(self, data: bytes) -> str:
        path = self.dir / f"{uuid.uuid4().hex}.enc"
        path.write_bytes(self._fernet.encrypt(data))
        return path.name

    def delete(self, name: str | None) -> None:
        if name:
            (self.dir / Path(name).name).unlink(missing_ok=True)  # .name blocks path traversal
