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
