"""Interview experiences: the structured submission and what the API returns.

Everything a user types is untrusted. Text fields are cleaned to PLAIN text by validators (tags,
entities, control and invisible characters removed, length capped) before they are ever stored, and the
frontend renders them as text, never as HTML. Rounds describe the KIND of questions (coding, system
design, ...) and how hard they were, not verbatim questions: the submission form says so, and the
moderation rules look for dumps of exact questions because those are what companies' NDAs cover.
"""
import re
from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from nextrole.security.text import plain_text

LEVELS = ("intern", "new_grad", "junior", "mid", "senior", "staff", "manager", "other")
OUTCOMES = ("offer", "rejected", "withdrew", "no_decision")
ROUND_TYPES = ("recruiter_screen", "online_assessment", "coding", "system_design", "behavioral", "take_home",
               "hiring_manager", "onsite_loop", "other")
STATUSES = ("pending", "approved", "rejected", "removed")
REPORT_REASONS = ("pii", "confidential", "harassment", "spam", "inaccurate", "other")
_MONTH = re.compile(r"^(\d{4})-(0[1-9]|1[0-2])$")

Level = Literal["intern", "new_grad", "junior", "mid", "senior", "staff", "manager", "other"]
Outcome = Literal["offer", "rejected", "withdrew", "no_decision"]
RoundType = Literal["recruiter_screen", "online_assessment", "coding", "system_design", "behavioral", "take_home",
                    "hiring_manager", "onsite_loop", "other"]
Status = Literal["pending", "approved", "rejected", "removed"]
ReportReason = Literal["pii", "confidential", "harassment", "spam", "inaccurate", "other"]


def _clean_line(v: str, max_len: int) -> str:
    return " ".join(plain_text(v, max_len).split())


class RoundIn(BaseModel):
    type: RoundType
    difficulty: int = Field(ge=1, le=5)
    notes: str = Field(default="", max_length=1200)

    @field_validator("notes", mode="after")
    @classmethod
    def _plain(cls, v: str) -> str:
        return plain_text(v, 600)


class ExperienceIn(BaseModel):
    company: str = Field(min_length=1, max_length=160)
    role: str = Field(min_length=1, max_length=160)
    level: Level
    interviewed_on: str = Field(description="YYYY-MM")
    rounds: list[RoundIn] = Field(min_length=1, max_length=10)
    difficulty: int = Field(ge=1, le=5)
    outcome: Outcome
    tips: str = Field(default="", max_length=3000)
    anonymous: bool = True  # privacy first: the author is hidden unless they choose otherwise

    @field_validator("company", "role", mode="after")
    @classmethod
    def _line(cls, v: str) -> str:
        v = _clean_line(v, 80)
        if not v:
            raise ValueError("cannot be empty")
        return v

    @field_validator("tips", mode="after")
    @classmethod
    def _tips(cls, v: str) -> str:
        return plain_text(v, 1500)

    @field_validator("interviewed_on")
    @classmethod
    def _month(cls, v: str) -> str:
        m = _MONTH.match(v.strip())
        if not m:
            raise ValueError("use the format YYYY-MM")
        now = datetime.now(UTC)
        year, month = int(m.group(1)), int(m.group(2))
        if (year, month) > (now.year, now.month):
            raise ValueError("the interview cannot be in the future")
        if year < now.year - 10:
            raise ValueError("experiences older than 10 years are not useful to candidates")
        return v.strip()

    @model_validator(mode="after")
    def _has_substance(self) -> "ExperienceIn":
        if not self.tips and not any(r.notes for r in self.rounds):
            raise ValueError("add a few notes about the rounds or some tips, so others can learn from it")
        return self

    def all_text(self) -> str:
        parts = [self.company, self.role, self.tips, *[r.notes for r in self.rounds]]
        return "\n".join(p for p in parts if p)


class ReportIn(BaseModel):
    reason: ReportReason
    detail: str = Field(default="", max_length=600)

    @field_validator("detail", mode="after")
    @classmethod
    def _plain(cls, v: str) -> str:
        return plain_text(v, 300)


class ModerationNote(BaseModel):
    note: str = Field(default="", max_length=600)

    @field_validator("note", mode="after")
    @classmethod
    def _plain(cls, v: str) -> str:
        return plain_text(v, 300)
