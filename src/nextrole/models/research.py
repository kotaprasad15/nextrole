"""Research output and the FactSheet that grounds outreach.

Design decision: every fact the Writer may use has an id and a source. The Writer must cite
fact ids for each claim; the Critic then checks claims against the fact text. URLs on facts
come from tool results (never LLM output) and are https-validated.
"""
from typing import Literal

from pydantic import BaseModel, Field

from nextrole.models.common import HttpsUrl


class Fact(BaseModel):
    id: str
    text: str
    source: Literal["profile", "job", "research"]
    source_ref: HttpsUrl | None = None


class NewsItem(BaseModel):
    headline: str
    url: HttpsUrl
    date: str = ""


class CompanyResearch(BaseModel):
    company_key: str
    summary: str = ""
    facts: list[Fact] = Field(default_factory=list)
    news: list[NewsItem] = Field(default_factory=list)
