"""Job posting as returned by a source API. `apply_url` is set only by connectors."""
import hashlib

from pydantic import BaseModel, computed_field

from nextrole.models.common import HttpsUrl


class Job(BaseModel):
    source: str
    source_id: str
    title: str
    company: str
    location: str = ""
    remote: bool = False
    description: str = ""
    apply_url: HttpsUrl
    is_open: bool = True

    @computed_field  # type: ignore[prop-decorator]
    @property
    def id(self) -> str:
        """Stable id so the LLM can reference a job without ever handling its URL."""
        return hashlib.sha1(f"{self.source}:{self.source_id}".encode()).hexdigest()[:12]
