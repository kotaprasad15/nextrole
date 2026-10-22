# NextRole security

What we protect, who we protect it from, what is implemented, how to operate it, and what is NOT
solved. Every control below has a test; the file names are given so you can read the proof.

## Assets and actors

| Asset | Why it matters |
|---|---|
| Credentials, sessions | account takeover |
| Resumes, profiles, drafts (PII) | the most sensitive data we hold |
| Other users' interview posts | privacy, anonymity |
| LLM API key and budget | cost, abuse |
| Admin dashboard | aggregates only, but still privileged |
| Server network position | SSRF reaches cloud metadata and the LAN |

Actors: anonymous attacker; signed-in malicious user; **content authors** (a resume writer, a job
poster, a web page we fetch, an interview-experience author) whose text reaches a model; curious
admin; whoever steals a database file or backup.

## Controls

### Accounts and sessions
- Passwords: Argon2id (`auth/passwords.py`). Signup policy enforced on the server (8-256 characters,
  upper, lower, special; `auth/policy.py`), mirrored in the UI. Login accepts older passwords.
- Brute force: per-IP and per-email rate limits, plus account lockout after 5 consecutive failures for
  15 minutes (stored in the database, so a restart does not reset it). A locked account answers every
  attempt identically, unknown emails get the same throttling, and an unknown email costs the same
  time as a wrong password (dummy hash), so none of this reveals which accounts exist.
  Tests: `tests/unit/test_security_web.py`.
- Sessions: random 256-bit token in an HttpOnly, SameSite=Lax cookie (Secure in production); only its
  SHA-256 is stored; revoked on logout and account deletion.
- Passwords are never logged: auth routes log no bodies, traces redact `password`.

### CSRF and browser hardening
- Layers: SameSite=Lax cookie, Origin/Referer must be an allowed origin (`ALLOWED_ORIGINS`), and a
  double-submit token (`nextrole_csrf` cookie echoed in `X-CSRF-Token`) on every state-changing
  request once logged in (`security/web.py`; the frontend adds the header in `lib/api/client.ts`).
- Headers on every API response: `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`,
  `Permissions-Policy`, COOP/CORP, a locked-down CSP, `Cache-Control: no-store`, HSTS in production.
  The Next.js app sends the same set from `next.config.ts` (`src/lib/security-headers.test.ts`).
- **CSP deviation, on purpose**: no per-request nonce, because Next only applies nonces to dynamically
  rendered pages and that would make the static marketing site dynamic. The policy still forbids
  `object`/`embed`, foreign `base`, cross-origin `form-action`/`connect-src` and all framing, but allows
  `'unsafe-inline'` scripts (needed by Next's bootstrap and the theme script). The compensating control
  is that React escapes everything and a test bans `dangerouslySetInnerHTML`/`innerHTML`. Revisit with
  hash-based CSP (`experimental.sri`) when it is stable.
- `/docs` and `/openapi.json` are disabled when `ENV=production`.

### Authorisation
- Every query is keyed by the user id from the session, never from the request body. Profile updates
  cannot target another user (`test_profile_update_only_ever_touches_the_callers_own_profile`).
- Roles: `users.role` is read from the database on every request by `require_admin`; admin routes
  answer 404 to everyone else. The only way to become an admin is `ADMIN_EMAILS` (applied at startup to
  existing accounts; accounts removed from the list are demoted). There is no API to grant a role and
  signup ignores any `role` field. **Caveat:** email addresses are not verified, so register the admin
  account BEFORE adding its address to `ADMIN_EMAILS`, otherwise whoever registered it first is promoted.

### Data at rest
- Field-level AES-256-GCM (`security/crypto.py`): profile JSON, outreach drafts/facts/critic output,
  recipient emails, feedback notes, and the resume file. Random nonce per value; ciphertext is bound to
  its owner (`table.column:user_id` as associated data) so moving it to another row fails.
- Keys come from `ENCRYPTION_KEYS` (never the repo). First key encrypts, all keys decrypt.
  **Rotation**: `uv run python -m nextrole.security genkey`, put the new key first, run
  `uv run python -m nextrole.security rotate`, remove the old key. The old Fernet key
  (`RESUME_ENCRYPTION_KEY`) still decrypts legacy data; `encrypt-existing` upgrades it (this also runs
  at startup). Existing databases are backed up to `data/backups/` before any migration or upgrade.
- Not encrypted, deliberately: `users.email` (it is the login lookup key), job postings from public
  boards, and aggregate usage counters. Backups keep their (encrypted) contents until they rotate out
  (last 5 are kept), so a deleted account can linger in a backup for that long.
- Logs and traces: `tracing/redact.py` drops sensitive keys, masks emails/phones/tokens and replaces
  long text with length + hash (no prefix). Account deletion also removes the user's trace files.

### Uploads (resumes)
`resume/inspect.py`, run in a child process by `resume/sandbox.py` (timeout, scrubbed environment,
memory/CPU limits on POSIX). Magic-byte type check, size and page limits; rejects encrypted PDFs,
JavaScript/launch actions/XFA, macros, embedded objects, remote templates and zip bombs; removes hidden
text (white fill, invisible render mode, tiny font, off-page position, hidden DOCX runs) and rejects the
file if the hidden text addresses an AI; strips attachments, annotations and metadata from the stored
copy. Nothing is executed or rendered. Tests: `tests/security/test_uploads.py`.

### Prompt injection
Resumes, postings, fetched pages and (later) interview experiences are DATA. They only ever appear
inside delimited blocks with a random per-call id (`llm/untrusted.py`), under a system rule that block
contents are never instructions. Agents that read untrusted text have no tools; only the Researcher has
tools and it is never shown a resume. All outputs are schema-validated, match text is stripped of
links, and links shown to users always come from source records, never from a model. Drafts pass the
Critic (grounding, deterministic rules) and an independent output guard (`agents/output_guard.py`:
secrets, prompt leaks, links, contact details, instruction echoes); a draft with a secret or leaked
prompt is withheld. `security/injection.py` is a tripwire (flag/log/reject hidden instructions), not
the defence. Tests: `tests/security/test_prompt_injection.py`.

### SSRF
`tools/netguard.py` + `tools/fetch.py`: https only, no credentials or odd ports, numeric host
spellings refused, every resolved address must be globally routable (IPv4-in-IPv6, 6to4, NAT64 and
Teredo unwrapped or refused), redirects re-validated per hop and capped at 3, size and time capped,
text content types only, and the connection is pinned to the validated address so DNS rebinding cannot
swap in an internal one. Tests: `tests/security/test_ssrf.py`.

### Privacy rights
`GET /me/export` returns everything held about the user (decrypted). `DELETE /me` removes the account
and, by cascade, profile, matches, drafts, feedback, runs and sessions, plus the resume file, the user's
orphaned pasted postings and trace files. Test: `tests/security/test_privacy.py`.

## Operating it
- Required: `ENCRYPTION_KEYS`. In production also `ENV=production`, HTTPS in front, `ALLOWED_ORIGINS`
  set to the real site origin, `TRUSTED_PROXY_HOPS` set to the number of proxies, `NEXT_PUBLIC_SITE_URL`.
- Audit: `bash scripts/audit.sh` (pip-audit, npm audit, gitleaks if installed, built-in secret scan).
  These need network access and were **not run in the build environment**; run them in CI.
- TLS is terminated by your proxy or platform; the app does not terminate TLS itself.

## Not solved (be honest)
- LLMs can be fooled. We limit what a fooled model can DO (no tools, schema outputs, guards, human
  approval gate on every draft) but cannot guarantee it never produces a biased score or summary.
- The rate limiter lives in process memory: with several workers each has its own counters and a restart
  forgets them. Swap in a Redis-backed limiter for multi-process deployments.
- Hidden-text detection is heuristic (it cannot know the page background; it assumes white).
- Process isolation for parsing is not a full sandbox (no network blocking): run the API in a container.
- Email verification and password reset do not exist yet.
