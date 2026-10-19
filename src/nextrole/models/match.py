"""Matcher output. References a job by id only; the LLM never produces URLs."""
from pydantic import BaseModel, Field


class MatchScore(BaseModel):
    """What the model returns (no job_id: we attach it, so the model can't mislabel rows)."""

    score: int = Field(ge=0, le=100)
    strengths: list[str] = Field(default_factory=list, max_length=5)
    gaps: list[str] = Field(default_factory=list, max_length=5)
    rationale: str = Field(max_length=240, description="One sentence: why this fits the candidate")


class MatchResult(MatchScore):
    job_id: str
