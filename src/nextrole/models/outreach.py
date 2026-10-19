"""Outreach draft + critic report.

Status machine (there is deliberately no 'sent' state; the app never sends anything):
  draft -> critic_passed -> user_approved
An edit by the user resets to 'draft'; approval is always an explicit user action.
"""
from typing import Literal

from pydantic import BaseModel, Field

Channel = Literal["email", "message"]
Status = Literal["draft", "critic_passed", "user_approved"]


class Claim(BaseModel):
    text: str
    fact_ids: list[str] = Field(min_length=1)


class OutreachDraft(BaseModel):
    job_id: str
    channel: Channel = "email"
    subject: str = ""
    body: str
    claims: list[Claim] = Field(default_factory=list)
    status: Status = "draft"


class CriticReport(BaseModel):
    scores: dict[str, int]  # specificity, tone, grounding, no_fluff, length (0-100 each)
    overall: int
    unsupported_claims: list[str] = Field(default_factory=list)
    violations: list[str] = Field(default_factory=list)  # deterministic rule failures
    verdict: Literal["pass", "revise"]
    rewrite_instructions: str = ""
