"""Rate limiting, login lockout, CSRF, security headers, RBAC."""
from cryptography.fernet import Fernet
from fastapi import Depends
from fastapi.testclient import TestClient

from nextrole.api.deps import client_ip, require_admin
from nextrole.api.main import create_app
from nextrole.config import Settings
from nextrole.db import repos
from nextrole.db.connection import connect
from nextrole.security.ratelimit import RateLimiter

PW = "Correct-horse9"
ORIGIN = "http://127.0.0.1:3100"


def make_app(tmp_path, **overrides):
    settings = Settings(_env_file=None, upload_dir=tmp_path / "up",
                        resume_encryption_key=Fernet.generate_key().decode(), **overrides)
    app = create_app(settings, connect(":memory:"))

    @app.get("/_admin_probe")
    def probe(_: int = Depends(require_admin)) -> dict:
        return {"ok": True}

    return app


def signup(c, email="a@b.co", **kw):
    return c.post("/auth/signup", json={"email": email, "password": PW}, **kw)


# ---- rate limiter ----
def test_rate_limiter_is_a_sliding_window():
    now = [0.0]
    rl = RateLimiter(clock=lambda: now[0])
    assert [rl.check("k", 3, 10)[0] for _ in range(3)] == [True, True, True]
    ok, retry = rl.check("k", 3, 10)
    assert not ok and 9 < retry <= 10
    assert rl.check("other", 3, 10)[0]  # independent keys
    now[0] = 10.5
    assert rl.check("k", 3, 10)[0]  # old hits aged out
    rl.reset("k")
    assert [rl.check("k", 3, 10)[0] for _ in range(3)] == [True, True, True]


def test_signup_is_rate_limited_per_address(tmp_path):
    c = TestClient(make_app(tmp_path, rate_limit_enabled=True))
    codes = [signup(c, f"u{i}@b.co").status_code for i in range(12)]
    assert codes[:10] == [201] * 10 and codes[10:] == [429, 429]
    r = signup(c, "late@b.co")
    assert r.status_code == 429 and int(r.headers["retry-after"]) >= 1


def test_login_locks_after_repeated_failures_even_with_the_right_password(tmp_path):
    app = make_app(tmp_path, rate_limit_enabled=True, login_max_failures=3)
    c = TestClient(app)
    signup(c)
    c.post("/auth/logout")
    bad = {"email": "a@b.co", "password": "wrong password"}
    assert [c.post("/auth/login", json=bad).status_code for _ in range(2)] == [401, 401]
    assert c.post("/auth/login", json=bad).status_code == 429  # third failure locks
    good = c.post("/auth/login", json={"email": "a@b.co", "password": PW})
    assert good.status_code == 429  # locked: a correct password does not help
    assert "retry-after" in good.headers
    conn = app.state.conn
    conn.execute("UPDATE users SET locked_until = NULL")  # lockout expires
    conn.commit()
    app.state.limiter.reset("login:email:a@b.co")
    assert c.post("/auth/login", json={"email": "a@b.co", "password": PW}).status_code == 200


def test_unknown_accounts_get_the_same_throttling_and_errors_as_real_ones(tmp_path):
    c = TestClient(make_app(tmp_path, rate_limit_enabled=True))
    codes = [c.post("/auth/login", json={"email": "ghost@b.co", "password": "nope nope"}).status_code
             for _ in range(12)]
    assert codes[0] == 401 and codes[-1] == 429  # per-email budget applies to non-accounts too


def test_a_successful_login_resets_the_failure_counter(tmp_path):
    app = make_app(tmp_path, rate_limit_enabled=False, login_max_failures=3)
    c = TestClient(app)
    signup(c)
    bad = {"email": "a@b.co", "password": "wrong password"}
    c.post("/auth/login", json=bad)
    c.post("/auth/login", json=bad)
    assert c.post("/auth/login", json={"email": "a@b.co", "password": PW}).status_code == 200
    assert c.post("/auth/login", json=bad).status_code == 401  # counter restarted, not locked


def test_client_ip_trusts_forwarded_for_only_for_configured_hops(tmp_path):
    direct = make_app(tmp_path)
    proxied = make_app(tmp_path, trusted_proxy_hops=1)

    def ip(app, xff):
        scope = {"type": "http", "headers": [(b"x-forwarded-for", xff.encode())], "client": ("9.9.9.9", 1),
                 "app": app}
        from starlette.requests import Request
        return client_ip(Request(scope))

    assert ip(direct, "1.2.3.4") == "9.9.9.9"  # spoofable header ignored by default
    assert ip(proxied, "6.6.6.6, 1.2.3.4") == "1.2.3.4"  # the entry the trusted proxy appended


# ---- CSRF ----
def test_csrf_token_and_origin_are_required_once_logged_in(tmp_path):
    c = TestClient(make_app(tmp_path, csrf_enabled=True))
    assert signup(c, headers={"Origin": ORIGIN}).status_code == 201  # no session yet: no token needed
    token = c.cookies.get("nextrole_csrf")
    assert token
    assert signup(c, "x@b.co", headers={"Origin": ORIGIN}).status_code == 403  # now has a session: token needed

    assert c.put("/profile", json={}).status_code == 403  # session cookie, no token
    assert c.put("/profile", json={}, headers={"X-CSRF-Token": "wrong"}).status_code == 403
    # Right token but a foreign Origin: still blocked
    assert c.put("/profile", json={}, headers={"X-CSRF-Token": token, "Origin": "https://evil.example"}).status_code == 403
    assert c.put("/profile", json={}, headers={"X-CSRF-Token": token, "Origin": "null"}).status_code == 403
    ok = c.put("/profile", json={}, headers={"X-CSRF-Token": token, "Origin": ORIGIN})
    assert ok.status_code != 403  # passes CSRF (validation of the empty body is a separate matter)
    assert c.get("/me").status_code == 200  # safe methods are never blocked


def test_login_is_origin_checked_even_without_a_session(tmp_path):
    c = TestClient(make_app(tmp_path, csrf_enabled=True))
    r = c.post("/auth/login", json={"email": "a@b.co", "password": PW}, headers={"Origin": "https://evil.example"})
    assert r.status_code == 403


def test_csrf_cookie_is_readable_by_js_but_session_cookie_is_not(tmp_path):
    c = TestClient(make_app(tmp_path))
    cookies = signup(c).headers.get_list("set-cookie")
    session = next(h for h in cookies if h.startswith("nextrole_session"))
    csrf = next(h for h in cookies if h.startswith("nextrole_csrf"))
    assert "httponly" in session.lower() and "httponly" not in csrf.lower()


def test_production_forces_secure_cookies_hsts_and_hides_docs(tmp_path):
    c = TestClient(make_app(tmp_path, env="production"))
    r = signup(c)
    assert all("secure" in h.lower() for h in r.headers.get_list("set-cookie"))
    assert r.headers["strict-transport-security"].startswith("max-age=")
    assert c.get("/docs").status_code == 404 and c.get("/openapi.json").status_code == 404


# ---- headers ----
def test_security_headers_on_every_response(tmp_path):
    c = TestClient(make_app(tmp_path))
    for r in (c.get("/health"), c.get("/me"), c.post("/auth/logout")):
        assert r.headers["x-content-type-options"] == "nosniff"
        assert r.headers["x-frame-options"] == "DENY"
        assert "frame-ancestors 'none'" in r.headers["content-security-policy"]
        assert r.headers["referrer-policy"]
        assert r.headers["cache-control"] == "no-store"
    assert "strict-transport-security" not in c.get("/health").headers  # plain-http development


# ---- RBAC ----
def test_admin_routes_are_404_for_everyone_but_admins_and_role_comes_from_the_database(tmp_path):
    app = make_app(tmp_path)
    c = TestClient(app)
    assert c.get("/_admin_probe").status_code == 401  # anonymous
    signup(c, "root@b.co")
    assert c.get("/_admin_probe").status_code == 404  # signed in, not admin: existence not revealed
    assert c.get("/me").json()["role"] == "user"

    conn = app.state.conn
    repos.sync_admins(conn, ["root@b.co"])
    assert c.get("/_admin_probe").status_code == 200  # same session, role re-read from the DB
    assert c.get("/me").json()["role"] == "admin"

    repos.sync_admins(conn, [])  # removed from ADMIN_EMAILS: demoted
    assert c.get("/_admin_probe").status_code == 404


def test_admin_emails_setting_promotes_existing_accounts_only(tmp_path):
    conn = connect(":memory:")
    repos.create_user(conn, "boss@b.co", "h")
    repos.create_user(conn, "other@b.co", "h")
    repos.sync_admins(conn, [" Boss@B.co ", ""])
    roles = {r["email"]: r["role"] for r in conn.execute("SELECT email, role FROM users")}
    assert roles == {"boss@b.co": "admin", "other@b.co": "user"}


def test_signup_cannot_set_a_role(tmp_path):
    c = TestClient(make_app(tmp_path))
    r = c.post("/auth/signup", json={"email": "evil@b.co", "password": PW, "role": "admin"})
    assert r.status_code == 201
    assert c.get("/me").json()["role"] == "user"
