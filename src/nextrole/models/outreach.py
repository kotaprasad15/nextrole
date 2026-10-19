"""Outreach draft. Status never reaches a 'sent' state: drafts are human-approved only."""
from typing import Literal

from pydantic import BaseModel


class OutreachDraft(BaseModel):
    job_id: str
    subject: str
    body: str
    status: Literal["draft", "critic_passed", "user_approved"] = "draft"
