#!/usr/bin/env bash
# Dependency and secret audit. Run before releases and in CI:  bash scripts/audit.sh
# Needs network access (vulnerability databases). Exits non-zero if anything is found.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== Python dependencies (pip-audit; installed on the fly, not a project dependency) =="
uv run --with pip-audit pip-audit --progress-spinner off

echo "== Frontend dependencies (npm audit, production deps, high+) =="
(cd frontend && npm audit --omit=dev --audit-level=high)

echo "== Secrets in the repository =="
if command -v gitleaks >/dev/null 2>&1; then
  gitleaks detect --config .gitleaks.toml --redact --no-banner
else
  echo "gitleaks not installed; running the built-in scan only (see tests/security/test_repo_secrets.py)"
fi
uv run pytest -q tests/security/test_repo_secrets.py

echo "audit passed"
