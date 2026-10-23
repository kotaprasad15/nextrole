"""Matcher output. References a job by id only; the LLM never produces URLs."""
from pydantic import BaseModel, Field, field_validator

from nextrole.security.text import strip_links


class MatchScore(BaseModel):
    """What the model returns (no job_id: we attach it, so the model can't mislabel rows)."""

    score: int = Field(ge=0, le=100)
    strengths: list[str] = Field(default_factory=list, max_length=5)
    gaps: list[str] = Field(default_factory=list, max_length=5)
    rationale: str = Field(max_length=240, description="One sentence: why this fits the candidate")

    @field_validator("strengths", "gaps", mode="after")
    @classmethod
    def _no_links_in_lists(cls, items: list[str]) -> list[str]:
        return [clean for s in items if (clean := strip_links(s))]

    @field_validator("rationale", mode="after")
    @classmethod
    def _no_links_in_rationale(cls, text: str) -> str:
        return strip_links(text)  # the model never emits links; anything link-like is dropped


class MatchResult(MatchScore):
    job_id: str
