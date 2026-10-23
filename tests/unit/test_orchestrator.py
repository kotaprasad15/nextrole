"""Orchestrator, events/SSE, ingest (pasted jobs), memory and feedback. All mocked."""
import asyncio
import json
from types import SimpleNamespace

import httpx
import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

from nextrole.agents.ingest import IngestAgent, IngestError, is_blocked
from nextrole.api.main import create_app
from nextrole.config import Settings
from nextrole.db import repos
from nextrole.db.connection import connect
from nextrole.llm.budget import Budget
from nextrole.llm.client import LLMClient
from nextrole.memory import StyleMemory, build_style_memory, render_memory
from nextrole.models.job import Job
from nextrole.models.match import MatchResult
from nextrole.models.profile import Preferences, Profile
from nextrole.orchestrator.events import EventSink
from nextrole.orchestrator.graph import PLANS, decide, run_graph
from nextrole.orchestrator.state import Deps
from nextrole.sources.registry import DiscoveryResult

PUBLIC = lambda host: ["93.184.216.34"]
PROFILE = Profile(name="Ada Lovelace", skills=["Python", "SQL"],
                  preferences=Preferences(roles=["backend"], experience_level="Intern / New grad"))
BODY = " ".join(["word"] * 100)
POSTING = ("Backend Engineer at Initech. Remote friendly. You will build Python APIs and "
           "maintain SQL databases for our payments platform. " * 4)


def job(i=1, company="Acme", title="Backend Engineer"):
    return Job(source="gh", source_id=str(i), title=title, company=company, location="Remote",
               apply_url=f"https://boards.greenhouse.io/x/jobs/{i}",
               description="You will build payment APIs used by thousands of merchants.")


# ---------------- a fake model that serves every agent ----------------

class FullFake:
    """Routes on the system prompt so one fake can run any pipeline end to end."""

    def __init__(self, posting=None, writer=None, critic=None):
        self.posting = posting or {"is_job_posting": True, "title": "Backend Engineer",
                                   "company": "Initech", "location": "Remote", "remote": True,
                                   "description": "Build Python APIs."}
        self.writer = writer or [{"subject": "Hello", "body": BODY,
                                  "claims": [{"text": "c", "fact_ids": ["F-P1"]}]}]
        self.critic = critic or [{"specificity": 90, "tone": 90, "grounding": 90, "no_fluff": 90,
                                  "unsupported_claims": [], "rewrite_instructions": ""}]
        self.calls: list[dict] = []
        self.messages = SimpleNamespace(create=self._create)

    @staticmethod
    def _pop(q):
        return q.pop(0) if len(q) > 1 else q[0]

    async def _create(self, **kw):
        system, user = kw["system"], kw["messages"][0]["content"]
        self.calls.append({"system": system, "user": user})
        if "extract a job posting" in system:
            body = self.posting
        elif "Classify each company" in system:
            names = [ln[2:] for ln in user.splitlines() if ln.startswith("- ")]
            body = {"items": [{"company": n, "tier": "mid", "confidence": 0.9} for n in names]}
        elif "score how well a job fits" in system:
            body = {"score": 80, "strengths": ["Python"], "gaps": [], "rationale": "Good fit."}
        elif "You research a company" in system:
            return self._resp([SimpleNamespace(type="text", text="DONE")])
        elif "You write a concise" in system:
            body = self._pop(self.writer)
        elif "strict reviewer" in system:
            body = self._pop(self.critic)
        else:
            raise AssertionError(f"unexpected prompt: {system[:60]}")
        return self._resp([SimpleNamespace(type="text", text=json.dumps(body))])

    @staticmethod
    def _resp(content):
        return SimpleNamespace(content=content, stop_reason="end_turn",
                               usage=SimpleNamespace(input_tokens=100, output_tokens=50))

    def prompts(self, marker):
        return [c for c in self.calls if marker in c["system"]]


def make_llm(fake, **settings):
    s = Settings(_env_file=None, **settings)
    return LLMClient(s, Budget.from_settings(s), client=fake, retry_wait=lambda *_: 0), s


def idle_http():
    return httpx.AsyncClient(transport=httpx.MockTransport(lambda req: httpx.Response(404)))


async def fake_discover(boards, prefs, **_):
    return DiscoveryResult(jobs=[job(1, "Google"), job(2, "TinyCo"), job(3, "MidCo")],
                           errors={"lever:x": "boom"})


def deps_for(fake, discover=fake_discover, **settings):
    llm, s = make_llm(fake, **settings)
    return Deps(llm=llm, settings=s, conn=connect(":memory:"), http=idle_http(), discover=discover,
                boards_loader=list)


# ---------------- decide(): the router ----------------

def route(state, **kw):
    kw = {"max_steps": 30, "max_rewrites": 3, "budget_exhausted": False, **kw}
    return decide({"plan": PLANS["outreach"], "mode": "outreach", **state}, **kw)


def test_decide_walks_the_plan_and_finishes():
    assert route({})[0] == "research"
    assert route({"last": "research"})[0] == "facts"
    assert route({"last": "facts"})[0] == "write"
    assert route({"last": "write"})[0] == "critic"
    assert route({"last": "save"})[0] == "finalize"


def test_decide_critic_loop_cap_and_exits():
    revise = {"last": "critic", "passed": False, "rewrites": 0}
    assert route(revise)[0] == "write" and route(revise)[1]["rewrites"] == 1
    assert route({**revise, "rewrites": 3})[0] == "save"  # cap reached
    assert route({**revise, "passed": True})[0] == "save"
    assert route({**revise, "stop_loop": True})[0] == "save"
    assert route({"last": "write", "stop_loop": True})[0] == "save"  # never re-review a stale draft


def test_decide_step_limit_and_abort():
    nxt, upd = route({"last": "facts", "steps": 30})
    assert nxt == "finalize" and upd["abort"] and "step limit" in upd["error"]
    assert route({"abort": True})[0] == "finalize"


def test_decide_budget_exhausted_saves_partial_or_aborts():
    nxt, upd = route({"last": "critic", "best": (1, 2)}, budget_exhausted=True)
    assert nxt == "save" and "budget" in upd["warnings"][0]
    nxt, upd = route({"last": "research"}, budget_exhausted=True)
    assert nxt == "finalize" and upd["error_kind"] == "budget"
    state = {"plan": PLANS["recommend"], "mode": "recommend", "last": "match", "matches": [1]}
    assert decide(state, max_steps=30, max_rewrites=3, budget_exhausted=True)[0] == "save"


# ---------------- events ----------------

async def test_event_sink_replays_then_streams_live_and_closes():
    sink = EventSink()
    sink.emit("run_started")
    seen = []

    async def consume():
        async for ev in sink.stream():
            seen.append(ev.type)

    task = asyncio.create_task(consume())
    await asyncio.sleep(0.01)
    sink.emit("step_started", step="a")
    sink.emit("run_finished")
    sink.close()
    await asyncio.wait_for(task, 1)
    assert seen == ["run_started", "step_started", "run_finished"]
    late = [e.type async for e in sink.stream()]  # subscribing after close still replays
    assert late == seen


async def test_event_sink_heartbeat_yields_none_when_idle():
    sink = EventSink()
    gen = sink.stream(heartbeat=0.01)
    assert await gen.__anext__() is None
    sink.close()


# ---------------- graph runs ----------------

async def test_recommend_run_emits_plan_steps_and_persists():
    deps = deps_for(FullFake())
    uid = repos.create_user(deps.conn, "a@b.co", "x")
    final = await run_graph("recommend", deps, {"user_id": uid, "profile": PROFILE})
    assert final["status"] == "completed"
    assert final["result"] | {"warnings": []} == {
        "warnings": [], "discovered": 3, "candidates": 3, "matched": 3, "source_errors": {"lever:x": "boom"}}
    types = [(e.type, e.step) for e in deps.sink.events]
    assert types[0] == ("run_started", "") and types[1] == ("plan", "")
    finished = [e.step for e in deps.sink.events if e.type == "step_finished"]
    assert finished == PLANS["recommend"]
    assert deps.sink.events[-1].tokens > 0  # cumulative usage rides on events
    assert len(repos.list_matches(deps.conn, uid)) == 3


async def test_step_failure_aborts_run_without_leaking_internals():
    async def broken(*_a, **_k):
        raise RuntimeError("secret internal detail: /etc/passwd")

    deps = deps_for(FullFake(), discover=broken)
    final = await run_graph("recommend", deps, {"user_id": 1, "profile": PROFILE})
    assert final["status"] == "failed" and "RuntimeError" in final["result"]["error"]
    assert "secret" not in json.dumps(final["result"])
    assert [e.type for e in deps.sink.events][-1] == "step_failed"


async def test_hard_step_cap_stops_a_runaway_loop():
    deps = deps_for(FullFake(), run_max_steps=2)
    uid = repos.create_user(deps.conn, "a@b.co", "x")
    final = await run_graph("recommend", deps, {"user_id": uid, "profile": PROFILE})
    assert final["status"] == "failed" and "step limit" in final["result"]["error"]


async def test_single_job_run_ingests_pins_and_drafts():
    fake = FullFake()
    deps = deps_for(fake)
    uid = repos.create_user(deps.conn, "a@b.co", "x")
    final = await run_graph("single_job", deps, {
        "user_id": uid, "profile": PROFILE, "text": POSTING, "url": "https://initech.example.com/jobs/7",
        "channel": "email"})
    assert final["status"] == "completed", final["result"]
    steps = [e.step for e in deps.sink.events if e.type == "step_finished"]
    assert steps == ["ingest", "tier", "match", "pin", "research", "facts", "write", "critic", "save"]
    assert final["job"].source == "pasted" and final["job"].apply_url == "https://initech.example.com/jobs/7"
    (_, _, tier), = [(j, m, t) for j, m, t in repos.list_matches(deps.conn, uid)]
    assert tier == "mid"  # pasted job shows on the dashboard under its tier
    assert repos.get_outreach(deps.conn, uid, final["result"]["outreach_id"])["status"] == "critic_passed"


async def test_single_job_bad_posting_fails_cleanly_with_readable_error():
    deps = deps_for(FullFake(posting={"is_job_posting": False}))
    final = await run_graph("single_job", deps, {"user_id": 1, "profile": PROFILE, "text": POSTING})
    assert final["status"] == "failed" and "doesn't look like a single job posting" in final["result"]["error"]


# ---------------- ingest ----------------

def ingest_agent(fake, handler=None):
    llm, s = make_llm(fake)
    http = httpx.AsyncClient(transport=httpx.MockTransport(handler or (lambda r: httpx.Response(404))))
    return IngestAgent(llm, s, http, PUBLIC), fake


async def test_ingest_text_only_has_no_apply_link_and_is_idempotent():
    agent, _ = ingest_agent(FullFake())
    a, b = await agent.run(text=POSTING), await agent.run(text=POSTING)
    assert a.apply_url is None and a.source == "pasted" and a.id == b.id
    assert a.company == "Initech"


async def test_ingest_url_is_fetched_through_guard_and_becomes_apply_url():
    html = "<html><body><h1>Backend Engineer</h1><p>" + POSTING + "</p></body></html>"
    agent, fake = ingest_agent(FullFake(), lambda r: httpx.Response(
        200, text=html, headers={"content-type": "text/html"}))
    j = await agent.run(url="https://initech.example.com/careers/7")
    assert j.apply_url == "https://initech.example.com/careers/7"
    assert "Backend Engineer" in fake.calls[0]["user"]


@pytest.mark.parametrize("url", ["https://www.linkedin.com/jobs/view/1", "https://uk.indeed.com/viewjob?jk=1",
                                 "https://www.naukri.com/job-listings-x"])
async def test_ingest_refuses_blocked_sites_without_fetching(url):
    assert is_blocked(url)
    agent, fake = ingest_agent(FullFake())
    with pytest.raises(IngestError, match="Paste"):
        await agent.run(url=url)
    assert fake.calls == []  # nothing fetched, nothing sent to the model


async def test_ingest_text_with_linkedin_link_is_allowed_because_we_never_fetch_it():
    agent, _ = ingest_agent(FullFake())
    j = await agent.run(url="https://www.linkedin.com/jobs/view/1", text=POSTING)
    assert j.apply_url == "https://www.linkedin.com/jobs/view/1"


@pytest.mark.parametrize(("kwargs", "msg"), [
    ({}, "Paste a job posting"),
    ({"url": "http://insecure.example.com/x", "text": POSTING}, "https"),
    ({"url": "https://127.0.0.1/admin"}, "Couldn't open"),
])
async def test_ingest_user_errors(kwargs, msg):
    agent, _ = ingest_agent(FullFake())
    with pytest.raises(IngestError, match=msg):
        await agent.run(**kwargs)


async def test_ingest_missing_company_asks_user():
    agent, _ = ingest_agent(FullFake(posting={"is_job_posting": True, "title": "Eng", "company": ""}))
    with pytest.raises(IngestError, match="which company"):
        await agent.run(text=POSTING)


# ---------------- memory ----------------

def seed_outreach(conn, uid, j, status, body="Old approved body"):
    from nextrole.models.outreach import Claim, CriticReport, OutreachDraft
    repos.save_jobs(conn, [j])
    repos.replace_matches(conn, uid, [MatchResult(job_id=j.id, score=80, rationale="ok")]) \
        if not repos.list_matches(conn, uid) else None
    d = OutreachDraft(job_id=j.id, subject="s", body=body, claims=[Claim(text="c", fact_ids=["F-P1"])])
    rep = CriticReport(scores={}, overall=90, verdict="pass")
    oid = repos.upsert_outreach(conn, uid, j.id, d, rep, [], [], 1)
    if status == "user_approved":
        repos.approve_outreach(conn, uid, oid)
    return oid


def test_memory_collects_notes_and_approved_examples_only():
    conn = connect(":memory:")
    s = Settings(_env_file=None)
    uid = repos.create_user(conn, "a@b.co", "x")
    o1 = seed_outreach(conn, uid, job(1), "user_approved", "Approved body one")
    o2 = seed_outreach(conn, uid, job(2), "draft", "Unapproved body")
    repos.save_feedback(conn, uid, o1, -1, "Too   formal,\nshorter please")
    repos.save_feedback(conn, uid, o2, 1, "")  # rating without a note adds nothing
    mem = build_style_memory(conn, s, uid, exclude_job_id=job(2).id)
    assert mem.notes == ["(disliked) Too formal, shorter please"]
    assert mem.examples == ["Approved body one"]  # unapproved drafts are never examples
    assert build_style_memory(conn, s, uid, exclude_job_id=job(1).id).examples == []  # not the same job
    assert not build_style_memory(conn, s, repos.create_user(conn, "c@d.co", "x"))  # per-user


async def test_writer_prompt_carries_style_memory_but_warns_against_facts():
    fake = FullFake()
    deps = deps_for(fake)
    uid = repos.create_user(deps.conn, "a@b.co", "x")
    o = seed_outreach(deps.conn, uid, job(9), "user_approved", "Hi Sam, quick intro from Ada")
    repos.save_feedback(deps.conn, uid, o, 1, "I like short, direct openings")
    await run_graph("outreach", deps, {"user_id": uid, "profile": PROFILE, "job": job(1)})
    prompt = fake.prompts("You write a concise")[0]["user"]
    assert "I like short, direct openings" in prompt and "Hi Sam, quick intro from Ada" in prompt
    assert "Do NOT reuse any facts" in prompt
    assert render_memory(StyleMemory()).count("Feedback") == 0


async def test_memory_cannot_smuggle_facts_critic_still_flags_unsupported():
    """Memory is style-only: a claim copied from an old draft is judged against the CURRENT
    fact sheet, so the critic's unsupported-claim verdict still forces a rewrite."""
    fake = FullFake(critic=[
        {"specificity": 90, "tone": 90, "grounding": 40, "no_fluff": 90,
         "unsupported_claims": ["worked at OldCo"], "rewrite_instructions": "drop OldCo"},
        {"specificity": 90, "tone": 90, "grounding": 90, "no_fluff": 90,
         "unsupported_claims": [], "rewrite_instructions": ""}])
    deps = deps_for(fake)
    final = await run_graph("outreach", deps, {"user_id": 0, "profile": PROFILE, "job": job(1), "persist": False})
    assert final["attempts"] == 2 and final["passed"]


# ---------------- API: runs, SSE, feedback ----------------

class Ctx:
    pass


@pytest.fixture
def api(tmp_path):
    ctx = Ctx()
    ctx.fake = FullFake()
    ctx.settings = Settings(_env_file=None, upload_dir=tmp_path / "up",
                            resume_encryption_key=Fernet.generate_key().decode())
    ctx.gate = None

    async def discover(boards, prefs, **_):
        if ctx.gate is not None:
            await ctx.gate.wait()
        return await fake_discover(boards, prefs)

    ctx.discover = discover
    ctx.app = create_app(
        ctx.settings, connect(":memory:"),
        lambda: LLMClient(ctx.settings, Budget.from_settings(ctx.settings), client=ctx.fake,
                          retry_wait=lambda *_: 0),
        discover=discover,
        http_factory=lambda: httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(404))))
    return ctx


def signup(c, email="a@b.co"):
    c.post("/auth/signup", json={"email": email, "password": "Correct-horse9"})
    c.put("/profile", json=PROFILE.model_dump())


def sse_events(c, run_id):
    with c.stream("GET", f"/runs/{run_id}/events") as r:
        assert r.headers["content-type"].startswith("text/event-stream")
        return [json.loads(line[6:]) for line in r.iter_lines() if line.startswith("data: ")]


def test_run_recommend_streams_events_and_records_history(api):
    with TestClient(api.app) as c:
        signup(c)
        run_id = c.post("/runs", json={"mode": "recommend"}).json()["run_id"]
        events = sse_events(c, run_id)  # blocks until run_finished
        assert events[0]["type"] == "run_started" and events[-1]["type"] == "run_finished"
        assert [e["step"] for e in events if e["type"] == "step_finished"] == PLANS["recommend"]
        assert events[-1]["data"]["status"] == "completed" and events[-1]["data"]["result"]["matched"] == 3

        # Run history is internal now (no list/detail routes for users); the row is still stored for replay and budgets.
        assert c.get("/runs").status_code in (404, 405) and c.get(f"/runs/{run_id}").status_code == 404
        row = api.app.state.conn.execute("SELECT status, tokens, events_json FROM runs WHERE id = ?", (run_id,)).fetchone()
        assert row["status"] == "completed" and row["tokens"] > 0 and json.loads(row["events_json"])[-1]["type"] == "run_finished"
        assert c.get("/runs/active").json() == {"run_id": None, "mode": None}
        assert sse_events(c, run_id) == events  # finished runs replay from history
        assert sum(len(v) for v in c.get("/recommendations").json().values()) == 3


def test_runs_are_private_and_validated(api):
    with TestClient(api.app) as c, TestClient(api.app) as other:
        assert c.post("/runs", json={"mode": "recommend"}).status_code == 401
        signup(c)
        assert c.post("/runs", json={"mode": "single_job"}).status_code == 422
        assert c.post("/runs", json={"mode": "outreach", "job_id": "nope"}).status_code == 404
        assert c.post("/runs", json={"mode": "bogus"}).status_code == 422
        run_id = c.post("/runs", json={"mode": "recommend"}).json()["run_id"]
        sse_events(c, run_id)
        other.post("/auth/signup", json={"email": "o@b.co", "password": "Correct-horse9"})
        assert other.get(f"/runs/{run_id}/events").status_code == 404


def test_one_active_run_per_user(api):
    with TestClient(api.app) as c:
        signup(c)

        async def make_gate():
            return asyncio.Event()

        api.gate = c.portal.call(make_gate)  # holds the first run open
        first = c.post("/runs", json={"mode": "recommend"})
        assert first.status_code == 202
        assert c.post("/runs", json={"mode": "recommend"}).status_code == 409
        c.portal.call(api.gate.set)
        sse_events(c, first.json()["run_id"])
        assert c.post("/runs", json={"mode": "recommend"}).status_code == 202  # free again


def test_single_job_run_via_api_then_feedback_and_memory_loop(api):
    with TestClient(api.app) as c:
        signup(c)
        run_id = c.post("/runs", json={"mode": "single_job", "text": POSTING,
                                       "url": "https://initech.example.com/jobs/7"}).json()["run_id"]
        events = sse_events(c, run_id)
        final = events[-1]["data"]
        assert final["status"] == "completed" and final["result"]["job_id"]
        job_id = final["result"]["job_id"]

        card = next(x for v in c.get("/recommendations").json().values() for x in v if x["job_id"] == job_id)
        assert card["pasted"] and card["apply_url"] == "https://initech.example.com/jobs/7"

        draft = c.get(f"/outreach/by-job/{job_id}").json()
        assert draft["status"] == "critic_passed" and draft["feedback"] is None
        fb = c.post(f"/outreach/{draft['id']}/feedback", json={"rating": -1, "note": "Too stiff"}).json()
        assert fb["feedback"] == {"rating": -1, "note": "Too stiff"}
        assert c.post(f"/outreach/{draft['id']}/feedback", json={"rating": 5}).status_code == 422

        # The next draft (a different job) is written with that feedback in its prompt.
        sse_events(c, c.post("/runs", json={"mode": "recommend"}).json()["run_id"])
        other = next(x for v in c.get("/recommendations").json().values() for x in v if x["job_id"] != job_id)
        rid = c.post("/runs", json={"mode": "outreach", "job_id": other["job_id"]}).json()["run_id"]
        sse_events(c, rid)
        assert "Too stiff" in api.fake.prompts("You write a concise")[-1]["user"]


def test_pasted_job_survives_a_recommendation_refresh(api):
    with TestClient(api.app) as c:
        signup(c)
        sse_events(c, c.post("/runs", json={"mode": "single_job", "text": POSTING}).json()["run_id"])
        sse_events(c, c.post("/runs", json={"mode": "recommend"}).json()["run_id"])
        cards = [x for v in c.get("/recommendations").json().values() for x in v]
        assert sum(x["pasted"] for x in cards) == 1 and len(cards) == 4
        assert next(x for x in cards if x["pasted"])["apply_url"] is None  # text-only: no link invented


def test_delete_account_removes_runs_and_feedback(api):
    with TestClient(api.app) as c:
        signup(c)
        sse_events(c, c.post("/runs", json={"mode": "single_job", "text": POSTING}).json()["run_id"])
        d = c.get("/outreach").json()[0]
        c.post(f"/outreach/{d['id']}/feedback", json={"rating": 1, "note": "nice"})
        assert c.delete("/me").status_code == 204
        for table in ("runs", "feedback", "outreach", "matches"):
            assert api.app.state.conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] == 0


def test_restart_marks_orphaned_runs_failed(tmp_path):
    conn = connect(":memory:")
    uid = repos.create_user(conn, "a@b.co", "x")
    repos.create_run(conn, "r1", uid, "recommend")
    s = Settings(_env_file=None)
    create_app(s, conn, lambda: None)  # startup sweep
    row = conn.execute("SELECT status, error FROM runs WHERE id = 'r1'").fetchone()
    assert (row["status"], row["error"]) == ("failed", "server restarted")
