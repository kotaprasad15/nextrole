"""Job posting. `apply_url` is set only by source connectors, or supplied by the user.

Design decision: `apply_url` is optional ONLY for jobs the user pasted as text without a
link (source == "pasted"). Every connector-sourced job must have a validated https URL; we
never invent a link to fill the gap.
"""
import hashlib

from pydantic import BaseModel, computed_field, model_validator

from nextrole.models.common import HttpsUrl


class Job(BaseModel):
    source: str
    source_id: str
    title: str
    company: str
    location: str = ""
    remote: bool = False
    description: str = ""
    apply_url: HttpsUrl | None = None
    is_open: bool = True

    @model_validator(mode="after")
    def _require_url_unless_pasted(self) -> "Job":
        if self.apply_url is None and self.source != "pasted":
            raise ValueError("apply_url is required for jobs from source APIs")
        return self

    @computed_field  # type: ignore[prop-decorator]
    @property
    def id(self) -> str:
        """Stable id so the LLM can reference a job without ever handling its URL."""
        return hashlib.sha1(f"{self.source}:{self.source_id}".encode()).hexdigest()[:12]
