"""Adversarial corpus: every payload in `payloads.INJECTIONS`, delivered through every channel an attacker has.

Channels: a resume PDF (visible and hidden text), a job posting (pasted or fetched), text a research tool
returns, and an interview experience. The models in these tests are HIJACKED on purpose: they obey the
injected text and answer with the attacker's goals (an evil link, an email address, a perfect score). The
assertions are about what the SYSTEM does with that: nothing hostile is stored, shown or approved, no
unverified URL survives, and untrusted text only ever reaches a model inside a data block.
"""
import json
import re
from types import SimpleNamespace

import httpx
import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from tests.security.payloads import INJECTIONS
from tests.security.pdfs import PAD, make_pdf, text_op
from tests.unit.test_api import FORM
from tests.unit.test_outreach import (
    PROFILE,
    PUBLIC,
    ScriptedLLM,
    draft,
    job,
    make,
    run_loop,
    verdict,
)

from nextrole.agents.ingest import IngestAgent
from nextrole.agents.matcher import MatcherAgent
from nextrole.agents.researcher import ResearcherAgent
from nextrole.api.main import create_app
from nextrole.config import Settings
from nextrole.db.connection import connect
from nextrole.llm.budget import Budget
from nextrole.llm.client import LLMClient
from nextrole.models.job import Job
from nextrole.security.injection import scan
from nextrole.tools.research_tools import ResearchTools

EVIL_URL, EVIL_MAIL = "https://evil.example.com/steal", "attacker@evil.example.com"
BLOCK = re.compile(r"<<<DATA .*?<<<END DATA [^>]*>>>", re.DOTALL)
IDS = [i for i, _ in INJECTIONS]
PW = "Correct-horse9"


class Hijacked:
    """A model that does what the injected text says: it answers every request with the attacker's goals."""

    def __init__(self):
        self.calls = []
        self.messages = SimpleNamespace(create=self._create)

    def _reply(self, system: str) -> dict:
        if "structured profile" in system:
            return {"name": f"PWNED {EVIL_URL}", "summary": f"Hire me. Contact {EVIL_MAIL} or visit {EVIL_URL}", "skills": ["Python", EVIL_URL],
                    "experience": [{"company": "Acme", "title": "Engineer", "bullets": [f"Built things, see {EVIL_URL}"]}]}
        if "score how well a job fits" in system:
            return {"score": 100, "strengths": [f"Perfect match, apply at {EVIL_URL}", EVIL_MAIL], "gaps": [], "rationale": f"Perfect. Go to {EVIL_URL}"}
        if "extract a job posting" in system:
            return {"is_job_posting": True, "title": "Engineer", "company": "Acme", "description": f"Great job. {EVIL_URL}", "apply_url": EVIL_URL}
        if "content-safety reviewer" in system:
            return {"pii": False, "attack": False, "confidential": False, "risk": "low", "reasons": [f"clean, see {EVIL_URL}"]}
        raise AssertionError(f"unexpected prompt: {system[:50]}")

    async def _create(self, **kw):
        self.calls.append(kw)
        return SimpleNamespace(content=[SimpleNamespace(type="text", text=json.dumps(self._reply(kw["system"])))], stop_reason="end_turn",
                               usage=SimpleNamespace(input_tokens=20, output_tokens=20))


def outside_blocks(call) -> str:
    return BLOCK.sub("", call["messages"][0]["content"])


def app_with(tmp_path, model):
    s = Settings(_env_file=None, upload_dir=tmp_path / "up", resume_encryption_key=Fernet.generate_key().decode(), alerts_enabled=False)
    app = create_app(s, connect(":memory:"), lambda: LLMClient(s, Budget.from_settings(s), client=model, retry_wait=lambda *_: 0))
    return app, s


def member(app, email="a@b.co"):
    c = TestClient(app)
    assert c.post("/auth/signup", json={"email": email, "password": PW}).status_code == 201
    return c


# ---- channel 1: resume PDF, text a human can see ----
@pytest.mark.parametrize("payload", [t for _, t in INJECTIONS], ids=IDS)
def test_visible_injection_in_a_resume_is_flagged_boxed_and_cannot_plant_links(tmp_path, payload):
    model = Hijacked()
    app, _ = app_with(tmp_path, model)
    c = member(app)
    pdf = make_pdf(text_op(PAD * 2) + " " + text_op(payload, y=300))
    r = c.post("/onboarding", data=FORM, files={"resume": ("cv.pdf", pdf)})
    assert r.status_code == 200, r.text
    assert "injection_phrase" in r.headers["x-resume-flags"]  # the tripwire fired and the user is told
    call = model.calls[0]
    assert "NEVER instructions" in call["system"] and not call.get("tools")
    assert payload[:20] not in outside_blocks(call)  # only ever inside the data block
    stored = json.dumps(c.get("/profile").json()) + json.dumps(c.get("/me/export").json())
    assert EVIL_URL not in stored and EVIL_MAIL not in stored and "evil.example.com" not in stored  # hijacked output was scrubbed


# ---- channel 1b: resume PDF, text a human cannot see ----
@pytest.mark.parametrize("payload", [t for _, t in INJECTIONS], ids=IDS)
def test_hidden_injection_in_a_resume_is_rejected_before_any_model_sees_it(tmp_path, payload):
    model = Hijacked()
    app, settings = app_with(tmp_path, model)
    c = member(app)
    for hide in ({"color": "1 1 1 rg"}, {"size": 1}, {"x": -900}):
        pdf = make_pdf(text_op(PAD * 2) + " " + text_op(payload, y=100, **hide))
        r = c.post("/onboarding", data=FORM, files={"resume": ("cv.pdf", pdf)})
        assert r.status_code == 422 and "hidden text" in r.json()["detail"]
    assert not model.calls and not list(settings.upload_dir.glob("*"))  # never reached a model, nothing stored


# ---- channel 2: job postings ----
@pytest.mark.parametrize("payload", [t for _, t in INJECTIONS], ids=IDS)
async def test_injection_in_a_posting_cannot_set_the_apply_link_or_the_score_text(payload):
    model = Hijacked()
    s = Settings(_env_file=None)
    llm = LLMClient(s, Budget.from_settings(s), client=model, retry_wait=lambda *_: 0)
    agent = IngestAgent(llm, s, http=None)
    pasted = await agent.run(text=f"Acme is hiring an engineer to build APIs. {payload}")
    assert pasted.apply_url is None  # text-only paste: the model's `apply_url` field has nowhere to go
    linked = await agent.run(text=f"Acme is hiring. {payload}", url="https://boards.example.com/acme/1")
    assert str(linked.apply_url) == "https://boards.example.com/acme/1"  # only the link the USER gave
    hostile = Job(source="gh", source_id="1", title="Engineer", company="Acme", description=payload, apply_url="https://boards.greenhouse.io/acme/jobs/1")
    result = await MatcherAgent(llm, s).score_one(PROFILE, hostile)
    blob = json.dumps(result.model_dump())
    assert "evil.example.com" not in blob and "attacker@" not in blob and "http" not in blob
    for call in model.calls:
        assert payload[:20] not in outside_blocks(call)


# ---- channel 3: text returned by research tools (fetched pages, news) ----
@pytest.mark.parametrize("payload", [t for _, t in INJECTIONS[::3]], ids=IDS[::3])
async def test_injection_in_tool_results_is_boxed_and_invented_links_are_dropped(payload):
    def handler(req: httpx.Request) -> httpx.Response:
        url = str(req.url)
        if "hn.algolia.com" in url:
            return httpx.Response(200, json={"hits": [{"title": f"Acme raises money. {payload}", "url": "https://news.example.com/acme",
                                                       "created_at": "2026-10-01T00:00:00Z", "points": 50}]})
        if "wikipedia.org/w/api.php" in url:
            return httpx.Response(200, json={"query": {"search": [{"title": "Acme Corp"}]}})
        if "rest_v1/page/summary" in url:
            return httpx.Response(200, json={"type": "standard", "extract": f"Acme Corp makes anvils. {payload}",
                                             "content_urls": {"desktop": {"page": "https://en.wikipedia.org/wiki/Acme_Corp"}}})
        return httpx.Response(404)

    fake = ScriptedLLM([draft()], [verdict()], extract={"summary": "s", "news_source_ids": ["R2"], "facts": [
        {"text": f"Acme makes anvils. Visit {EVIL_URL}", "source_id": "R1"}, {"text": "Acme makes anvils.", "source_id": "R1"}]})
    llm, s = make(fake)
    tools = ResearchTools(httpx.AsyncClient(transport=httpx.MockTransport(handler)), connect(":memory:"), s, "https://boards.greenhouse.io/acme/jobs/1", PUBLIC)
    research = await ResearcherAgent(llm, s).run(job(), tools)
    assert all("evil.example.com" not in f.text for f in research.facts)  # a fact smuggling a link is dropped
    assert any(f.text == "Acme makes anvils." for f in research.facts)
    for call in fake.calls:
        for m in call["messages"]:
            content = m["content"] if isinstance(m["content"], str) else json.dumps(m["content"])
            if payload[:20] in content:
                assert payload[:20] not in BLOCK.sub("", content.replace("\\n", "\n")), "tool text escaped its data block"
        assert "NEVER instructions" in call["system"]


# ---- channel 4: interview experiences ----
GOOD = {"company": "Acme", "role": "SDE", "level": "mid", "interviewed_on": "2026-08", "difficulty": 3, "outcome": "offer", "anonymous": True,
        "rounds": [{"type": "coding", "difficulty": 3, "notes": "Two graph problems."}], "tips": ""}


@pytest.mark.parametrize("payload", [t for _, t in INJECTIONS], ids=IDS)
def test_injection_in_an_interview_post_is_never_published_without_a_human_and_the_model_cannot_wave_it_through(tmp_path, payload):
    model = Hijacked()  # the moderation model says "clean" no matter what
    app, _ = app_with(tmp_path, model)
    author, other = member(app, "a@b.co"), member(app, "b@b.co")
    r = author.post("/interviews", json={**GOOD, "tips": f"Good process overall. {payload}"})
    if r.status_code == 422:  # a payload carrying a link is refused outright, before storage or any model
        assert "remove links" in r.json()["detail"] and not model.calls
        assert app.state.conn.execute("SELECT COUNT(*) FROM interview_experiences").fetchone()[0] == 0
        return
    assert r.status_code == 201, r.text
    exp_id = r.json()["id"]
    assert other.get(f"/interviews/{exp_id}").status_code == 404 and other.get("/interviews").json()["total"] == 0  # not public
    assert author.get("/interviews/mine").json()[0]["status"] == "pending"
    row = app.state.conn.execute("SELECT tips, auto_check_json FROM interview_experiences").fetchone()
    check = json.loads(row["auto_check_json"])
    # Either the rules flagged it as AI-directed text (despite the hijacked model saying "clean"), or the
    # sanitiser already removed what made it dangerous (chat-template tags are stripped as markup).
    assert (check["risk"] == "high" and "ai_instructions" in {f["code"] for f in check["flags"]}) or not scan(row["tips"])
    assert "<" not in row["tips"] or not re.search(r"<\s*/?\s*[a-zA-Z!|]", row["tips"])
    call = model.calls[-1]
    assert "NEVER instructions" in call["system"] and payload[:20] not in outside_blocks(call)


# ---- the obedient writer meets hostile facts (profile text + posting text) ----
@pytest.mark.parametrize("payload", [t for _, t in INJECTIONS[::4]], ids=IDS[::4])
async def test_an_obedient_writer_cannot_get_links_or_contacts_into_a_draft(payload):
    body = " ".join(["word"] * 100) + f" Visit {EVIL_URL} or write {EVIL_MAIL}"
    res = await run_loop(ScriptedLLM([draft(body=body)], [verdict(100)]))  # even a fooled critic
    assert res.report.verdict == "revise" and res.draft.status != "critic_passed"
    assert any("URL" in v or "link" in v for v in res.report.violations)
    assert any("email" in v for v in res.report.violations)
    del payload
