"""Company tier types and name normalization (the cache key for tier lookups)."""
import re
from typing import Literal

from pydantic import BaseModel

Tier = Literal["startup", "mid", "mnc"]
TierMethod = Literal["seed", "metadata", "llm"]

_NON_ALNUM = re.compile(r"[^a-z0-9]+")
_SUFFIXES = {"inc", "llc", "ltd", "limited", "corp", "corporation", "co", "gmbh", "plc", "ag", "sa"}


def normalize_company(name: str) -> str:
    """'Stripe, Inc.' and 'stripe' must map to the same cache key."""
    words = [w for w in _NON_ALNUM.sub(" ", name.lower()).split() if w not in _SUFFIXES]
    return " ".join(words)


class CompanyTier(BaseModel):
    company_key: str
    tier: Tier
    method: TierMethod
    confidence: float = 1.0
