"""Privacy: no plaintext PII at rest, no PII in traces, export is the owner's own data, deletion is total."""
import base64
import json

from fastapi.testclient import TestClient
from tests.unit.test_api import FORM, RESUME, ctx, signup  # noqa: F401  (ctx is a fixture)

from nextrole.db import repos
from nextrole.models.job import Job
from nextrole.models.match import MatchResult
from nextrole.tracing.redact import redact, scrub_pii
from nextrole.tracing.tracer import Tracer


def onboard(client, email="a@b.co"):
    signup(client, email)
    assert client.post("/onboarding", data=FORM, files={"resume": ("cv.docx", RESUME)}).status_code == 200


# ---- at rest ----
def test_profile_and_resume_are_never_plaintext_in_the_database_or_upload_dir(ctx):  # noqa: F811
    onboard(ctx.client)
    raw_db = ctx.app.state.conn.serialize()
    assert b"Ada Lovelace" not in raw_db and b"Analytical Engines" not in raw_db
    for f in ctx.settings.upload_dir.iterdir():
        assert b"Ada Lovelace" not in f.read_bytes() and b"Analytical" not in f.read_bytes()


# ---- traces and logs ----
def test_redaction_masks_pii_inside_ordinary_strings_and_drops_prefixes():
    out = redact({"detail": "contact ada@example.com or +44 20 7946 0958", "k": "sk-ant-api03-ABCDEFGHIJKLMNOP"})
    assert "ada@" not in out["detail"] and "7946" not in out["detail"] and "<email>" in out["detail"]
    assert out["k"] == "<secret>"
    long = redact({"x": "Ada Lovelace ada@example.com " * 20})
    assert "Ada" not in long["x"] and "ada@" not in long["x"] and "len=" in long["x"]
    assert scrub_pii("ok") == "ok"


def test_trace_files_contain_no_resume_text_email_or_phone(tmp_path):
    tracer = Tracer(tmp_path, "run1")
    tracer.record("intake", {"user": "RESUME: Ada Lovelace ada@example.com 07700 900123 " * 10, "email": "ada@example.com"},
                  {"name": "Ada Lovelace", "note": "call +1 415 555 0100"}, latency_ms=3)
    text = (tmp_path / "run1.jsonl").read_text()
    for secret in ("Ada Lovelace", "ada@example.com", "900123", "415 555"):
        assert secret not in text


# ---- export ----
def test_export_returns_the_callers_own_decrypted_data_only(ctx):  # noqa: F811
    a = ctx.client
    onboard(a, "a@b.co")
    b = TestClient(ctx.app)
    signup(b, "b@b.co")  # no profile for B
    export = a.get("/me/export")
    assert export.status_code == 200 and "attachment" in export.headers["content-disposition"]
    data = export.json()
    assert data["account"]["email"] == "a@b.co" and data["profile"]["name"] == "Ada Lovelace"
    assert base64.b64decode(data["resume_file"]["content_base64"])[:2] == b"PK"  # the (sanitized) DOCX
    assert "password" not in json.dumps(data).lower() and "pw_hash" not in json.dumps(data)
    other = b.get("/me/export").json()
    assert other["account"]["email"] == "b@b.co" and other["profile"] is None and other["resume_file"] is None
    assert TestClient(ctx.app).get("/me/export").status_code == 401


# ---- deletion ----
def test_deleting_an_account_removes_every_trace_of_the_user(ctx):  # noqa: F811
    c = ctx.client
    onboard(c)
    conn = ctx.app.state.conn
    uid = conn.execute("SELECT id FROM users").fetchone()["id"]
    pasted = Job(source="pasted", source_id="p1", title="Eng", company="Acme", description="my pasted text",
                 apply_url="https://acme.com/jobs/1")
    repos.save_jobs(conn, [pasted])
    repos.add_pinned_match(conn, uid, MatchResult(job_id=pasted.id, score=80, strengths=[], gaps=[], rationale="ok"))
    repos.create_run(conn, "run-abc", uid, "recommend")
    trace = ctx.settings.trace_dir / "run-abc.jsonl"
    trace.parent.mkdir(parents=True, exist_ok=True)
    trace.write_text("{}")
    ctx.settings.trace_dir  # noqa: B018

    assert c.delete("/me").status_code == 204

    tables = [r["name"] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")]
    for table in tables:
        cols = {r["name"] for r in conn.execute(f"PRAGMA table_info({table})")}
        if "user_id" in cols:
            assert conn.execute(f"SELECT COUNT(*) FROM {table} WHERE user_id = ?", (uid,)).fetchone()[0] == 0, table
    assert conn.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 0
    assert conn.execute("SELECT COUNT(*) FROM jobs WHERE json_extract(job_json, '$.source') = 'pasted'").fetchone()[0] == 0
    assert list(ctx.settings.upload_dir.iterdir()) == [] and not trace.exists()
    assert c.get("/me").status_code == 401 and c.get("/me/export").status_code == 401
    assert c.post("/auth/login", json={"email": "a@b.co", "password": "Correct-horse9"}).status_code == 401
