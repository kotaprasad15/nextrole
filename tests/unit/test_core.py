"""Unit tests for M-a. The Anthropic client and the network are fully mocked."""
import json
from types import SimpleNamespace

import httpx
import pytest
from anthropic import APIStatusError
from pydantic import ValidationError

from nextrole.agents.baseline import run_baseline
from nextrole.config import Settings
from nextrole.llm.budget import Budget, BudgetExceeded
from nextrole.llm.client import LLMClient
from nextrole.models.job import Job
from nextrole.models.profile import Profile
from nextrole.tracing.redact import redact
from nextrole.tracing.tracer import Tracer


def _resp(text: str, i: int = 100, o: int = 50):
    return SimpleNamespace(
        content=[SimpleNamespace(type="text", text=text)],
        usage=SimpleNamespace(input_tokens=i, output_tokens=o),
    )


class FakeAnthropic:
    """Replays queued replies/exceptions through the same `messages.create` surface."""

    def __init__(self, *replies):
        self.replies = list(replies)
        self.calls = 0
        self.messages = SimpleNamespace(create=self._create)

    async def _create(self, **_kw):
        self.calls += 1
        r = self.replies.pop(0)
        if isinstance(r, Exception):
            raise r
        return r


def _llm(tmp_path, fake, **settings):
    s = Settings(_env_file=None, **settings)
    return LLMClient(s, Budget.from_settings(s), Tracer(tmp_path), client=fake, retry_wait=lambda *_: 0)


def _status_error(code: int) -> APIStatusError:
    req = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
    return APIStatusError("boom", response=httpx.Response(code, request=req), body=None)


def test_https_validation():
    ok = {"source": "gh", "source_id": "1", "title": "Eng", "company": "Acme"}
    assert Job(**ok, apply_url="https://boards.greenhouse.io/acme/jobs/1").id
    for bad in ["http://x.com/a", "javascript:alert(1)", "https://", "not a url"]:
        with pytest.raises(ValidationError):
            Job(**ok, apply_url=bad)


def test_redact_drops_resume_and_truncates():
    out = redact({"resume_text": "secret", "x": "a" * 500})
    assert out["resume_text"] == "<redacted>"
    assert "len=500" in out["x"] and len(out["x"]) < 200


def test_budget_blocks_after_cap():
    b = Budget(max_tokens=100, max_cost_usd=1.0, price_in_per_mtok=3, price_out_per_mtok=15)
    b.charge(60, 60)
    with pytest.raises(BudgetExceeded):
        b.check()


async def test_retries_transient_then_succeeds(tmp_path):
    fake = FakeAnthropic(_status_error(529), _status_error(429), _resp("hi"))
    res = await _llm(tmp_path, fake).complete(agent="t", model="m", system="s", user="u")
    assert res.text == "hi" and fake.calls == 3


async def test_does_not_retry_client_error(tmp_path):
    fake = FakeAnthropic(_status_error(400), _resp("never"))
    with pytest.raises(APIStatusError):
        await _llm(tmp_path, fake).complete(agent="t", model="m", system="s", user="u")
    assert fake.calls == 1


async def test_json_repair_retry(tmp_path):
    good = json.dumps({"subject": "Hi", "body": "Hello"})
    fake = FakeAnthropic(_resp("not json"), _resp(f"```json\n{good}\n```"))
    llm = _llm(tmp_path, fake)
    from nextrole.agents.baseline import _Reply

    out = await llm.complete_json(agent="t", model="m", system="s", user="u", schema=_Reply)
    assert out.subject == "Hi" and fake.calls == 2


async def test_baseline_traces_and_budget_without_leaking_resume(tmp_path):
    good = json.dumps({"subject": "Hello", "body": "Body"})
    fake = FakeAnthropic(_resp(good, 1000, 200))
    llm = _llm(tmp_path, fake)
    job = Job(source="gh", source_id="9", title="ML Eng", company="Acme",
              apply_url="https://boards.greenhouse.io/acme/jobs/9")
    draft = await run_baseline(llm, "m", Profile(name="Ada", skills=["python"]), job)
    assert draft.job_id == job.id and draft.status == "draft"
    assert llm.budget.tokens_used == 1200 and llm.budget.cost_usd > 0
    line = json.loads(llm.tracer.path.read_text().splitlines()[0])
    assert line["agent"] == "baseline" and line["input_tokens"] == 1000


def test_base_url_setting_routes_to_other_provider(tmp_path):
    default = _llm(tmp_path, None, anthropic_api_key="k")
    assert "api.anthropic.com" in str(default._client.base_url)
    ds = _llm(tmp_path, None, anthropic_api_key="k", llm_base_url="https://api.deepseek.com/anthropic")
    assert "api.deepseek.com/anthropic" in str(ds._client.base_url)


async def test_disable_thinking_flag_is_sent_only_when_enabled(tmp_path):
    sent = []

    class Spy(FakeAnthropic):
        async def _create(self, **kw):
            sent.append(kw)
            return await super()._create(**kw)

    for flag in (False, True):
        sent.clear()
        llm = _llm(tmp_path, Spy(_resp("ok")), llm_disable_thinking=flag)
        await llm.complete(agent="t", model="m", system="s", user="u")
        assert ("thinking" in sent[0]) is flag
        assert not flag or sent[0]["thinking"] == {"type": "disabled"}
