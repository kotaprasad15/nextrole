"""Public homepage data: real jobs only, no user data, never fails the page."""
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from nextrole.api.main import create_app
from nextrole.config import Settings
from nextrole.db import repos
from nextrole.db.connection import connect
from nextrole.models.company import CompanyTier, normalize_company
from nextrole.models.job import Job
from nextrole.sources.registry import DiscoveryResult


def job(i: int, company: str, source: str = "greenhouse", **kw) -> Job:
    base = {"source": source, "source_id": str(i), "title": f"Engineer {i}", "company": company,
            "location": "Remote", "remote": True, "apply_url": f"https://boards.example.com/{company.lower()}/{i}"}
    return Job(**{**base, **kw})


def tier(company: str, t: str) -> CompanyTier:
    return CompanyTier(company_key=normalize_company(company), tier=t, method="seed", confidence=1.0)


def make(tmp_path, discover=None):
    conn = connect(":memory:")
    app = create_app(Settings(_env_file=None, upload_dir=tmp_path / "up"), conn, discover=discover)
    return SimpleNamespace(client=TestClient(app), conn=conn, app=app)


@pytest.fixture
def ctx(tmp_path):
    async def no_network(boards, prefs, **kw):  # a test must never touch the network
        raise AssertionError("discover should not be called when the cache has jobs")

    return make(tmp_path, no_network)


def test_returns_real_cached_jobs_without_login(ctx):
    repos.save_jobs(ctx.conn, [job(1, "Lumen"), job(2, "Parcel"), job(3, "Orbit")])
    repos.save_tiers(ctx.conn, [tier("Lumen", "startup")])
    r = ctx.client.get("/public/featured-jobs")
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 3 and {d["company"] for d in data} == {"Lumen", "Parcel", "Orbit"}
    assert next(d for d in data if d["company"] == "Lumen")["tier"] == "startup"
    assert all(d["apply_url"].startswith("https://") for d in data)
    assert r.headers["cache-control"] == "public, max-age=300"


def test_shape_has_no_user_data_or_scores(ctx):
    repos.save_jobs(ctx.conn, [job(1, "Lumen")])
    item = ctx.client.get("/public/featured-jobs").json()[0]
    assert set(item) == {"title", "company", "location", "remote", "tier", "source", "apply_url"}


def test_one_job_per_company_and_pasted_jobs_are_never_shown(ctx):
    repos.save_jobs(ctx.conn, [
        job(1, "Lumen"), job(2, "Lumen"),
        Job(source="pasted", source_id="p1", title="Secret role", company="Private Co", apply_url=None),
    ])
    data = ctx.client.get("/public/featured-jobs").json()
    assert [d["company"] for d in data] == ["Lumen"]


def test_varies_tiers_first_and_caps_at_three(ctx):
    repos.save_jobs(ctx.conn, [job(i, f"Co{i}") for i in range(6)])
    repos.save_tiers(ctx.conn, [tier("Co0", "startup"), tier("Co1", "startup"), tier("Co2", "mnc"), tier("Co3", "mid")])
    data = ctx.client.get("/public/featured-jobs").json()
    assert len(data) == 3
    assert {d["tier"] for d in data} == {"startup", "mid", "mnc"}


def test_empty_cache_takes_a_live_sample_once_and_remembers_it(tmp_path):
    calls = []

    async def fake_discover(boards, prefs, **kw):
        calls.append(len(boards))
        return DiscoveryResult(jobs=[job(1, "Stripe"), job(2, "Stripe"), job(3, "Airbnb")])

    c = make(tmp_path, fake_discover)
    first = c.client.get("/public/featured-jobs").json()
    second = c.client.get("/public/featured-jobs").json()
    assert [d["company"] for d in first] == ["Stripe", "Airbnb"] and first == second
    assert calls == [2]  # two curated boards, fetched once


def test_failures_return_an_empty_list_not_an_error(tmp_path):
    async def broken(boards, prefs, **kw):
        raise RuntimeError("board is down")

    r = make(tmp_path, broken).client.get("/public/featured-jobs")
    assert r.status_code == 200 and r.json() == []
