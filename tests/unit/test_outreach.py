"""Outreach stack tests: SSRF guard, tools, researcher, critic rules, rewrite loop, API gate.

Everything is mocked: the LLM is a scripted fake, HTTP uses httpx.MockTransport, DNS is faked.
"""
import json
from types import SimpleNamespace

import httpx
import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

from nextrole.agents.critic import length_score, rule_violations
from nextrole.agents.factsheet import build_fact_sheet
from nextrole.agents.researcher import ResearcherAgent
from nextrole.api.main import create_app
from nextrole.config import Settings
from nextrole.db import repos
from nextrole.db.connection import connect
from nextrole.llm.budget import Budget
from nextrole.llm.client import LLMClient
from nextrole.models.job import Job
from nextrole.models.match import MatchResult
from nextrole.models.outreach import Claim, OutreachDraft
from nextrole.models.profile import Experience, Preferences, Profile
from nextrole.models.research import CompanyResearch, Fact
from nextrole.outreach import generate_outreach
from nextrole.tools.netguard import UnsafeURL, check_public_https
from nextrole.tools.research_tools import ResearchTools

PUBLIC = lambda host: ["93.184.216.34"]
JOB_URL = "https://boards.greenhouse.io/acme/jobs/1"
BODY = " ".join(["word"] * 100)


def job():
    return Job(source="gh", source_id="1", title="Backend Engineer", company="Acme",
               location="Remote", apply_url=JOB_URL,
               description="You will build and operate payment APIs used by thousands of merchants.")


PROFILE = Profile(
    name="Ada Lovelace", skills=["Python", "SQL"],
    experience=[Experience(company="Analytical Engines", title="Intern", bullets=["Built a REST API"])],
    preferences=Preferences(roles=["backend"]))


# ---------- scripted LLM ----------

def text(t):
    return SimpleNamespace(type="text", text=t)


def tool_use(i, name, **inp):
    return SimpleNamespace(type="tool_use", id=f"t{i}", name=name, input=inp)


class ScriptedLLM:
    """Routes on the system prompt. Writer/critic scripts reuse their last item when exhausted."""

    def __init__(self, writer, critic, extract=None, tool_steps=1):
        self.writer, self.critic, self.tool_steps = list(writer), list(critic), tool_steps
        self.extract = extract or {"summary": "Acme makes anvils.", "facts": [
            {"text": "Acme makes anvils for roadrunner hunters.", "source_id": "R1"}],
            "news_source_ids": ["R2"]}
        self.loop_calls, self.calls = 0, []
        self.messages = SimpleNamespace(create=self._create)

    @staticmethod
    def _pop(queue):
        return queue.pop(0) if len(queue) > 1 else queue[0]

    async def _create(self, **kw):
        system = kw["system"]
        self.calls.append(kw)
        if "You research a company" in system:
            self.loop_calls += 1
            content = ([tool_use(1, "company_overview", company="Acme"),
                        tool_use(2, "company_news", company="Acme")]
                       if self.loop_calls <= self.tool_steps else [text("done")])
        elif "Extract facts" in system:
            content = [text(json.dumps(self.extract))]
        elif "You write a concise" in system:
            content = [text(json.dumps(self._pop(self.writer)))]
        elif "strict reviewer" in system:
            content = [text(json.dumps(self._pop(self.critic)))]
        else:
            raise AssertionError(f"unexpected prompt: {system[:60]}")
        return SimpleNamespace(content=content, stop_reason="end_turn",
                               usage=SimpleNamespace(input_tokens=100, output_tokens=50))

    def of(self, marker):
        return [c for c in self.calls if marker in c["system"]]


def draft(facts=("F-P1",), body=BODY):
    return {"subject": "Backend role", "body": body, "claims": [{"text": "c", "fact_ids": list(facts)}]}


def verdict(score=90, unsupported=(), instructions=""):
    return {"specificity": score, "tone": score, "grounding": score, "no_fluff": score,
            "unsupported_claims": list(unsupported), "rewrite_instructions": instructions}


def http_client():
    def handler(req: httpx.Request) -> httpx.Response:
        url = str(req.url)
        if "wikipedia.org/w/api.php" in url:
            return httpx.Response(200, json={"query": {"search": [{"title": "Acme Corp"}]}})
        if "rest_v1/page/summary" in url:
            return httpx.Response(200, json={
                "type": "standard", "extract": "Acme Corp is a company that makes anvils.",
                "content_urls": {"desktop": {"page": "https://en.wikipedia.org/wiki/Acme_Corp"}}})
        if "hn.algolia.com" in url:
            return httpx.Response(200, json={"hits": [
                {"title": "Acme raises Series B", "url": "https://news.example.com/acme",
                 "created_at": "2026-10-01T00:00:00Z", "points": 50},
                {"title": "Unrelated strike news", "url": "https://x.example.com/1",
                 "created_at": "2026-10-02T00:00:00Z", "points": 100},
                {"title": "Acme low traction", "url": "https://y.example.com/1",
                 "created_at": "2026-10-02T00:00:00Z", "points": 1}]})
        return httpx.Response(404)
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


def make(fake, **settings):
    s = Settings(_env_file=None, **settings)
    llm = LLMClient(s, Budget.from_settings(s), client=fake, retry_wait=lambda *_: 0)
    return llm, s


# ---------- SSRF guard ----------

@pytest.mark.parametrize("url", [
    "http://example.com/", "https://127.0.0.1/", "https://10.0.0.5/x", "https://[::1]/",
    "https://169.254.169.254/latest/meta-data", "https://user:pw@example.com/",
    "https://example.com:8443/", "ftp://example.com/", "file:///etc/passwd"])
async def test_netguard_blocks_unsafe(url):
    with pytest.raises(UnsafeURL):
        await check_public_https(url, PUBLIC)


async def test_netguard_blocks_hostname_resolving_to_private_and_allows_public():
    with pytest.raises(UnsafeURL):
        await check_public_https("https://evil.example.com/", lambda h: ["192.168.1.10"])
    with pytest.raises(UnsafeURL):  # mixed answers: any private address is enough to refuse
        await check_public_https("https://evil.example.com/", lambda h: ["93.184.216.34", "10.0.0.1"])
    assert await check_public_https("https://example.com/p", PUBLIC) == "https://example.com/p"


# ---------- tools ----------

async def test_tools_overview_and_news_filtering():
    _, s = make(ScriptedLLM([draft()], [verdict()]))
    tools = ResearchTools(http_client(), connect(":memory:"), s, JOB_URL, PUBLIC)
    assert "[R1] Acme Corp" in await tools.call("company_overview", {"company": "Acme"})
    news = await tools.call("company_news", {"company": "Acme"})
    assert "Acme raises Series B" in news and "strike" not in news and "low traction" not in news
    assert tools.sources["R2"].url == "https://news.example.com/acme"  # URL came from the API


async def test_fetch_page_enforces_host_allowlist_and_redirect_revalidation():
    def handler(req):
        if req.url.host == "boards.greenhouse.io":
            return httpx.Response(200, text="<html><body><p>About the role</p></body></html>",
                                  headers={"content-type": "text/html"})
        if req.url.host == "allowed.example.com":
            return httpx.Response(302, headers={"location": "https://127.0.0.1/admin"})
        return httpx.Response(404)

    s = Settings(_env_file=None)
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    tools = ResearchTools(client, connect(":memory:"), s, JOB_URL, PUBLIC)
    assert "About the role" in await tools.call("fetch_page", {"url": JOB_URL})
    assert "not allowed" in await tools.call("fetch_page", {"url": "https://other.example.org/"})
    tools.allowed_hosts.add("allowed.example.com")
    assert "non-public" in await tools.call("fetch_page", {"url": "https://allowed.example.com/x"})
    assert "error" in await tools.call("fetch_page", {"url": "http://boards.greenhouse.io/x"})
    assert "unknown tool" in await tools.call("rm_rf", {})


# ---------- researcher ----------

async def test_researcher_builds_facts_from_tool_sources_only():
    fake = ScriptedLLM([draft()], [verdict()], extract={
        "summary": "s", "news_source_ids": ["R2", "R9"], "facts": [
            {"text": "Acme makes anvils.", "source_id": "R1"},
            {"text": "Made up fact.", "source_id": "R9"},  # unknown source
            {"text": "See https://evil.example.com for more", "source_id": "R1"}]})  # smuggled URL
    llm, s = make(fake)
    tools = ResearchTools(http_client(), connect(":memory:"), s, JOB_URL, PUBLIC)
    res = await ResearcherAgent(llm, s).run(job(), tools)
    assert res.facts[0].text == "Acme makes anvils."
    assert len(res.facts) == 2  # 1 valid fact + 1 news fact; the two bad ones dropped
    assert res.facts[0].source_ref == "https://en.wikipedia.org/wiki/Acme_Corp"
    assert [n.url for n in res.news] == ["https://news.example.com/acme"]
    assert all("http" not in f.text for f in res.facts)


async def test_researcher_tool_loop_is_hard_capped():
    fake = ScriptedLLM([draft()], [verdict()], tool_steps=99)  # model never stops calling tools
    llm, s = make(fake, research_max_steps=3)
    tools = ResearchTools(http_client(), connect(":memory:"), s, JOB_URL, PUBLIC)
    await ResearcherAgent(llm, s).run(job(), tools)
    assert fake.loop_calls == 3


# ---------- fact sheet & critic rules ----------

def test_fact_sheet_ids_and_no_contact_details():
    prof = PROFILE.model_copy(update={"summary": "New grad"})
    facts = build_fact_sheet(prof, job(), None)
    ids = [f.id for f in facts]
    assert len(ids) == len(set(ids)) and ids[0] == "F-P1"
    assert any(f.id.startswith("F-J") and "Backend Engineer" in f.text for f in facts)
    assert "@" not in " ".join(f.text for f in facts)


def test_rule_violations():
    facts = [Fact(id="F-P1", text="x", source="profile")]
    base = OutreachDraft(job_id="j", subject="s", body="hello", claims=[Claim(text="c", fact_ids=["F-P1"])])
    assert rule_violations(base, facts) == []
    bad = base.model_copy(update={"body": "see https://x.com [Your Name]", "subject": "",
                                  "claims": [Claim(text="c", fact_ids=["F-P9"])]})
    v = " | ".join(rule_violations(bad, facts))
    assert "URL" in v and "placeholder" in v and "F-P9" in v and "no subject" in v
    assert "no facts" in " ".join(rule_violations(base.model_copy(update={"claims": []}), facts))


def test_length_score():
    assert [length_score(w, 90, 170) for w in (90, 130, 170)] == [100, 100, 100]
    assert length_score(80, 90, 170) == 70 and length_score(400, 90, 170) == 0


# ---------- rewrite loop ----------

async def run_loop(fake, **settings):
    llm, s = make(fake, **settings)
    return await generate_outreach(
        llm=llm, settings=s, conn=connect(":memory:"), http=http_client(), profile=PROFILE, job=job())


async def test_loop_passes_first_try():
    res = await run_loop(ScriptedLLM([draft()], [verdict(90)]))
    assert res.attempts == 1 and res.report.verdict == "pass"
    assert res.draft.status == "critic_passed" and res.warnings == []


async def test_loop_rewrites_with_critic_feedback_then_passes():
    fake = ScriptedLLM(
        [draft(), draft()],
        [verdict(90, unsupported=["led a team of 10"], instructions="Remove the team claim"),
         verdict(92)])
    res = await run_loop(fake)
    assert res.attempts == 2 and res.report.verdict == "pass"
    rewrite_prompt = fake.of("You write a concise")[1]["messages"][0]["content"]
    assert "led a team of 10" in rewrite_prompt and "Remove the team claim" in rewrite_prompt


async def test_loop_stops_at_cap_keeps_best_draft_and_warns():
    fake = ScriptedLLM(
        [draft(body=" ".join(["a"] * 100)), draft(body=" ".join(["b"] * 100)),
         draft(body=" ".join(["c"] * 100)), draft(body=" ".join(["d"] * 100))],
        [verdict(60, unsupported=["x"]), verdict(70, unsupported=["x"]),
         verdict(50, unsupported=["x"]), verdict(40, unsupported=["x"])])
    res = await run_loop(fake)  # critic_max_retries defaults to 3 -> 4 drafts max
    assert res.attempts == 4 and len(fake.of("You write a concise")) == 4
    assert res.report.overall == 73  # the best draft's own report (score 70 + length 100), not the last one's
    assert res.draft.body.startswith("b")  # the second draft scored highest
    assert res.draft.status == "draft" and res.warnings
    assert "not fully satisfied" in res.warnings[-1]


async def test_loop_returns_best_when_budget_runs_out():
    fake = ScriptedLLM([draft()], [verdict(60, unsupported=["x"])])
    llm, s = make(fake, run_max_tokens=1000)  # ~150 tokens per call: runs dry mid-loop
    res = await generate_outreach(
        llm=llm, settings=s, conn=connect(":memory:"), http=http_client(), profile=PROFILE, job=job())
    # The orchestrator checks the budget between steps and saves what it has.
    assert res.attempts >= 1 and any("budget reached" in w for w in res.warnings)


async def test_loop_keeps_best_draft_when_a_rewrite_fails():
    fake = ScriptedLLM([draft(), {"not": "a valid writer reply"}],
                       [verdict(60, unsupported=["x"], instructions="fix it")])
    res = await run_loop(fake)
    assert res.attempts == 1 and res.draft.body.startswith("word")
    assert any("Stopped early" in w for w in res.warnings)


async def test_research_failure_degrades_to_job_only():
    def boom(req):
        raise httpx.ConnectError("down")

    fake = ScriptedLLM([draft()], [verdict(90)])
    llm, s = make(fake)
    http = httpx.AsyncClient(transport=httpx.MockTransport(boom))
    res = await generate_outreach(llm=llm, settings=s, conn=connect(":memory:"), http=http,
                                  profile=PROFILE, job=job())
    assert res.report.verdict == "pass"
    assert not any(f.source == "research" for f in res.facts)


# ---------- API: approval gate ----------

@pytest.fixture
def ctx(tmp_path):
    fake = ScriptedLLM([draft()], [verdict(90)])
    s = Settings(_env_file=None, upload_dir=tmp_path / "up",
                 resume_encryption_key=Fernet.generate_key().decode())
    app = create_app(
        s, connect(":memory:"),
        lambda: LLMClient(s, Budget.from_settings(s), client=fake, retry_wait=lambda *_: 0),
        http_factory=http_client)
    return SimpleNamespace(client=TestClient(app), fake=fake, conn=app.state.conn, app=app)


def user_with_match(ctx, email="a@b.co"):
    """Sign up in a fresh client, give them a profile and one recommended job."""
    c = TestClient(ctx.app)
    c.post("/auth/signup", json={"email": email, "password": "correct horse"})
    c.put("/profile", json=PROFILE.model_dump())
    uid = repos.get_user_by_email(ctx.conn, email)["id"]
    j = job()
    repos.save_jobs(ctx.conn, [j])
    repos.replace_matches(ctx.conn, uid, [MatchResult(job_id=j.id, score=80, rationale="ok")])
    return c, j


def test_outreach_requires_auth_profile_and_ownership(ctx):
    assert ctx.client.post("/outreach", json={"job_id": "x"}).status_code == 401
    ctx.client.post("/auth/signup", json={"email": "n@b.co", "password": "correct horse"})
    assert ctx.client.post("/outreach", json={"job_id": "x"}).status_code == 409  # no profile
    owner, j = user_with_match(ctx)
    other = TestClient(ctx.app)
    other.post("/auth/signup", json={"email": "o@b.co", "password": "correct horse"})
    other.put("/profile", json=PROFILE.model_dump())
    assert other.post("/outreach", json={"job_id": j.id}).status_code == 404  # not their job
    assert owner.post("/outreach", json={"job_id": j.id}).status_code == 200


def test_generate_edit_approve_flow_and_regenerate(ctx):
    c, j = user_with_match(ctx)
    d = c.post("/outreach", json={"job_id": j.id}).json()
    assert d["status"] == "critic_passed" and d["critic"]["verdict"] == "pass"
    assert d["facts_used"] and d["facts_used"][0]["id"] == "F-P1" and d["company"] == "Acme"

    assert c.put(f"/outreach/{d['id']}", json={"subject": "s", "body": "b", "recipient_email": "not-an-email"}
                 ).status_code == 422
    e = c.put(f"/outreach/{d['id']}", json={"subject": "Hi", "body": "Edited body",
                                            "recipient_email": "jane@acme.com"}).json()
    assert e["status"] == "draft" and e["critic"] is None  # edit clears the verdict

    a = c.post(f"/outreach/{d['id']}/approve").json()
    assert a["status"] == "user_approved" and a["approved_at"]
    e2 = c.put(f"/outreach/{d['id']}", json={"subject": "Hi", "body": "Edited again",
                                             "recipient_email": "jane@acme.com"}).json()
    assert e2["status"] == "draft" and e2["approved_at"] is None  # must re-approve after edits

    r = c.post("/outreach", json={"job_id": j.id}).json()  # regenerate: same record
    assert r["id"] == d["id"] and r["status"] == "critic_passed"
    assert r["recipient_email"] == "jane@acme.com" and r["approved_at"] is None
    assert c.get("/outreach").json() == [{"id": d["id"], "job_id": j.id, "status": "critic_passed"}]


def test_other_users_cannot_touch_a_draft(ctx):
    owner, j = user_with_match(ctx)
    oid = owner.post("/outreach", json={"job_id": j.id}).json()["id"]
    other = TestClient(ctx.app)
    other.post("/auth/signup", json={"email": "o@b.co", "password": "correct horse"})
    assert other.post(f"/outreach/{oid}/approve").status_code == 404
    assert other.put(f"/outreach/{oid}", json={"body": "x"}).status_code == 404
    assert other.delete(f"/outreach/{oid}").status_code == 404
    assert other.get(f"/outreach/by-job/{j.id}").status_code == 404


def test_research_is_cached_across_drafts(ctx):
    c, j = user_with_match(ctx)
    c.post("/outreach", json={"job_id": j.id})
    first = ctx.fake.loop_calls
    c.post("/outreach", json={"job_id": j.id})
    assert first > 0 and ctx.fake.loop_calls == first  # no second research run


def test_no_send_endpoint_exists_and_account_delete_removes_drafts(ctx):
    paths = [getattr(r, "path", "") for r in ctx.app.routes]
    assert not any("send" in p.lower() for p in paths)
    c, j = user_with_match(ctx)
    c.post("/outreach", json={"job_id": j.id})
    assert ctx.conn.execute("SELECT COUNT(*) FROM outreach").fetchone()[0] == 1
    c.delete("/me")
    assert ctx.conn.execute("SELECT COUNT(*) FROM outreach").fetchone()[0] == 0


def test_research_models_reject_non_https_source():
    with pytest.raises(ValueError):
        Fact(id="F-R1", text="x", source="research", source_ref="http://insecure.example.com")
    assert CompanyResearch(company_key="acme").facts == []
