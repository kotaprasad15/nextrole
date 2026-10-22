"""HTTP-level protections applied to every response/request: security headers and CSRF.

CSRF (the browser sends our session cookie automatically, so a hostile page could make the
browser POST to us). Three layers, any one of which stops the classic attack:
1. the session cookie is SameSite=Lax (not sent on cross-site POST/PUT/DELETE);
2. Origin/Referer, when a browser sends them, must be one of our own origins;
3. double-submit token: once logged in, every state-changing request must carry an
   `X-CSRF-Token` header equal to the (JS-readable) `nextrole_csrf` cookie. A cross-site page
   cannot read our cookie, so it cannot forge the header.
Safe methods (GET/HEAD/OPTIONS) never change state here and are not checked.
"""
import hmac
import secrets
from urllib.parse import urlparse

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

SESSION_COOKIE = "nextrole_session"
CSRF_COOKIE = "nextrole_csrf"
CSRF_HEADER = "x-csrf-token"
UNSAFE = {"POST", "PUT", "PATCH", "DELETE"}
# Token-authenticated by a signed link in an email, not by our cookies: no session to ride.
CSRF_EXEMPT_PREFIXES = ("/alerts/unsubscribe",)
# Logging out must always work (the 401 handler calls it when the CSRF cookie may already be gone, and
# a forged logout is a nuisance, not a breach). The Origin check still applies.
TOKEN_EXEMPT_PATHS = ("/auth/logout",)
# Interactive API docs need inline scripts and a CDN; they get a relaxed policy (disable in prod).
DOCS_PATHS = ("/docs", "/redoc", "/openapi.json")

API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
DOCS_CSP = ("default-src 'self'; img-src 'self' data: https://fastapi.tiangolo.com; "
            "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
            "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; frame-ancestors 'none'")


def new_csrf_token() -> str:
    return secrets.token_urlsafe(32)


def _origin_of(url: str) -> str:
    p = urlparse(url)
    return f"{p.scheme}://{p.netloc}" if p.scheme and p.netloc else ""


class SecurityMiddleware:
    """Pure ASGI middleware (no BaseHTTPMiddleware: it would buffer streaming/SSE responses)."""

    def __init__(self, app: ASGIApp, *, csrf_enabled: bool, allowed_origins: set[str], hsts: bool) -> None:
        self.app = app
        self.csrf_enabled = csrf_enabled
        self.allowed_origins = allowed_origins
        self.hsts = hsts

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        request = Request(scope)
        if self.csrf_enabled and request.method in UNSAFE:
            denied = self._csrf_problem(request)
            if denied:
                response = JSONResponse({"detail": denied}, status_code=403)
                return await self._with_headers(response, scope, receive, send, request.url.path)
        await self.app(scope, receive, self._wrap_send(send, request.url.path))

    def _csrf_problem(self, request: Request) -> str | None:
        if request.url.path.startswith(CSRF_EXEMPT_PREFIXES):
            return None
        origin = request.headers.get("origin") or _origin_of(request.headers.get("referer", ""))
        if origin and origin != "null" and origin not in self.allowed_origins:
            return "cross-site request blocked"
        if origin == "null":
            return "cross-site request blocked"
        if request.cookies.get(SESSION_COOKIE) and request.url.path not in TOKEN_EXEMPT_PATHS:
            cookie = request.cookies.get(CSRF_COOKIE, "")
            header = request.headers.get(CSRF_HEADER, "")
            if not cookie or not header or not hmac.compare_digest(cookie, header):
                return "missing or invalid CSRF token"
        return None

    def _headers(self, path: str) -> list[tuple[bytes, bytes]]:
        csp = DOCS_CSP if path.startswith(DOCS_PATHS) else API_CSP
        h = {
            "x-content-type-options": "nosniff",
            "x-frame-options": "DENY",
            "referrer-policy": "strict-origin-when-cross-origin",
            "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
            "cross-origin-opener-policy": "same-origin",
            "cross-origin-resource-policy": "same-origin",
            "content-security-policy": csp,
            "cache-control": "no-store",  # API responses carry personal data: never cache them
        }
        if self.hsts:
            h["strict-transport-security"] = "max-age=63072000; includeSubDomains"
        return [(k.encode(), v.encode()) for k, v in h.items()]

    def _wrap_send(self, send: Send, path: str) -> Send:
        extra = self._headers(path)

        async def wrapped(message: dict) -> None:
            if message["type"] == "http.response.start":
                names = {k.lower() for k, _ in message.get("headers", [])}
                message = {**message, "headers": [*message.get("headers", []),
                                                  *[(k, v) for k, v in extra if k not in names]]}
            await send(message)

        return wrapped

    async def _with_headers(self, response, scope, receive, send, path) -> None:
        await response(scope, receive, self._wrap_send(send, path))
