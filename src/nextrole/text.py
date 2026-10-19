"""Small text helpers."""
import html
import re

_TAG = re.compile(r"<[^>]+>")
_WS = re.compile(r"\s+")


def html_to_text(raw: str) -> str:
    """Convert (possibly entity-escaped) HTML to plain text.

    Greenhouse returns its `content` field HTML-escaped, so we unescape first, then strip
    tags, then unescape again for entities that were inside the markup.
    """
    unescaped = html.unescape(raw or "")
    return _WS.sub(" ", html.unescape(_TAG.sub(" ", unescaped))).strip()
