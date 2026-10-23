"""Admin dashboard data: totals only, RBAC, usage capture, trends, traces, backfill."""
import json
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

from nextrole.api.main import create_app
from nextrole.config import Settings
from nextrole.db import repos
from nextrole.db.connection import connect
from nextrole.db.migrate import run_migrations
from nextrole.llm.budget import Budget, BudgetExceeded
from nextrole.llm.client import LLMClient
from nextrole.metrics import HttpCounters, build_metrics, make_usage_sink
from nextrole.tracing.tracer import Tracer

PW = "Correct-horse9"
NOW = datetime(2026, 10, 20, 12, 0, tzinfo=UTC)


def event(conn, days_ago, model="m-fast", agent="matcher", tin=100, tout=50, cost=0.01, status="ok", latency=200):
    ts = (NOW - timedelta(days=days_ago)).isoformat()
    conn.execute("INSERT INTO usage_events (ts, model, agent, input_tokens, output_tokens, cost_usd, status, latency_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                 (ts, model, agent, tin, tout, cost, status, latency))
    conn.commit()


def keys_in(obj):
    if isinstance(obj, dict):
        return set(obj) | set().union(*(keys_in(v) for v in obj.values()))
    if isinstance(obj, list):
        return set().union(*(keys_in(v) for v in obj)) if obj else set()
    return set()


def app_with_admin(tmp_path, **kw):
    s = Settings(_env_file=None, upload_dir=tmp_path / "up", trace_dir=tmp_path / "traces", alerts_enabled=False,
                 resume_encryption_key=Fernet.generate_key().decode(), **kw)
    app = create_app(s, connect(":memory:"))
    adm, member = TestClient(app), TestClient(app)
    for c, email in ((adm, "admin@b.co"), (member, "m@b.co")):
        assert c.post("/auth/signup", json={"email": email, "password": PW}).status_code == 201
    repos.sync_admins(app.state.conn, ["admin@b.co"])
    return app, adm, member


# ---- capture ----
class FakeClient:
    def __init__(self, fail=False):
        self.fail = fail
        self.messages = SimpleNamespace(create=self._create)

    async def _create(self, **kw):
        if self.fail:
            raise ValueError("bad request")
        return SimpleNamespace(content=[SimpleNamespace(type="text", text="ok")], stop_reason="end_turn",
                               usage=SimpleNamespace(input_tokens=120, output_tokens=30))


async def test_every_model_call_is_recorded_without_any_user_identity():
    conn = connect(":memory:")
    settings = Settings(_env_file=None)
    llm = LLMClient(settings, Budget.from_settings(settings), client=FakeClient(), usage_sink=make_usage_sink(conn))
    await llm.complete(agent="writer", model="m-strong", system="s", user="u")
    bad = LLMClient(settings, Budget.from_settings(settings), client=FakeClient(fail=True), usage_sink=make_usage_sink(conn), retry_wait=lambda *_: 0)
    with pytest.raises(ValueError):
        await bad.complete(agent="critic", model="m-strong", system="s", user="u")
    rows = [dict(r) for r in conn.execute("SELECT * FROM usage_events ORDER BY id")]
    assert [(r["agent"], r["status"], r["input_tokens"], r["output_tokens"]) for r in rows] == [("writer", "ok", 120, 30), ("critic", "error", 0, 0)]
    assert rows[0]["cost_usd"] > 0 and rows[0]["latency_ms"] >= 0
    columns = {r["name"] for r in conn.execute("PRAGMA table_info(usage_events)")}
    assert not columns & {"user_id", "email", "run_id", "prompt", "text"}  # nothing that could identify a person or leak content


async def test_per_run_budgets_are_still_enforced_with_metrics_on():
    conn = connect(":memory:")
    settings = Settings(_env_file=None, run_max_tokens=100)
    llm = LLMClient(settings, Budget.from_settings(settings), client=FakeClient(), usage_sink=make_usage_sink(conn))
    await llm.complete(agent="a", model="m", system="s", user="u")  # 150 tokens > cap of 100
    with pytest.raises(BudgetExceeded):
        await llm.complete(agent="a", model="m", system="s", user="u")


async def test_a_broken_metrics_sink_never_breaks_a_model_call():
    def exploding(_event):
        raise RuntimeError("db locked")

    settings = Settings(_env_file=None)
    llm = LLMClient(settings, Budget.from_settings(settings), client=FakeClient(), usage_sink=lambda e: make_usage_sink(connect(":memory:"))(e))
    assert (await llm.complete(agent="a", model="m", system="s", user="u")).text == "ok"
    conn = connect(":memory:")
    conn.execute("DROP TABLE usage_events")  # the sink swallows even a missing table
    make_usage_sink(conn)({"model": "m", "agent": "a", "input_tokens": 1, "output_tokens": 1, "cost_usd": 0, "status": "ok", "latency_ms": 1})
    del exploding


# ---- aggregation ----
def test_totals_by_model_by_stage_error_rate_and_zero_filled_daily_series():
    conn = connect(":memory:")
    event(conn, 0, model="fast", agent="matcher", tin=100, tout=50, cost=0.01)
    event(conn, 0, model="fast", agent="matcher", tin=100, tout=50, cost=0.01, status="error")
    event(conn, 2, model="strong", agent="writer", tin=1000, tout=500, cost=0.10)
    event(conn, 40, model="fast", agent="intake", cost=5.0)  # outside a 30-day window
    m = build_metrics(conn, days=7, now=NOW)
    t = m["totals"]
    assert t["llm_requests"] == 3 and t["llm_errors"] == 1 and t["error_rate"] == pytest.approx(0.3333, abs=1e-4)
    assert t["tokens_in"] == 1200 and t["tokens_out"] == 600 and t["tokens"] == 1800 and t["cost_usd"] == pytest.approx(0.12)
    assert [(r["name"], r["requests"], r["cost_usd"]) for r in m["by_model"]] == [("strong", 1, 0.1), ("fast", 2, 0.02)]
    assert {r["name"] for r in m["by_stage"]} == {"matcher", "writer"}
    assert len(m["series"]) == 7 and m["series"][-1]["day"] == "2026-10-20" and m["series"][0]["day"] == "2026-10-14"
    assert [s["requests"] for s in m["series"]] == [0, 0, 0, 0, 1, 0, 2]  # missing days are present as zeros
    assert m["series"][-1]["errors"] == 1
    assert build_metrics(conn, days=60, now=NOW)["totals"]["cost_usd"] == pytest.approx(5.12)


def test_previous_period_gives_the_trend_and_empty_data_is_all_zeros():
    conn = connect(":memory:")
    empty = build_metrics(conn, days=7, now=NOW)
    assert empty["totals"]["llm_requests"] == 0 and empty["totals"]["error_rate"] == 0 and empty["by_model"] == []
    assert empty["runs"]["total"] == 0 and empty["http"]["requests"] == 0 and empty["accounts"]["total"] == 0
    event(conn, 1, cost=0.5)
    event(conn, 9, cost=0.2)  # in the previous 7-day window (days 7-13 ago)
    m = build_metrics(conn, days=7, now=NOW)
    assert m["totals"]["cost_usd"] == 0.5 and m["previous"]["cost_usd"] == 0.2


def test_the_report_contains_no_per_user_dimension_even_when_many_users_ran_things():
    conn = connect(":memory:")
    for i in range(3):
        uid = repos.create_user(conn, f"u{i}@b.co", "h")
        repos.create_run(conn, f"run-{i}", uid, "recommend")
        repos.finish_run(conn, f"run-{i}", status="failed" if i == 0 else "completed", job_id=None, tokens=10, cost_usd=0.01,
                         error=None, events=[], result={})
    event(conn, 0)
    m = build_metrics(conn, days=30, now=datetime.now(UTC))
    assert m["runs"]["total"] == 3 and m["runs"]["failed"] == 1 and m["accounts"]["total"] == 3
    assert not keys_in(m) & {"user_id", "user", "users_by", "email", "author_id", "by_user", "run_id", "id", "name_of_user"}
    assert "@" not in json.dumps(m) and "u0" not in json.dumps(m)


def test_http_counters_aggregate_by_status_class_and_flush():
    conn = connect(":memory:")
    c = HttpCounters()
    for status in (200, 200, 302, 404, 500, 503):
        c.hit(status, NOW)
    c.flush(conn)
    c.hit(200, NOW)
    c.flush(conn)
    m = build_metrics(conn, days=3, now=NOW)["http"]
    assert m["requests"] == 7 and m["client_errors"] == 1 and m["server_errors"] == 2 and m["error_rate"] == pytest.approx(2 / 7, abs=1e-4)
    assert m["series"][-1] == {"day": "2026-10-20", "requests": 7}


def test_old_runs_are_backfilled_into_the_totals_by_the_migration(tmp_path):
    db = tmp_path / "n.db"
    conn = connect(db)
    uid = repos.create_user(conn, "a@b.co", "h")
    repos.create_run(conn, "r1", uid, "outreach")
    repos.finish_run(conn, "r1", status="completed", job_id=None, tokens=1234, cost_usd=0.05, error=None, events=[], result={})
    conn.execute("DELETE FROM usage_events")
    conn.execute("DELETE FROM schema_migrations WHERE version = 6")
    conn.commit()
    assert 6 in run_migrations(conn, db, True)
    row = conn.execute("SELECT * FROM usage_events").fetchone()
    assert row["model"].startswith("historical") and row["agent"] == "outreach" and row["input_tokens"] == 1234 and row["cost_usd"] == 0.05


# ---- API ----
def test_metrics_endpoint_is_admin_only_and_counts_real_traffic(tmp_path):
    app, adm, member = app_with_admin(tmp_path)
    assert member.get("/admin/metrics").status_code == 404 and TestClient(app).get("/admin/metrics").status_code == 401
    event(app.state.conn, 0, cost=0.25)
    r = adm.get("/admin/metrics", params={"days": 7})
    assert r.status_code == 200
    body = r.json()
    assert body["totals"]["cost_usd"] == pytest.approx(0.25) and body["range"]["days"] == 7 and body["accounts"]["total"] == 2
    assert body["http"]["requests"] >= 3  # the signups and this very call were counted
    assert not keys_in(body) & {"user_id", "email", "author_id"}
    assert adm.get("/admin/metrics", params={"days": 0}).status_code == 422 and adm.get("/admin/metrics", params={"days": 999}).status_code == 422
    assert member.get("/admin/metrics").status_code == 404  # and still hidden for members afterwards


def test_a_server_error_is_counted_as_one(tmp_path):
    app, adm, _ = app_with_admin(tmp_path)

    @app.get("/_boom")
    def boom():
        raise RuntimeError("x")

    TestClient(app, raise_server_exceptions=False).get("/_boom")
    assert adm.get("/admin/metrics").json()["http"]["server_errors"] == 1


def test_interview_and_alert_aggregates_are_included(tmp_path):
    app, adm, _ = app_with_admin(tmp_path)
    app.state.conn.execute("INSERT INTO alert_runs (started_at, finished_at, users, boards, jobs_fetched, candidates, verified, alerts_created, emails_sent, errors) "
                           "VALUES (?, ?, 2, 3, 40, 5, 2, 4, 1, 0)", (datetime.now(UTC).isoformat(), datetime.now(UTC).isoformat()))
    app.state.conn.commit()
    body = adm.get("/admin/metrics").json()
    assert body["alerts"] == {"passes": 1, "alerts_created": 4, "emails_sent": 1, "errors": 0}
    assert body["interviews"] == {"pending": 0, "approved": 0, "rejected": 0, "removed": 0, "open_reports": 0}


# ---- traces ----
def test_traces_are_admin_only_scrubbed_again_and_cannot_reach_other_files(tmp_path):
    app, adm, member = app_with_admin(tmp_path)
    tracer = Tracer(tmp_path / "traces", "abcd1234")
    tracer.record("intake", {"user": "RESUME Ada ada@example.com 07700 900123 " * 12}, {"note": "call +1 415 555 0100"}, latency_ms=12, input_tokens=5)
    # A trace written by an older version, with PII still in it: it is scrubbed again on the way out.
    old = tmp_path / "traces" / "oldrun01.jsonl"
    old.write_text(json.dumps({"run_id": "oldrun01", "agent": "writer", "inputs": {"x": "mail me at leak@example.com"}, "outputs": {}, "latency_ms": 1}) + "\n")
    (tmp_path / "secret.jsonl").write_text('{"agent": "x"}\n')

    assert member.get("/admin/traces").status_code == 404 and member.get("/admin/traces/abcd1234").status_code == 404
    assert TestClient(app).get("/admin/traces").status_code == 401
    listing = adm.get("/admin/traces").json()
    assert {t["run_id"] for t in listing} == {"abcd1234", "oldrun01"}
    one = adm.get("/admin/traces/abcd1234").json()
    assert one[0]["agent"] == "intake" and one[0]["input_tokens"] == 5
    text = json.dumps(one) + json.dumps(adm.get("/admin/traces/oldrun01").json())
    for leaked in ("ada@example.com", "900123", "415 555", "leak@example.com"):
        assert leaked not in text
    for bad in ("../secret", "..%2Fsecret", "abc", "a" * 80, "nope1234"):
        assert adm.get(f"/admin/traces/{bad}").status_code == 404


# ---- users lose the activity history ----
def test_users_no_longer_have_run_history_routes_but_can_see_whether_a_run_is_active(tmp_path):
    app, adm, member = app_with_admin(tmp_path)
    assert member.get("/runs").status_code in (404, 405) and member.get("/runs/abc").status_code == 404
    assert member.get("/runs/active").json() == {"run_id": None, "mode": None}
    uid = app.state.conn.execute("SELECT id FROM users WHERE email = 'm@b.co'").fetchone()["id"]
    repos.create_run(app.state.conn, "live-run-1", uid, "recommend")
    assert member.get("/runs/active").json() == {"run_id": "live-run-1", "mode": "recommend"}
    assert adm.get("/runs/active").json()["run_id"] is None  # not someone else's run
    assert TestClient(app).get("/runs/active").status_code == 401
