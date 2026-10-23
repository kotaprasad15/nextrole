"""Built-in secret scan over every tracked file (no external tool needed; gitleaks is the stronger
second opinion in scripts/audit.sh). Fails if a real-looking credential is committed."""
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PATTERNS = {
    "anthropic/openai key": re.compile(r"\bsk-(?:ant-)?[A-Za-z0-9_-]{24,}"),
    "aws access key": re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    "github token": re.compile(r"\bgh[pousr]_[A-Za-z0-9]{30,}"),
    "slack token": re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{10,}"),
    "private key": re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    "jwt": re.compile(r"\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}"),
    "key assignment": re.compile(
        r"(?im)^[ 	]*(?:RESUME_ENCRYPTION_KEY|ENCRYPTION_KEYS|ANTHROPIC_API_KEY)[ 	]*=[ 	]*(?!.*(?:<|your|changeme|example))[^\s#]{20,}"),
    "enc token": re.compile(r"\benc:v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{24,}"),
}
SKIP_DIRS = ("tests/",)  # tests contain deliberately fake credentials to exercise the detectors
SKIP_SUFFIXES = (".lock", ".png", ".jpg", ".ico", ".woff2", ".pdf", ".docx", ".json")  # lockfiles, binaries, data


def tracked_files() -> list[Path]:
    out = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True, check=True).stdout
    return [ROOT / line for line in out.splitlines()
            if not line.startswith(SKIP_DIRS) and not line.endswith(SKIP_SUFFIXES)]


def test_no_credentials_are_committed():
    hits = []
    for path in tracked_files():
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, FileNotFoundError):
            continue
        for label, pattern in PATTERNS.items():
            if pattern.search(text):
                hits.append(f"{path.relative_to(ROOT)}: {label}")
    assert not hits, "possible secrets committed:\n" + "\n".join(hits)


def test_env_files_are_ignored_by_git():
    ignored = subprocess.run(["git", "check-ignore", ".env", "frontend/.env.local", "data/backups/x.db"],
                             cwd=ROOT, capture_output=True, text=True, check=False).stdout.split()
    assert {".env", "frontend/.env.local", "data/backups/x.db"} <= set(ignored)
