"""Tools the Researcher agent can call: company_overview, company_news, fetch_page.

Design decisions:
- Legitimate public sources only: Wikipedia (company overview) and Hacker News via the open
  Algolia API (recent press). fetch_page reads pages behind the SSRF guard, and only on hosts
  already seen (the job posting host or earlier tool results).
- Every result becomes a numbered Source (R1, R2...) holding the URL *we* received from the
  API. The model refers to sources by id; it never writes URLs, so every link shown to the
  user traces back to a tool result.
- Tool output is untrusted text. It is size-capped and later extracted into schema-validated
  facts, never executed or followed as instructions.
"""
import json
import re
import sqlite3
import time
from dataclasses import dataclass
from urllib.parse import quote, urlparse

import httpx

from nextrole.config import Settings
from nextrole.models.company import normalize_company
from nextrole.text import html_to_text
from nextrole.tools.cache import HostRateLimiter, HttpCache
from nextrole.tools.netguard import Resolver, UnsafeURL, check_public_https, system_resolver

MAX_PAGE_BYTES = 1_500_000
MAX_SOURCE_CHARS = 2000
_NOISE = re.compile(r"<(script|style|noscript)[^>]*>.*?</\1>", re.DOTALL | re.IGNORECASE)

TOOL_DEFS = [
    {
        "name": "company_overview",
        "description": "Look up a general overview of a company (what it does, size, HQ) "
                       "from Wikipedia.",
        "input_schema": {"type": "object", "properties": {"company": {"type": "string"}},
                         "required": ["company"]},
    },
    {
        "name": "company_news",
        "description": "Find recent (last 90 days) news stories about a company from Hacker News.",
        "input_schema": {"type": "object", "properties": {"company": {"type": "string"}},
                         "required": ["company"]},
    },
    {
        "name": "fetch_page",
        "description": "Fetch the readable text of a web page. Only the job posting URL or URLs "
                       "returned by other tools can be fetched.",
        "input_schema": {"type": "object", "properties": {"url": {"type": "string"}},
                         "required": ["url"]},
    },
]


@dataclass
class Source:
    id: str
    kind: str  # wikipedia | news | page
    title: str
    url: str
    date: str
    text: str


class ResearchTools:
    def __init__(
        self, client: httpx.AsyncClient, conn: sqlite3.Connection, settings: Settings,
        job_url: str, resolver: Resolver = system_resolver,
    ) -> None:
        self.client, self.settings, self.resolver = client, settings, resolver
        self.cache = HttpCache(conn)
        self.limiter = HostRateLimiter()
        self.sources: dict[str, Source] = {}
        self.allowed_hosts: set[str] = {urlparse(job_url).hostname or ""}

    async def call(self, name: str, args: dict) -> str:
        """Run a tool and return a compact text result for the model (sources listed by id)."""
        try:
            if name == "company_overview":
                found = await self._overview(str(args.get("company", "")))
            elif name == "company_news":
                found = await self._news(str(args.get("company", "")))
            elif name == "fetch_page":
                found = await self._fetch(str(args.get("url", "")))
            else:
                return f"error: unknown tool {name}"
        except (httpx.HTTPError, UnsafeURL, ValueError) as exc:
            return f"error: {type(exc).__name__}: {str(exc)[:120]}"
        if not found:
            return "no results"
        return "\n\n".join(f"[{s.id}] {s.title} ({s.date or s.kind})\n{s.text[:500]}" for s in found)

    def _add(self, kind: str, title: str, url: str, date: str, text: str) -> Source:
        src = Source(f"R{len(self.sources) + 1}", kind, title, url, date, text[:MAX_SOURCE_CHARS])
        self.sources[src.id] = src
        if host := urlparse(url).hostname:
            self.allowed_hosts.add(host)
        return src

    async def _get_json(self, url: str, params: dict) -> dict:
        key = f"GET {url} {json.dumps(params, sort_keys=True)}"
        if (hit := self.cache.get(key)) is not None:
            return json.loads(hit)
        await self.limiter.wait(urlparse(url).hostname or "")
        resp = await self.client.get(url, params=params, timeout=self.settings.fetch_timeout_s)
        resp.raise_for_status()
        self.cache.set(key, resp.text, self.settings.research_cache_ttl_hours)
        return resp.json()

    async def _overview(self, company: str) -> list[Source]:
        key = normalize_company(company)
        if not key:
            return []
        data = await self._get_json("https://en.wikipedia.org/w/api.php", {
            "action": "query", "list": "search", "srsearch": f"{company} company",
            "srlimit": 3, "format": "json"})
        for hit in data.get("query", {}).get("search", []):
            title = hit["title"]
            summary = await self._get_json(
                "https://en.wikipedia.org/api/rest_v1/page/summary/"
                + quote(title.replace(" ", "_")), {})
            extract = summary.get("extract", "")
            page = summary.get("content_urls", {}).get("desktop", {}).get("page", "")
            # Skip disambiguation pages and articles that aren't about this company.
            if summary.get("type") == "disambiguation" or not page:
                continue
            if key.split()[0] not in normalize_company(title + " " + extract[:200]):
                continue
            return [self._add("wikipedia", title, page, "", extract)]
        return []

    async def _news(self, company: str) -> list[Source]:
        name = company.strip()
        if not name:
            return []
        since = int(time.time()) - 90 * 86400
        data = await self._get_json("https://hn.algolia.com/api/v1/search_by_date", {
            "query": f'"{name}"', "tags": "story", "hitsPerPage": 20,
            "restrictSearchableAttributes": "title", "numericFilters": f"created_at_i>{since}"})
        out: list[Source] = []
        for h in data.get("hits", []):
            url = h.get("url") or ""
            # HN search is fuzzy: require the name in the title, an https link, some traction.
            if (name.lower() in (h.get("title") or "").lower() and url.startswith("https://")
                    and (h.get("points") or 0) >= 3):
                out.append(self._add("news", h["title"], url, (h.get("created_at") or "")[:10],
                                     h["title"]))
            if len(out) == 5:
                break
        return out

    async def _fetch(self, url: str) -> list[Source]:
        current = url
        for _ in range(4):  # follow at most 3 redirects, re-validating every hop
            await check_public_https(current, self.resolver)
            host = urlparse(current).hostname or ""
            if host not in self.allowed_hosts:
                raise UnsafeURL(f"host {host} is not allowed; only hosts seen in earlier results")
            await self.limiter.wait(host)
            async with self.client.stream("GET", current, timeout=self.settings.fetch_timeout_s,
                                          follow_redirects=False) as resp:
                if resp.is_redirect and (loc := resp.headers.get("location")):
                    current = str(httpx.URL(current).join(loc))
                    continue
                resp.raise_for_status()
                ctype = resp.headers.get("content-type", "")
                if "html" not in ctype and "text/plain" not in ctype:
                    raise ValueError("unsupported content type")
                body = b""
                async for chunk in resp.aiter_bytes():
                    body += chunk
                    if len(body) > MAX_PAGE_BYTES:
                        break
            text = html_to_text(_NOISE.sub(" ", body.decode("utf-8", errors="replace")))
            return [self._add("page", host, current, "", text)]
        raise ValueError("too many redirects")
