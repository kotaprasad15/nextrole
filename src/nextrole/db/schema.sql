-- Milestone c tables. Later milestones add jobs, matches, runs, outreach, etc.
-- ON DELETE CASCADE makes user-initiated deletion a single DELETE on users.
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    pw_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Only a SHA-256 of the session token is stored, so a DB leak cannot be replayed as cookies.
CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS profiles (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    profile_json TEXT NOT NULL,
    resume_path TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Milestone d. Jobs are persisted so apply URLs are always resolved from source data by id.
CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    company_key TEXT NOT NULL,
    job_json TEXT NOT NULL,
    fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Cache of every tiering decision (seed / metadata / LLM), shared across users.
CREATE TABLE IF NOT EXISTS company_tiers (
    company_key TEXT PRIMARY KEY,
    tier TEXT NOT NULL,
    method TEXT NOT NULL,
    confidence REAL NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS matches (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    score INTEGER NOT NULL,
    match_json TEXT NOT NULL,
    PRIMARY KEY (user_id, job_id)
);
