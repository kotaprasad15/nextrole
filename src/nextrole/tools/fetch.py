"""Guarded page fetching shared by the researcher tool and the pasted-URL ingest step.

Every request goes through the SSRF guard (https only, public addresses only), redirects are
followed manually so each hop is re-validated, the body is size-capped while streaming, and
only text-like content types are read. `allow_host` lets callers add their own policy (the
researcher only fetches hosts it has already seen; a user-pasted URL has no such limit).
"""
import re
from collections.abc import Callable
from urllib.parse import urlparse

import httpx

from nextrole.text import html_to_text
from nextrole.tools.cache import HostRateLimiter
from nextrole.tools.netguard import Resolver, UnsafeURL, check_public_https, system_resolver

MAX_PAGE_BYTES = 1_500_000
MAX_REDIRECTS = 3
_NOISE = re.compile(r"<(script|style|noscript)[^>]*>.*?</\1>", re.DOTALL | re.IGNORECASE)


async def fetch_page_text(
    client: httpx.AsyncClient, url: str, *, timeout: float,
    resolver: Resolver = system_resolver, limiter: HostRateLimiter | None = None,
    allow_host: Callable[[str], bool] | None = None,
) -> tuple[str, str]:
    """Return (final_url, readable_text). Raises UnsafeURL / httpx errors / ValueError."""
    current = url
    for _ in range(MAX_REDIRECTS + 1):
        await check_public_https(current, resolver)
        host = urlparse(current).hostname or ""
        if allow_host is not None and not allow_host(host):
            raise UnsafeURL(f"host {host} is not allowed; only hosts seen in earlier results")
        if limiter:
            await limiter.wait(host)
        async with client.stream("GET", current, timeout=timeout, follow_redirects=False) as resp:
            if resp.is_redirect and (location := resp.headers.get("location")):
                current = str(httpx.URL(current).join(location))
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
        return current, text
    raise ValueError("too many redirects")
