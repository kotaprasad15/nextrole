"""API tests: in-memory DB, mocked Anthropic client, temp upload dir. No network."""
import io
import json
from types import SimpleNamespace

import pytest
from cryptography.fernet import Fernet
from docx import Document
from fastapi.testclient import TestClient

from nextrole.api.main import create_app
from nextrole.auth.passwords import hash_password
from nextrole.config import Settings
from nextrole.db.connection import connect
from nextrole.llm.budget import Budget
from nextrole.llm.client import LLMClient

EXTRACTED = {
    "name": "Ada Lovelace",
    "skills": ["Python", "SQL"],
    "experience": [{"company": "Analytical Engines", "title": "Engineer"}],
}


class FakeAnthropic:
    def __init__(self, reply: str):
        self.reply, self.prompts = reply, []
        self.messages = SimpleNamespace(create=self._create)

    async def _create(self, **kw):
        self.prompts.append(kw["messages"][0]["content"])
        return SimpleNamespace(
            content=[SimpleNamespace(type="text", text=self.reply)],
            usage=SimpleNamespace(input_tokens=500, output_tokens=100),
        )


def docx_bytes(text: str) -> bytes:
    doc = Document()
    doc.add_paragraph(text)
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


RESUME = docx_bytes("Ada Lovelace. Python and SQL engineer at Analytical Engines. " * 3)
FORM = {"roles": "backend engineer, data engineer", "locations": "London", "remote_ok": "true"}


@pytest.fixture
def ctx(tmp_path):
    settings = Settings(
        _env_file=None, upload_dir=tmp_path / "up", resume_encryption_key=Fernet.generate_key().decode()
    )
    fake = FakeAnthropic(json.dumps(EXTRACTED))
    llm = lambda: LLMClient(settings, Budget.from_settings(settings), client=fake)
    app = create_app(settings, connect(":memory:"), llm)
    return SimpleNamespace(client=TestClient(app), fake=fake, settings=settings, app=app)


def signup(c, email="a@b.co", pw="Correct-horse9"):
    return c.post("/auth/signup", json={"email": email, "password": pw})


def test_signup_login_logout_flow(ctx):
    c = ctx.client
    assert signup(c).status_code == 201
    assert signup(c).status_code == 409
    assert c.get("/profile").status_code == 404  # authenticated, no profile yet
    c.post("/auth/logout")
    assert c.get("/profile").status_code == 401
    assert c.post("/auth/login", json={"email": "a@b.co", "password": "wrong password"}).status_code == 401
    assert c.post("/auth/login", json={"email": "nobody@b.co", "password": "wrong password"}).status_code == 401
    assert c.post("/auth/login", json={"email": "A@B.co", "password": "Correct-horse9"}).status_code == 200


def test_password_is_hashed_and_cookie_flags(ctx):
    r = signup(ctx.client)
    assert "httponly" in r.headers["set-cookie"].lower()
    row = ctx.app.state.conn.execute("SELECT pw_hash FROM users").fetchone()
    assert row["pw_hash"].startswith("$argon2") and "Correct-horse9" not in row["pw_hash"]


def test_auth_required(ctx):
    for method, path in [("get", "/profile"), ("delete", "/me")]:
        assert getattr(ctx.client, method)(path).status_code == 401


def test_onboarding_extracts_edits_and_encrypts(ctx):
    c = ctx.client
    signup(c)
    r = c.post("/onboarding", data=FORM, files={"resume": ("cv.docx", RESUME)})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["name"] == "Ada Lovelace" and body["skills"] == ["Python", "SQL"]
    assert body["preferences"]["roles"] == ["backend engineer", "data engineer"]
    assert "Ada Lovelace. Python" in ctx.fake.prompts[0]  # resume text reached the model

    stored = next(ctx.settings.upload_dir.iterdir())
    assert RESUME not in stored.read_bytes()  # encrypted at rest

    body["skills"].append("Rust")
    assert c.put("/profile", json=body).status_code == 200
    assert "Rust" in c.get("/profile").json()["skills"]


@pytest.mark.parametrize(
    ("name", "data", "msg"),
    [("x.txt", b"hello world" * 20, "unsupported"), ("x.pdf", b"", "empty")],
)
def test_bad_uploads_rejected(ctx, name, data, msg):
    signup(ctx.client)
    r = ctx.client.post("/onboarding", data=FORM, files={"resume": (name, data)})
    assert r.status_code == 422 and msg in r.json()["detail"]
    assert not ctx.fake.prompts  # never reached the LLM


def test_oversize_upload_rejected(ctx):
    ctx.settings.max_upload_mb = 0
    signup(ctx.client)
    r = ctx.client.post("/onboarding", data=FORM, files={"resume": ("cv.docx", RESUME)})
    assert r.status_code == 422 and "too large" in r.json()["detail"]


def test_missing_role_rejected(ctx):
    signup(ctx.client)
    r = ctx.client.post("/onboarding", data={"roles": " , "}, files={"resume": ("cv.docx", RESUME)})
    assert r.status_code == 422


def test_delete_account_removes_everything(ctx):
    c = ctx.client
    signup(c)
    c.post("/onboarding", data=FORM, files={"resume": ("cv.docx", RESUME)})
    assert c.delete("/me").status_code == 204
    conn = ctx.app.state.conn
    for table in ("users", "sessions", "profiles"):
        assert conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] == 0
    assert list(ctx.settings.upload_dir.iterdir()) == []
    assert c.get("/profile").status_code == 401


def test_resubmitting_onboarding_replaces_old_resume_file(ctx):
    c = ctx.client
    signup(c)
    for _ in range(2):
        c.post("/onboarding", data=FORM, files={"resume": ("cv.docx", RESUME)})
    assert len(list(ctx.settings.upload_dir.iterdir())) == 1


def test_me_and_api_root(ctx):
    c = ctx.client
    assert c.get("/me").status_code == 401
    signup(c, email="Me@B.co")
    assert c.get("/me").json() == {"email": "me@b.co"}
    # The old bundled UI is gone: / only points at the docs and the Next.js app; nothing is served statically.
    root = c.get("/")
    assert root.status_code == 200 and root.json()["docs"] == "/docs"
    assert c.get("/static/app.js").status_code == 404


@pytest.mark.parametrize(
    ("pw", "needs"),
    [
        ("Sh0rt!", "at least 8 characters"),
        ("alllowercase1!", "an uppercase letter"),
        ("ALLUPPERCASE1!", "a lowercase letter"),
        ("NoSpecialChar1", "a special character"),
        ("Has Space Only1", "a special character"),
    ],
)
def test_signup_enforces_password_policy_server_side(ctx, pw, needs):
    r = signup(ctx.client, pw=pw)
    assert r.status_code == 422 and needs in r.json()["detail"]
    assert ctx.app.state.conn.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 0


def test_signup_confirm_password_must_match_when_sent(ctx):
    body = {"email": "a@b.co", "password": "Correct-horse9", "confirm_password": "Correct-horse8"}
    assert ctx.client.post("/auth/signup", json=body).status_code == 422
    body["confirm_password"] = "Correct-horse9"
    assert ctx.client.post("/auth/signup", json=body).status_code == 201


def test_login_still_accepts_accounts_created_before_the_policy(ctx):
    pw_hash = hash_password("legacy pw")
    ctx.app.state.conn.execute("INSERT INTO users (email, pw_hash) VALUES (?, ?)", ("old@b.co", pw_hash))
    ctx.app.state.conn.commit()
    r = ctx.client.post("/auth/login", json={"email": "old@b.co", "password": "legacy pw"})
    assert r.status_code == 200


def test_profile_update_only_ever_touches_the_callers_own_profile(ctx):
    """There is no user id in the request: ownership comes from the session, so B cannot edit A."""
    a = ctx.client
    signup(a, "a@b.co")
    a.post("/onboarding", data=FORM, files={"resume": ("cv.docx", RESUME)})
    original = a.get("/profile").json()

    b = TestClient(ctx.app)
    signup(b, "b@b.co")
    assert b.put("/profile", json={**original, "name": "Mallory", "summary": "pwned"}).status_code == 200
    assert a.get("/profile").json() == original  # A's profile is untouched
    assert b.get("/profile").json()["name"] == "Mallory"

    anonymous = TestClient(ctx.app)
    assert anonymous.put("/profile", json=original).status_code == 401
    assert anonymous.get("/profile").status_code == 401
