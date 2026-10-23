"""SSRF: every way of pointing the server at itself, the LAN or cloud metadata must fail."""
import httpx
import pytest

from nextrole.agents.ingest import IngestAgent, IngestError
from nextrole.config import Settings
from nextrole.tools import fetch, netguard
from nextrole.tools.fetch import MAX_PAGE_BYTES, fetch_page_text
from nextrole.tools.netguard import UnsafeURL, check_public_https, system_resolver

PUBLIC = "93.184.216.34"


@pytest.mark.parametrize(
    "url",
    [
        "http://example.com/",                      # plain http
        "ftp://example.com/x", "file:///etc/passwd", "gopher://example.com/", "javascript:alert(1)",
        "https://user:pw@example.com/",              # credentials
        "https://example.com:8443/", "https://example.com:22/",  # odd ports
        "https://127.0.0.1/", "https://127.1/", "https://0.0.0.0/", "https://localhost/",
        "https://10.0.0.5/", "https://172.16.0.1/", "https://192.168.1.1/",
        "https://169.254.169.254/latest/meta-data/",  # cloud metadata
        "https://100.64.0.1/",                        # carrier-grade NAT
        "https://[::1]/", "https://[fd00:ec2::254]/",  # IPv6 loopback, AWS IPv6 metadata
        "https://[::ffff:127.0.0.1]/", "https://[::ffff:10.0.0.1]/",  # IPv4-mapped
        "https://[2002:7f00:1::]/", "https://[2002:0a00:0001::]/",     # 6to4 embedding 127.0.0.1 / 10.0.0.1
        "https://[64:ff9b::7f00:1]/",                  # NAT64 embedding 127.0.0.1
        "https://[2001:0:4136:e378:8000:63bf:3fff:fdd2]/",  # Teredo
        "https://[fe80::1]/",
    ],
)
async def test_unsafe_urls_are_refused_even_when_dns_says_public(url):
    # The resolver would answer "public" for any NAME, so IP-literal hosts must be judged by themselves
    # and names like "localhost" must be judged by what they really resolve to.
    resolver = (lambda host: ["127.0.0.1"]) if host_is_name(url) else (lambda host: [PUBLIC])
    with pytest.raises(UnsafeURL):
        await check_public_https(url, resolver)


def host_is_name(url: str) -> bool:
    return "localhost" in url


@pytest.mark.parametrize("answer", [["10.0.0.1"], ["127.0.0.1"], [PUBLIC, "192.168.0.9"], ["::1"], ["169.254.169.254"]])
async def test_a_name_that_resolves_to_any_private_address_is_refused(answer):
    with pytest.raises(UnsafeURL):
        await check_public_https("https://evil.example.com/", lambda h: answer)


async def test_integer_and_octal_forms_are_judged_by_their_resolution():
    # getaddrinfo("2130706433") -> 127.0.0.1 on most systems; model that and make sure we refuse it.
    for host in ("2130706433", "0x7f000001", "017700000001"):
        with pytest.raises(UnsafeURL):
            await check_public_https(f"https://{host}/", lambda h: ["127.0.0.1"])


async def test_public_https_passes():
    assert await check_public_https("https://example.com/p", lambda h: [PUBLIC]) == "https://example.com/p"
    assert await check_public_https("https://[2606:4700::1111]/", lambda h: ["x"]) == "https://[2606:4700::1111]/"


# ---- fetching ----
def client(handler):
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


async def test_every_redirect_hop_is_revalidated_and_the_chain_is_capped():
    def handler(req):
        if req.url.host == "start.example.com":
            return httpx.Response(302, headers={"location": "https://169.254.169.254/latest/meta-data/"})
        return httpx.Response(200, text="x")

    with pytest.raises(UnsafeURL):
        await fetch_page_text(client(handler), "https://start.example.com/", timeout=5, resolver=lambda h: [PUBLIC])

    hops = []

    def loop(req):
        hops.append(str(req.url))
        return httpx.Response(302, headers={"location": f"https://r{len(hops)}.example.com/"})

    with pytest.raises(ValueError, match="redirect"):
        await fetch_page_text(client(loop), "https://r0.example.com/", timeout=5, resolver=lambda h: [PUBLIC])
    assert len(hops) <= fetch.MAX_REDIRECTS + 1


async def test_response_size_is_capped_and_only_text_types_are_read():
    big = "<p>" + "A" * (MAX_PAGE_BYTES * 2) + "</p>"

    def handler(req):
        return httpx.Response(200, text=big, headers={"content-type": "text/html"})

    _, text = await fetch_page_text(client(handler), "https://big.example.com/", timeout=5, resolver=lambda h: [PUBLIC])
    assert len(text) <= MAX_PAGE_BYTES + 100

    def binary(req):
        return httpx.Response(200, content=b"\x00\x01", headers={"content-type": "application/octet-stream"})

    with pytest.raises(ValueError, match="content type"):
        await fetch_page_text(client(binary), "https://bin.example.com/", timeout=5, resolver=lambda h: [PUBLIC])


async def test_the_connection_is_pinned_to_the_validated_address_against_dns_rebinding(monkeypatch):
    """First answer is public, any later lookup would be private. We must resolve once and connect to
    that exact IP, sending the real name only as Host / TLS name."""
    answers = iter([[(2, 1, 6, "", (PUBLIC, 443))], [(2, 1, 6, "", ("127.0.0.1", 443))]])
    lookups = []

    def fake_getaddrinfo(host, port, **kw):
        lookups.append(host)
        return next(answers)

    monkeypatch.setattr(netguard.socket, "getaddrinfo", fake_getaddrinfo)
    seen = {}

    def handler(req):
        seen["url_host"] = req.url.host
        seen["host_header"] = req.headers["host"]
        seen["sni"] = req.extensions.get("sni_hostname")
        return httpx.Response(200, text="<p>hello world, a perfectly normal page</p>", headers={"content-type": "text/html"})

    await fetch_page_text(client(handler), "https://rebind.example.com/page", timeout=5, resolver=system_resolver)
    assert lookups == ["rebind.example.com"]  # resolved exactly once
    assert seen["url_host"] == PUBLIC and seen["host_header"] == "rebind.example.com"
    assert seen["sni"] == "rebind.example.com"


async def test_pasted_urls_are_guarded_and_never_leak_internal_errors():
    class Boom:  # an LLM that must never be reached for a blocked URL
        async def complete_json(self, **kw):
            raise AssertionError("model was called")

    agent = IngestAgent(Boom(), Settings(_env_file=None), client(lambda r: httpx.Response(200, text="x")),
                        resolver=lambda h: ["169.254.169.254"])
    with pytest.raises(IngestError) as exc:
        await agent.run(url="https://metadata.example.com/")
    assert "169.254" not in str(exc.value)  # a safe, generic message
    for site in ("https://www.linkedin.com/jobs/view/1", "https://in.indeed.com/x", "https://www.naukri.com/j"):
        with pytest.raises(IngestError, match="LinkedIn, Indeed or Naukri"):
            await agent.run(url=site)
