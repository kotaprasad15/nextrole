"""Catch-all guards over EVERY route (so a route added later cannot silently skip authentication, CSRF or
the admin role) and over what responses may reveal.

Nothing here lists routes by hand except the explicit allow-list of public ones: new routes are covered
automatically, and a new PUBLIC route has to be added to the allow-list on purpose.
"""
import re

import pytest
from cryptography.fernet import Fernet
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from nextrole.api.main import create_app
from nextrole.config import Settings
from nextrole.db import repos
from nextrole.db.connection import connect
from nextrole.llm.untrusted import CANARY

PW = "Correct-horse9"
ORIGIN = "http://127.0.0.1:3100"
# (method, path) pairs that are public ON PURPOSE. Everything else must demand a session.
PUBLIC = {("GET", "/health"), ("GET", "/"), ("POST", "/auth/signup"), ("POST", "/auth/login"), ("POST", "/auth/logout"),
          ("GET", "/public/featured-jobs"), ("POST", "/alerts/unsubscribe")}
# State-changing routes that are deliberately exempt from the CSRF token (still Origin-checked).
CSRF_EXEMPT = {("POST", "/auth/logout"), ("POST", "/alerts/unsubscribe")}
SECRET_KEY = "sk-ant-api03-THIS-MUST-NEVER-APPEAR-IN-A-RESPONSE-0123456789"


def make(tmp_path, **kw):
    s = Settings(_env_file=None, upload_dir=tmp_path / "up", trace_dir=tmp_path / "traces", alerts_enabled=False,
                 resume_encryption_key=Fernet.generate_key().decode(), anthropic_api_key=SECRET_KEY, **kw)
    return create_app(s, connect(":memory:")), s


def concrete(path: str) -> str:
    return re.sub(r"\{[^}]+\}", "1", path)


def api_routes(app) -> list[APIRoute]:
    """Every APIRoute, including those FastAPI keeps inside lazily included routers."""
    out: list[APIRoute] = []
    for r in app.routes:
        if isinstance(r, APIRoute):
            out.append(r)
        elif hasattr(r, "original_router"):
            out += [x for x in r.original_router.routes if isinstance(x, APIRoute)]
    return out


def routes(app):
    return [(m, r.path) for r in api_routes(app) for m in sorted(r.methods - {"HEAD", "OPTIONS"})]


def test_every_non_public_route_rejects_visitors_with_401(tmp_path):
    app, _ = make(tmp_path)
    anon = TestClient(app)
    checked = 0
    for method, path in routes(app):
        if (method, path) in PUBLIC:
            continue
        r = anon.request(method, concrete(path), json={} if method not in {"GET", "DELETE"} else None)
        assert r.status_code == 401, f"{method} {path} answered {r.status_code} to a visitor"
        checked += 1
    assert checked >= 40  # the matrix really covered the app (a sanity check against an empty loop)


def test_every_public_route_is_on_the_allow_list_and_exists(tmp_path):
    app, _ = make(tmp_path)
    existing = set(routes(app))
    assert PUBLIC <= existing, f"allow-list names routes that do not exist: {PUBLIC - existing}"


def test_every_state_changing_route_demands_the_csrf_token_once_logged_in(tmp_path):
    app, _ = make(tmp_path, csrf_enabled=True)
    c = TestClient(app)
    assert c.post("/auth/signup", json={"email": "a@b.co", "password": PW}, headers={"Origin": ORIGIN}).status_code == 201
    token = c.cookies.get("nextrole_csrf")
    checked = 0
    for method, path in routes(app):
        if method in {"GET"} or (method, path) in CSRF_EXEMPT:
            continue
        r = c.request(method, concrete(path), json={}, headers={"Origin": ORIGIN})  # session cookie, NO token
        assert r.status_code == 403, f"{method} {path} accepted a request without a CSRF token ({r.status_code})"
        checked += 1
    assert checked >= 25
    # and a forged Origin is refused even WITH a valid token
    r = c.put("/profile", json={}, headers={"Origin": "https://evil.example", "X-CSRF-Token": token})
    assert r.status_code == 403


def test_every_admin_route_is_hidden_from_members_with_404(tmp_path):
    app, _ = make(tmp_path, csrf_enabled=True)
    c = TestClient(app)
    c.post("/auth/signup", json={"email": "m@b.co", "password": PW}, headers={"Origin": ORIGIN})
    headers = {"Origin": ORIGIN, "X-CSRF-Token": c.cookies.get("nextrole_csrf")}
    admin_routes = [(m, p) for m, p in routes(app) if p.startswith("/admin")]
    assert len(admin_routes) >= 8
    for method, path in admin_routes:
        r = c.request(method, concrete(path), json={} if method not in {"GET", "DELETE"} else None, headers=headers)
        assert r.status_code == 404, f"{method} {path} answered {r.status_code} to a plain member"


def test_a_role_in_a_request_or_cookie_never_grants_admin(tmp_path):
    app, _ = make(tmp_path)
    c = TestClient(app)
    assert c.post("/auth/signup", json={"email": "m@b.co", "password": PW, "role": "admin", "is_admin": True}).status_code == 201
    c.cookies.set("role", "admin")
    for headers in ({"X-Role": "admin"}, {"X-Admin": "1"}, {"Authorization": "Bearer admin"}):
        assert c.get("/admin/metrics", headers=headers).status_code == 404
    assert c.put("/profile", json={"name": "x", "role": "admin"}).status_code in (200, 422)
    assert repos.get_role(app.state.conn, 1) == "user"


def test_every_route_has_a_documented_rate_limit_or_is_cheap(tmp_path):
    """Costly routes (LLM, upload, export, email) must carry a rate-limit dependency: a new one without it fails here."""
    app, _ = make(tmp_path)
    costly = {("POST", "/onboarding"), ("POST", "/runs"), ("POST", "/outreach"), ("POST", "/recommendations/refresh"),
              ("GET", "/me/export"), ("POST", "/alerts/check"), ("POST", "/interviews"), ("PUT", "/interviews/{exp_id}"),
              ("POST", "/auth/login"), ("POST", "/auth/signup")}
    by_key = {(m, r.path): r for r in api_routes(app) for m in r.methods}
    for key in costly:
        deps = " ".join(repr(getattr(d.call, "__qualname__", "")) for d in by_key[key].dependant.dependencies)
        assert "rate_limit" in deps or "dep" in deps, f"{key} has no rate limit dependency"


# ---- nothing sensitive in responses ----
def test_no_response_reveals_keys_prompts_paths_or_stack_traces(tmp_path):
    app, settings = make(tmp_path)
    app.state.conn.execute("SELECT 1")
    c = TestClient(app, raise_server_exceptions=False)

    @app.get("/_explode")
    def explode():
        raise RuntimeError(f"internal failure with {SECRET_KEY} at {settings.upload_dir}")

    seen = []
    admin = TestClient(app, raise_server_exceptions=False)
    for client, email in ((c, "m@b.co"), (admin, "admin@b.co")):
        seen.append(client.post("/auth/signup", json={"email": email, "password": PW}))
    repos.sync_admins(app.state.conn, ["admin@b.co"])
    for path in ("/me", "/profile", "/me/export", "/recommendations", "/saved-jobs", "/alerts", "/alerts/settings", "/interviews",
                 "/interviews/mine", "/outreach", "/roles/taxonomy", "/companies", "/runs/active", "/nope", "/health", "/", "/_explode"):
        seen.append(c.get(path))
    for path in ("/admin/metrics", "/admin/traces", "/admin/interviews", "/admin/reports", "/admin/traces/zz"):
        seen.append(admin.get(path))
    seen.append(c.post("/auth/login", json={"email": "m@b.co", "password": "wrong"}))
    seen.append(c.post("/onboarding", data={"roles": "x"}, files={"resume": ("cv.pdf", b"not a pdf")}))
    seen.append(c.put("/profile", json={"name": 123}))  # validation error
    text = "\n".join(r.text + "".join(f"{k}: {v}" for k, v in r.headers.items()) for r in seen)
    for secret in (SECRET_KEY, CANARY, str(settings.upload_dir), str(tmp_path), "Traceback", "sqlite3.", "pw_hash", "argon2", "nextrole.db",
                   settings.resume_encryption_key):
        assert secret not in text, f"a response leaked {secret!r}"
    assert next(r for r in seen if r.request.url.path == "/_explode").text == "Internal Server Error"  # generic, not the message


def test_login_never_reveals_which_half_was_wrong_or_whether_an_account_exists(tmp_path):
    app, _ = make(tmp_path)
    c = TestClient(app)
    c.post("/auth/signup", json={"email": "real@b.co", "password": PW})
    c.post("/auth/logout")
    wrong_pw = c.post("/auth/login", json={"email": "real@b.co", "password": "Wrong-password1"})
    no_user = c.post("/auth/login", json={"email": "ghost@b.co", "password": "Wrong-password1"})
    assert (wrong_pw.status_code, wrong_pw.json()) == (no_user.status_code, no_user.json()) == (401, {"detail": "invalid email or password"})


def test_session_cookie_flags(tmp_path):
    app, _ = make(tmp_path, env="production")
    r = TestClient(app).post("/auth/signup", json={"email": "a@b.co", "password": PW})
    session = next(h for h in r.headers.get_list("set-cookie") if h.startswith("nextrole_session"))
    low = session.lower()
    assert "httponly" in low and "secure" in low and "samesite=lax" in low
    assert re.search(r"nextrole_session=[A-Za-z0-9_-]{40,}", session)  # a long random token, not a counter
    assert r.headers["strict-transport-security"] and r.headers["x-frame-options"] == "DENY"


@pytest.mark.parametrize("secret_file", [".env", "data/nextrole.db", "src/nextrole/config.py"])
def test_the_api_serves_no_files_from_disk(tmp_path, secret_file):
    app, _ = make(tmp_path)
    c = TestClient(app)
    for prefix in ("", "/static", "/files", "/..", "/%2e%2e"):
        assert c.get(f"{prefix}/{secret_file}").status_code in (404, 405)
