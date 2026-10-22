"""Shared test setup.

Personal data is always encrypted before it reaches the database, and there is no plaintext
fallback, so every test starts with a known keyring. Tests that build an app through
`create_app` re-configure it from their own settings, which is fine: this runs before each test.
"""
import os

import pytest

from nextrole.security import crypto

TEST_ENCRYPTION_KEYS = "k1:" + "A" * 43  # 32 zero-ish bytes; a throwaway test key, never used outside tests


@pytest.fixture(autouse=True)
def _keyring():
    crypto.configure(crypto.Keyring.parse(TEST_ENCRYPTION_KEYS))
    yield
    crypto.configure(None)


# CSRF tokens and rate limits are exercised by dedicated tests that pass explicit Settings; every other
# test talks to the API with a bare TestClient (no browser, no token), so they are off by default here.
os.environ.setdefault("CSRF_ENABLED", "false")
os.environ.setdefault("RATE_LIMIT_ENABLED", "false")
# Parsing in a child process costs ~1 s per upload; the isolation path has its own test.
os.environ.setdefault("RESUME_ISOLATION", "false")
