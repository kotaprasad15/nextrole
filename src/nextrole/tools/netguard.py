"""SSRF guard for the researcher's fetch tool.

Why: the model decides which URL to fetch, and fetched pages are untrusted. Without a guard a
prompt-injected page could make the server request internal addresses (cloud metadata,
localhost, LAN). Rules: https only, standard port, no credentials in the URL, and every
resolved address must be public. Redirects are followed manually so each hop is re-checked.
DNS rebinding (the name resolving to a public IP at check time and a private one at connect
time) is closed by PINNING: `fetch_page_text` connects to the exact address validated here and only
sends the original name as the Host header and TLS server name (see tools/fetch.py).
Address classification uses `is_global` (so private, loopback, link-local incl. cloud metadata,
carrier-grade NAT, reserved and documentation ranges all fail) and unwraps addresses that smuggle an
IPv4 inside IPv6 (IPv4-mapped, 6to4, NAT64); Teredo is refused outright.
"""
import asyncio
import ipaddress
import re
import socket
from collections.abc import Callable
from urllib.parse import urlparse

Resolver = Callable[[str], list[str]]


class UnsafeURL(ValueError):
    pass


def system_resolver(host: str) -> list[str]:
    return [info[4][0] for info in socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)]


def _is_ip(host: str) -> bool:
    try:
        ipaddress.ip_address(host)
        return True
    except ValueError:
        return False


_NAT64 = ipaddress.ip_network("64:ff9b::/96")
_NUMERIC_HOST = re.compile(r"^(?:0x[0-9a-f]+|[0-9.]+)$", re.IGNORECASE)


def _is_public(ip: str) -> bool:
    addr = ipaddress.ip_address(ip)
    if isinstance(addr, ipaddress.IPv6Address):
        if addr.teredo is not None:
            return False
        embedded = addr.ipv4_mapped or addr.sixtofour or (
            ipaddress.IPv4Address(int(addr) & 0xFFFFFFFF) if addr in _NAT64 else None)
        if embedded is not None:
            addr = embedded
    return addr.is_global and not addr.is_multicast


async def resolve_public(url: str, resolve: Resolver = system_resolver) -> list[str]:
    """Validate the URL and return the public addresses its host resolves to, else raise UnsafeURL."""
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname:
        raise UnsafeURL("only https URLs are allowed")
    if parsed.username or parsed.password or parsed.port not in (None, 443):
        raise UnsafeURL("credentials and custom ports are not allowed")
    host = parsed.hostname
    if _NUMERIC_HOST.match(host) and not _is_ip(host):
        # 127.1, 0x7f000001, 2130706433, 017700000001: legacy numeric spellings of an address that
        # some resolvers expand. No real hostname looks like this, so refuse rather than guess.
        raise UnsafeURL("numeric host forms are not allowed")
    try:
        if _is_ip(host):
            ips = [host]
        else:
            ips = await asyncio.get_running_loop().run_in_executor(None, resolve, host)
    except OSError as exc:
        raise UnsafeURL(f"cannot resolve {host}") from exc
    if not ips or not all(_is_public(ip) for ip in ips):
        raise UnsafeURL("URL resolves to a non-public address")
    return ips


async def check_public_https(url: str, resolve: Resolver = system_resolver) -> str:
    """Return the URL if safe to fetch, else raise UnsafeURL."""
    await resolve_public(url, resolve)
    return url
