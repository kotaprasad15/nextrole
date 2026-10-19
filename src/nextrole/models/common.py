"""Shared validated types."""
from typing import Annotated
from urllib.parse import urlparse

from pydantic import AfterValidator


def _require_https(url: str) -> str:
    """Hard constraint: every displayed link must be a well-formed https URL."""
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.netloc or " " in url:
        raise ValueError(f"not a well-formed https URL: {url!r}")
    return url


HttpsUrl = Annotated[str, AfterValidator(_require_https)]
