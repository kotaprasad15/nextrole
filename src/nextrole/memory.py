"""Memory of past outreach and feedback, used to personalise the Writer's *style*.

Design decisions:
- Two sources: the notes the user left on past drafts ("too formal", "shorter please") and the
  drafts they approved (tone/structure examples). Both are the user's own data and are deleted
  with their account.
- Style only. The Writer is told never to reuse facts from memory, and the Critic still checks
  every claim against the current fact sheet, so a stale employer name or claim copied from
  an old draft is caught as unsupported and forces a rewrite.
- Bounded and truncated so memory cannot blow up the prompt or the budget.
"""
import sqlite3
from dataclasses import dataclass, field

from nextrole.config import Settings
from nextrole.db import repos

MAX_NOTE_CHARS = 240
MAX_EXAMPLE_CHARS = 900


@dataclass
class StyleMemory:
    notes: list[str] = field(default_factory=list)
    examples: list[str] = field(default_factory=list)

    def __bool__(self) -> bool:
        return bool(self.notes or self.examples)


def build_style_memory(
    conn: sqlite3.Connection, settings: Settings, user_id: int, exclude_job_id: str | None = None
) -> StyleMemory:
    notes = [
        f"({'liked' if r['rating'] > 0 else 'disliked'}) " + " ".join(r["note"].split())[:MAX_NOTE_CHARS]
        for r in repos.recent_feedback(conn, user_id, settings.style_memory_notes)
    ]
    examples = [
        d.body[:MAX_EXAMPLE_CHARS]
        for d in repos.approved_drafts(conn, user_id, settings.style_memory_examples, exclude_job_id)
    ]
    return StyleMemory(notes, examples)


def render_memory(memory: StyleMemory) -> str:
    header = (
        "\n\nUSER STYLE MEMORY: preferences learned from this user's past feedback and approved "
        "drafts. Use it for tone, length and structure ONLY. Do NOT reuse any facts, employers, "
        "names or claims from it; every claim must still come from the FACT SHEET."
    )
    parts = [header]
    if memory.notes:
        parts.append("Feedback the user gave on earlier drafts:\n" + "\n".join(f"- {n}" for n in memory.notes))
    if memory.examples:
        parts.append("Drafts the user previously approved (style reference):\n"
                     + "\n---\n".join(memory.examples))
    return "\n".join(parts)
