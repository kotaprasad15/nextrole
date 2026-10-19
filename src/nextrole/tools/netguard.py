"""SSRF guard for the researcher's fetch tool.

Why: the model decides which URL to fetch, and fetched pages are untrusted. Without a guard a
prompt-injected page could make the server request internal addresses (cloud metadata,
localhost, LAN). Rules: https only, standard port, no credentials in the URL, and every
resolved address must be public. Redirects are followed manually so each hop is re-checked.
Residual risk: DNS can change between this check and the connection (rebinding); acceptable
here, but a hardened deployment would pin the resolved IP.
"""
import asyncio
import ipaddress
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


def _is_public(ip: str) -> bool:
    addr = ipaddress.ip_address(ip)
    return not (addr.is_private or addr.is_loopback or addr.is_link_local or addr.is_multicast
                or addr.is_reserved or addr.is_unspecified)


async def check_public_https(url: str, resolve: Resolver = system_resolver) -> str:
    """Return the URL if safe to fetch, else raise UnsafeURL."""
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname:
        raise UnsafeURL("only https URLs are allowed")
    if parsed.username or parsed.password or parsed.port not in (None, 443):
        raise UnsafeURL("credentials and custom ports are not allowed")
    host = parsed.hostname
    try:
        if _is_ip(host):
            ips = [host]
        else:
            ips = await asyncio.get_running_loop().run_in_executor(None, resolve, host)
    except OSError as exc:
        raise UnsafeURL(f"cannot resolve {host}") from exc
    if not ips or not all(_is_public(ip) for ip in ips):
        raise UnsafeURL("URL resolves to a non-public address")
    return url
