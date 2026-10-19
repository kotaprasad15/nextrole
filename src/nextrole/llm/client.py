"""Single gateway to the Anthropic API.

Design decisions:
- Every agent calls the model through here, so retries, timeouts, budget enforcement and
  tracing are implemented exactly once.
- Model names come from config (callers pass a model name sourced from Settings).
- Structured output: the model is asked for JSON, validated by a Pydantic model, with one
  repair retry that feeds the validation error back. Agents never see raw strings.
"""
import json
import re
import time
from dataclasses import dataclass
from typing import Any, TypeVar

from anthropic import APIConnectionError, APIStatusError, AsyncAnthropic
from pydantic import BaseModel, ValidationError
from tenacity import retry, retry_if_exception, stop_after_attempt, wait_exponential

from nextrole.config import Settings
from nextrole.llm.budget import Budget
from nextrole.tracing.tracer import Tracer

T = TypeVar("T", bound=BaseModel)


@dataclass
class LLMResult:
    text: str
    input_tokens: int
    output_tokens: int


@dataclass
class ChatResult:
    content: list[Any]
    stop_reason: str
    input_tokens: int
    output_tokens: int

    @property
    def text(self) -> str:
        return "".join(b.text for b in self.content if getattr(b, "type", "") == "text")

    @property
    def tool_uses(self) -> list[Any]:
        return [b for b in self.content if getattr(b, "type", "") == "tool_use"]


def _is_transient(exc: BaseException) -> bool:
    """Retry network errors, 429s and 5xx; never retry other 4xx."""
    if isinstance(exc, APIConnectionError):
        return True
    return isinstance(exc, APIStatusError) and (exc.status_code == 429 or exc.status_code >= 500)


def _extract_json(text: str) -> str:
    """Pull the JSON object out of a reply that may be wrapped in code fences or prose."""
    match = re.search(r"\{.*\}", text, re.DOTALL)
    return match.group(0) if match else text


class LLMClient:
    def __init__(
        self,
        settings: Settings,
        budget: Budget,
        tracer: Tracer | None = None,
        client: Any | None = None,
        retry_wait: Any = None,
    ) -> None:
        self.settings = settings
        self.budget = budget
        self.tracer = tracer
        self._retry_wait = retry_wait or wait_exponential(multiplier=1, max=10)
        self._client = client or AsyncAnthropic(
            api_key=settings.anthropic_api_key,
            base_url=settings.llm_base_url or None,  # None -> official Anthropic endpoint
            timeout=settings.llm_timeout_s,
            max_retries=0,  # retries are handled by tenacity below so they are visible/tested
        )

    async def _request(
        self, model: str, system: str, messages: list[dict], tools: list[dict] | None,
        max_tokens: int,
    ) -> Any:
        @retry(
            retry=retry_if_exception(_is_transient),
            stop=stop_after_attempt(self.settings.llm_max_retries),
            wait=self._retry_wait,
            reraise=True,
        )
        async def _do() -> Any:
            kwargs: dict[str, Any] = {
                "model": model, "max_tokens": max_tokens, "system": system, "messages": messages,
            }
            if tools:
                kwargs["tools"] = tools
            if self.settings.llm_disable_thinking:
                kwargs["thinking"] = {"type": "disabled"}
            return await self._client.messages.create(**kwargs)

        return await _do()

    async def chat(
        self, *, agent: str, model: str, system: str, messages: list[dict],
        tools: list[dict] | None = None, max_tokens: int = 1024,
    ) -> ChatResult:
        """Budget-checked, traced messages call; the primitive `complete` and tool loops use.

        Returns raw content blocks so callers can read `tool_use` blocks. Everything else
        (retries, budget, tracing) is identical to `complete`.
        """
        self.budget.check()
        start = time.perf_counter()
        error: str | None = None
        result = ChatResult([], "", 0, 0)
        try:
            resp = await self._request(model, system, messages, tools, max_tokens)
            result = ChatResult(
                list(resp.content), getattr(resp, "stop_reason", "") or "",
                resp.usage.input_tokens, resp.usage.output_tokens,
            )
            return result
        except Exception as exc:
            error = repr(exc)
            raise
        finally:
            cost = self.budget.charge(result.input_tokens, result.output_tokens)
            if self.tracer:
                self.tracer.record(
                    agent,
                    {"model": model, "system": system, "messages": messages},
                    {"text": result.text, "tool_calls": [
                        {"name": b.name, "input": b.input} for b in result.tool_uses]},
                    latency_ms=(time.perf_counter() - start) * 1000,
                    input_tokens=result.input_tokens, output_tokens=result.output_tokens,
                    cost_usd=cost, error=error,
                )

    async def complete(
        self, *, agent: str, model: str, system: str, user: str, max_tokens: int = 1024
    ) -> LLMResult:
        """Single-turn text completion (budget-checked and traced via `chat`)."""
        res = await self.chat(
            agent=agent, model=model, system=system,
            messages=[{"role": "user", "content": user}], max_tokens=max_tokens,
        )
        return LLMResult(res.text, res.input_tokens, res.output_tokens)

    async def complete_json(
        self,
        *,
        agent: str,
        model: str,
        system: str,
        user: str,
        schema: type[T],
        max_tokens: int = 1024,
    ) -> T:
        """Completion validated against `schema`, with one repair retry on bad output."""
        sys_prompt = (
            f"{system}\n\nRespond with ONLY a JSON object matching this JSON schema:\n"
            f"{json.dumps(schema.model_json_schema())}"
        )
        prompt = user
        for attempt in range(2):
            res = await self.complete(
                agent=agent, model=model, system=sys_prompt, user=prompt, max_tokens=max_tokens
            )
            try:
                return schema.model_validate_json(_extract_json(res.text))
            except ValidationError as exc:
                if attempt == 1:
                    raise
                prompt = (
                    f"{user}\n\nYour previous reply was invalid:\n{res.text}\n"
                    f"Validation error:\n{exc}\nReturn corrected JSON only."
                )
        raise AssertionError("unreachable")
