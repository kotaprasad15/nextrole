"""Tiering, matcher, prefilter, pipeline and dashboard API. LLM and discovery are mocked."""
import json
from types import SimpleNamespace

import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

from nextrole.agents.matcher import MatcherAgent, prefilter
from nextrole.agents.tiering import TieringAgent, tier_from_employee_count
from nextrole.api.main import create_app
from nextrole.config import Settings
from nextrole.db.connection import connect
from nextrole.llm.budget import Budget
from nextrole.llm.client import LLMClient
from nextrole.models.company import normalize_company
from nextrole.models.job import Job
from nextrole.models.profile import Preferences, Profile
from nextrole.sources.registry import DiscoveryResult


class FakeLLM:
    """Anthropic-shaped fake that routes on the system prompt and records every call."""

    def __init__(self, tier_reply=None, match_reply=None):
        self.calls: list[dict] = []
        self.tier_reply = tier_reply or (lambda names: {"items": [
            {"company": n, "tier": "startup", "confidence": 0.9} for n in names]})
        self.match_reply = match_reply or (lambda user: {
            "score": 80, "strengths": ["Python"], "gaps": [], "rationale": "Good fit."})
        self.messages = SimpleNamespace(create=self._create)

    async def _create(self, **kw):
        user, system = kw["messages"][0]["content"], kw["system"]
        self.calls.append({"system": system, "user": user})
        if "Classify each company" in system:
            names = [line[2:] for line in user.splitlines() if line.startswith("- ")]
            body = self.tier_reply(names)
        else:
            body = self.match_reply(user)
        text = body if isinstance(body, str) else json.dumps(body)
        return SimpleNamespace(
            content=[SimpleNamespace(type="text", text=text)],
            usage=SimpleNamespace(input_tokens=100, output_tokens=50),
        )

    def of(self, agent_marker: str) -> list[dict]:
        return [c for c in self.calls if agent_marker in c["system"]]


def make_llm(fake, **settings):
    s = Settings(_env_file=None, **settings)
    return LLMClient(s, Budget.from_settings(s), client=fake, retry_wait=lambda *_: 0), s


def job(i, company="Acme", title="Backend Engineer", desc="python sql", loc="Remote"):
    return Job(source="gh", source_id=str(i), title=title, company=company, location=loc,
               description=desc, apply_url=f"https://boards.greenhouse.io/x/jobs/{i}")


PROFILE = Profile(name="Ada", skills=["Python", "SQL"],
                  preferences=Preferences(roles=["backend"], remote_ok=True))


def test_normalize_company():
    assert normalize_company("Stripe, Inc.") == normalize_company("stripe") == "stripe"
    assert normalize_company("Tata Consultancy Services Ltd") == "tata consultancy services"


def test_tier_from_employee_count():
    s = Settings(_env_file=None)
    assert [tier_from_employee_count(n, s) for n in (50, 200, 201, 5000, 5001)] == [
        "startup", "startup", "mid", "mid", "mnc"]


# ---------------- tiering ----------------

async def test_tiering_seed_metadata_llm_and_cache():
    fake = FakeLLM()
    llm, s = make_llm(fake)
    agent = TieringAgent(llm, connect(":memory:"), s)
    out = await agent.classify(["Google", "TinyCo", "Mystery Labs"], employee_counts={"TinyCo": 12})
    assert (out["google"].tier, out["google"].method) == ("mnc", "seed")
    assert (out["tinyco"].tier, out["tinyco"].method) == ("startup", "metadata")
    assert (out["mystery labs"].tier, out["mystery labs"].method) == ("startup", "llm")
    assert len(fake.calls) == 1 and "Mystery Labs" in fake.calls[0]["user"]
    assert "Google" not in fake.calls[0]["user"]  # seed/metadata companies never reach the LLM

    await agent.classify(["Google", "TinyCo", "Mystery Labs"])  # all cached now
    assert len(fake.calls) == 1


async def test_tiering_low_confidence_not_cached_and_invented_names_ignored():
    fake = FakeLLM(tier_reply=lambda names: {"items": [
        {"company": names[0], "tier": "mnc", "confidence": 0.2},
        {"company": "Totally Invented", "tier": "mnc", "confidence": 1.0}]})
    llm, s = make_llm(fake)
    agent = TieringAgent(llm, connect(":memory:"), s)
    out = await agent.classify(["Obscure Labs"])
    assert set(out) == {"obscure labs"} and out["obscure labs"].confidence == 0.2
    await agent.classify(["Obscure Labs"])
    assert len(fake.calls) == 2  # low confidence was not cached, so it is asked again


async def test_tiering_missing_company_defaults_mid_uncached():
    fake = FakeLLM(tier_reply=lambda names: {"items": []})
    llm, s = make_llm(fake)
    out = await TieringAgent(llm, connect(":memory:"), s).classify(["Ghost Inc"])
    assert out["ghost"].tier == "mid" and out["ghost"].confidence == 0.0


# ---------------- prefilter / matcher ----------------

def test_prefilter_ranks_caps_and_limits():
    jobs = [job(i, company="Big", title="Backend Engineer", desc="python sql") for i in range(10)]
    jobs += [job(100, company="Small", title="Chef", desc="cooking"),
             job(101, company="Other", title="Data Engineer", desc="python")]
    kept = prefilter(jobs, PROFILE, limit=5, per_company_cap=2)
    assert sum(j.company == "Big" for j in kept) == 2  # per-company cap
    assert len(kept) == 4  # Big x2, Other, Small: fewer than the limit, nothing dropped wrongly
    assert kept[0].company == "Big"  # strongest overlap first
    assert len(prefilter(jobs, PROFILE, limit=3, per_company_cap=5)) == 3


async def test_matcher_sorts_and_skips_bad_jobs():
    def reply(user):
        if "Job 2" in user:
            return "not json at all"
        if "Job 3" in user:
            return {"score": 150, "rationale": "out of range"}  # fails validation
        return {"score": 90 if "Job 1" in user else 40, "strengths": ["Python"],
                "gaps": [], "rationale": "ok"}

    llm, s = make_llm(FakeLLM(match_reply=reply))
    jobs = [job(i, title=f"Job {i}") for i in (0, 1, 2, 3)]
    results = await MatcherAgent(llm, s).score_all(PROFILE, jobs)
    assert [r.job_id for r in results] == [jobs[1].id, jobs[0].id]
    assert [r.score for r in results] == [90, 40]


async def test_matcher_stops_when_budget_exhausted():
    fake = FakeLLM()
    llm, s = make_llm(fake, run_max_tokens=300, match_concurrency=1)  # 150 tokens per call
    results = await MatcherAgent(llm, s).score_all(PROFILE, [job(i) for i in range(10)])
    assert 0 < len(results) < 10 and len(fake.calls) < 10


async def test_matcher_prompt_has_no_urls():
    fake = FakeLLM()
    llm, s = make_llm(fake)
    j = job(1)
    await MatcherAgent(llm, s).score_one(PROFILE, j)
    assert j.apply_url not in fake.calls[0]["user"] and "boards.greenhouse.io" not in fake.calls[0]["user"]


# ---------------- API / pipeline ----------------

@pytest.fixture
def ctx(tmp_path):
    fake = FakeLLM()
    settings = Settings(_env_file=None, upload_dir=tmp_path / "up",
                        resume_encryption_key=Fernet.generate_key().decode())
    jobs = [job(1, "Google", "Backend Engineer"), job(2, "Tiny Startup", "Backend Developer"),
            job(3, "Midsize Corp", "Backend Engineer")]

    async def discover(boards, prefs, **_):
        return DiscoveryResult(jobs=jobs, errors={"lever:x": "boom"})

    def llm_factory():
        return LLMClient(settings, Budget.from_settings(settings), client=fake,
                         retry_wait=lambda *_: 0)

    app = create_app(settings, connect(":memory:"), llm_factory, discover)
    return SimpleNamespace(client=TestClient(app), fake=fake, jobs=jobs)


def signup_with_profile(c):
    c.post("/auth/signup", json={"email": "a@b.co", "password": "correct horse"})
    c.put("/profile", json=PROFILE.model_dump())


def test_recommendations_require_auth_and_profile(ctx):
    assert ctx.client.get("/recommendations").status_code == 401
    ctx.client.post("/auth/signup", json={"email": "a@b.co", "password": "correct horse"})
    assert ctx.client.post("/recommendations/refresh").status_code == 409


def test_refresh_groups_by_tier_with_source_apply_urls(ctx):
    c = ctx.client
    signup_with_profile(c)
    summary = c.post("/recommendations/refresh").json()
    assert summary["discovered"] == 3 and summary["matched"] == 3
    assert summary["source_errors"] == {"lever:x": "boom"} and summary["tokens"] > 0

    rec = c.get("/recommendations").json()
    assert [x["company"] for x in rec["mnc"]] == ["Google"]  # seed list
    assert {x["company"] for x in rec["startup"]} == {"Tiny Startup", "Midsize Corp"}  # fake LLM
    assert rec["mid"] == []
    by_id = {j.id: j for j in ctx.jobs}
    for card in [*rec["mnc"], *rec["startup"]]:
        assert card["apply_url"] == by_id[card["job_id"]].apply_url  # straight from source data
        assert card["apply_url"].startswith("https://") and card["score"] == 80


def test_refresh_replaces_previous_results_and_uses_tier_cache(ctx):
    c = ctx.client
    signup_with_profile(c)
    c.post("/recommendations/refresh")
    tier_calls = len(ctx.fake.of("Classify each company"))
    c.post("/recommendations/refresh")
    assert len(ctx.fake.of("Classify each company")) == tier_calls  # cached, no new tier calls
    rec = c.get("/recommendations").json()
    assert sum(len(v) for v in rec.values()) == 3  # replaced, not duplicated


def test_matches_deleted_with_account(ctx):
    c = ctx.client
    signup_with_profile(c)
    c.post("/recommendations/refresh")
    c.delete("/me")
    conn = c.app.state.conn
    assert conn.execute("SELECT COUNT(*) FROM matches").fetchone()[0] == 0


def test_prefilter_respects_experience_level():
    jobs = [job(1, "A", "Senior Staff Backend Engineer"), job(2, "B", "Backend Engineer, New Grad"),
            job(3, "C", "Backend Engineer")]
    entry = Profile(skills=["python", "sql"], preferences=Preferences(
        roles=["backend"], experience_level="Intern / New grad"))
    senior = entry.model_copy(update={"preferences": Preferences(
        roles=["backend"], experience_level="Senior")})
    assert [j.company for j in prefilter(jobs, entry, 3, 5)] == ["B", "C", "A"]
    assert prefilter(jobs, senior, 3, 5)[0].company == "A"


def test_select_candidates_gives_each_tier_a_share_and_backfills():
    from nextrole.agents.matcher import select_candidates
    from nextrole.models.company import CompanyTier

    tiers = {k: CompanyTier(company_key=k, tier=t, method="seed")
             for k, t in (("bigco", "mnc"), ("midco", "mid"), ("tiny", "startup"))}
    jobs = [job(i, "BigCo") for i in range(20)] + [job(100, "Tiny"), job(101, "MidCo")]
    picked = select_candidates(jobs, tiers, PROFILE, limit=6, cap=20)
    assert {"BigCo", "Tiny", "MidCo"} <= {j.company for j in picked}  # nobody crowded out
    assert len(picked) == 6  # unused startup/mid slots backfilled by the MNC tier
    assert sum(j.company == "BigCo" for j in picked) == 4
