"""Connector tests: all HTTP mocked with respx."""
import httpx
import respx

from nextrole.models.profile import Preferences
from nextrole.sources.base import Board
from nextrole.sources.dedupe import dedupe
from nextrole.sources.greenhouse import GreenhouseSource
from nextrole.sources.lever import LeverSource
from nextrole.sources.registry import discover
from nextrole.text import html_to_text

GH = Board(company="Acme", source="greenhouse", slug="acme")
LV = Board(company="Beta", source="lever", slug="beta")

GH_PAYLOAD = {"jobs": [
    {"id": 1, "title": "Backend Engineer", "company_name": "Acme",
     "location": {"name": "Remote - US"}, "content": "&lt;p&gt;Build &amp;amp; ship&lt;/p&gt;",
     "absolute_url": "https://boards.greenhouse.io/acme/jobs/1"},
    {"id": 2, "title": "Bad URL job", "location": {"name": "NYC"},
     "absolute_url": "http://insecure.example.com/2"},
]}
LV_PAYLOAD = [
    {"id": "abc", "text": "Backend Engineer", "workplaceType": "remote",
     "categories": {"location": "Remote - US"}, "descriptionPlain": "Do things",
     "hostedUrl": "https://jobs.lever.co/beta/abc"},
]


def test_html_to_text():
    assert html_to_text("&lt;p&gt;Build &amp;amp; ship&lt;/p&gt;") == "Build & ship"


def test_greenhouse_parse_skips_non_https():
    jobs = GreenhouseSource().parse(GH, GH_PAYLOAD)
    assert [j.source_id for j in jobs] == ["1"]
    assert jobs[0].apply_url == "https://boards.greenhouse.io/acme/jobs/1"
    assert jobs[0].description == "Build & ship"


def test_lever_parse():
    (job,) = LeverSource().parse(LV, LV_PAYLOAD)
    assert job.remote and job.company == "Beta" and job.apply_url.startswith("https://")


def test_dedupe_keeps_first():
    a = GreenhouseSource().parse(GH, GH_PAYLOAD)[0]
    b = a.model_copy(update={"source": "adzuna", "source_id": "z"})
    assert dedupe([a, b]) == [a]


@respx.mock
async def test_discover_parallel_with_fallback_and_filter():
    respx.get(GreenhouseSource().url("acme")).mock(return_value=httpx.Response(200, json=GH_PAYLOAD))
    respx.get(LeverSource().url("beta")).mock(return_value=httpx.Response(404))
    prefs = Preferences(roles=["backend"], locations=[], remote_ok=True)
    async with httpx.AsyncClient() as client:
        res = await discover([GH, LV], prefs, client=client)
    assert [j.source_id for j in res.jobs] == ["1"]
    assert "lever:beta" in res.errors and "greenhouse:acme" not in res.errors


@respx.mock
async def test_transient_5xx_is_retried():
    route = respx.get(GreenhouseSource().url("acme")).mock(
        side_effect=[httpx.Response(503), httpx.Response(200, json=GH_PAYLOAD)]
    )
    async with httpx.AsyncClient() as client:
        jobs = await GreenhouseSource().fetch(client, GH)
    assert route.call_count == 2 and len(jobs) == 1


def test_ashby_parse_filters_unlisted_and_marks_remote():
    from nextrole.sources.ashby import AshbySource

    board = Board(company="Linear", source="ashby", slug="linear")
    payload = {"jobs": [
        {"id": "a", "title": "Eng", "location": "Europe", "isRemote": True, "isListed": True,
         "descriptionPlain": "Build", "jobUrl": "https://jobs.ashbyhq.com/linear/a"},
        {"id": "b", "title": "Closed", "isListed": False,
         "jobUrl": "https://jobs.ashbyhq.com/linear/b"},
    ]}
    (job,) = AshbySource().parse(board, payload)
    assert job.source_id == "a" and job.remote and job.company == "Linear"
    assert job.apply_url == "https://jobs.ashbyhq.com/linear/a"
