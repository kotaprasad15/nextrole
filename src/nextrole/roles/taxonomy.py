"""Role taxonomy: companies name the same job differently (SDE, Software Development Engineer,
Member of Technical Staff...), so ranking and alerts compare ROLES, not title strings.

Three levels, cheapest first:
1. `canonicalize(text)`: strip seniority and punctuation, then look for a known alias (whole-phrase
   match, longest alias wins). "Sr. Software Development Engineer II" -> software_engineer.
2. `roles_match(title, roles)`: a posting matches a wanted role when they share a canonical role, or
   the wanted text appears in the title, or (for custom roles we do not know) every word of it does.
3. Anything fuzzier (a role nobody wrote down, a creative title) is for the semantic matcher in
   `alerts/` (embeddings + LLM verification); this module stays deterministic and free.
Backend Engineer and Software Engineer are deliberately DIFFERENT canonicals but related: a backend
role also satisfies a wanted "software engineer" (`RELATED`), not the other way round.
"""
import json
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

DATA = Path(__file__).parent.parent / "data" / "roles.json"
_SENIORITY = re.compile(
    r"\b(senior|sr|staff|principal|lead|junior|jr|intern|internship|graduate|new grad|entry level|associate|"
    r"early career|i{1,3}|iv|v|[1-5]|level \d)\b")
_NON_WORD = re.compile(r"[^a-z0-9+#/ ]+")
# A posting for the key also satisfies a wanted role of any value in the set.
RELATED = {
    "backend_engineer": {"software_engineer"},
    "frontend_engineer": {"software_engineer"},
    "fullstack_engineer": {"software_engineer", "backend_engineer", "frontend_engineer"},
    "mobile_engineer": {"software_engineer"},
    "ml_engineer": {"software_engineer"},
    "devops_engineer": {"software_engineer"},
    "security_engineer": {"software_engineer"},
    "forward_deployed_engineer": {"software_engineer", "solutions_engineer"},
    "embedded_engineer": {"software_engineer"},
    "data_engineer": {"software_engineer"},
}


@dataclass(frozen=True)
class Role:
    canonical: str
    label: str
    aliases: tuple[str, ...]


@lru_cache(maxsize=1)
def taxonomy() -> tuple[Role, ...]:
    raw = json.loads(DATA.read_text(encoding="utf-8"))
    return tuple(Role(r["canonical"], r["label"], tuple(r["aliases"])) for r in raw)


def normalize(text: str) -> str:
    """Lowercase, drop punctuation and seniority/level words, collapse spaces."""
    text = _NON_WORD.sub(" ", text.lower().replace("-", " ").replace(",", " "))
    return " ".join(_SENIORITY.sub(" ", text).split())


@lru_cache(maxsize=1)
def _alias_index() -> list[tuple[str, str]]:
    pairs = [(normalize(a), r.canonical) for r in taxonomy() for a in (*r.aliases, r.label)]
    return sorted(set(pairs), key=lambda p: -len(p[0]))  # longest alias first


def canonicalize(text: str) -> str | None:
    """The canonical role this text names, or None if it is not one we know."""
    norm = f" {normalize(text)} "
    for alias, canonical in _alias_index():
        if alias and f" {alias} " in norm:
            return canonical
    return None


def label(canonical: str) -> str:
    return next((r.label for r in taxonomy() if r.canonical == canonical), canonical)


def aliases(canonical: str) -> list[str]:
    return next((list(r.aliases) for r in taxonomy() if r.canonical == canonical), [])


def _satisfies(title_role: str | None, wanted_role: str | None) -> bool:
    return bool(title_role and wanted_role and (
        title_role == wanted_role or wanted_role in RELATED.get(title_role, set())))


def role_matches(title: str, wanted: str) -> bool:
    """Does a job title fit ONE wanted role (known or custom)?"""
    title_norm, wanted_norm = normalize(title), normalize(wanted)
    if not wanted_norm:
        return False
    if _satisfies(canonicalize(title), canonicalize(wanted)):
        return True
    if wanted_norm in title_norm:
        return True
    words = set(wanted_norm.split())  # custom role: every word must appear ("growth marketer")
    return len(words) >= 2 and words <= set(title_norm.split())


def roles_match(title: str, wanted: list[str]) -> bool:
    return any(role_matches(title, w) for w in wanted)


def resolve(roles: list[str]) -> list[dict]:
    """For the UI: what each wanted role means to us."""
    out = []
    for text in roles:
        canonical = canonicalize(text)
        out.append({"text": text, "canonical": canonical, "label": label(canonical) if canonical else None,
                    "also_matches": aliases(canonical)[:6] if canonical else []})
    return out
