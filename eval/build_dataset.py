"""Build the frozen postings dataset: 30 real postings, 6 per sample profile.

Run once (`uv run python -m eval.build_dataset`) and commit `datasets/postings_30.jsonl`.
Freezing matters: live boards change daily, and an evaluation must compare both systems on
the same inputs and be reproducible later. Postings come from the same public Greenhouse /
Lever / Ashby endpoints as the product; descriptions are truncated to keep the file small.

Selection is deterministic given a snapshot: for each profile keep jobs whose title matches
its target roles, rank by the product's own keyword prefilter, and take the best posting from
each of 6 distinct companies, never reusing a company across profiles (broad coverage).
"""
import asyncio
import json
from datetime import UTC, datetime
from pathlib import Path

from nextrole.agents.matcher import prefilter
from nextrole.models.profile import Preferences, Profile
from nextrole.sources.registry import discover, load_boards, matches

DATASETS = Path(__file__).parent / "datasets"
PER_PROFILE = 6
MIN_DESCRIPTION = 500
MAX_DESCRIPTION = 3500


def load_profiles() -> list[Profile]:
    raw = json.loads((DATASETS / "profiles_5.json").read_text(encoding="utf-8"))
    return [Profile(**{k: v for k, v in p.items() if k != "id"}) for p in raw]


def load_profile_ids() -> list[str]:
    return [p["id"] for p in json.loads((DATASETS / "profiles_5.json").read_text(encoding="utf-8"))]


async def build(out: Path) -> int:
    found = await discover(load_boards(), Preferences())  # no filter: the whole pool
    pool = [j for j in found.jobs if j.apply_url and len(j.description) >= MIN_DESCRIPTION]
    print(f"pool: {len(pool)} jobs from {len({j.company for j in pool})} companies; "
          f"{len(found.errors)} boards failed")
    used_companies: set[str] = set()
    records = []
    for pid, profile in zip(load_profile_ids(), load_profiles(), strict=True):
        eligible = [j for j in pool if matches(j, profile.preferences)
                    and j.company not in used_companies]
        ranked = prefilter(eligible, profile, limit=len(eligible), per_company_cap=1)
        for job in ranked[:PER_PROFILE]:
            used_companies.add(job.company)
            records.append({
                "id": job.id, "profile_id": pid, "company": job.company, "title": job.title,
                "location": job.location, "source": job.source, "apply_url": job.apply_url,
                "description": job.description[:MAX_DESCRIPTION],
                "snapshot": datetime.now(UTC).date().isoformat()})
    out.write_text("\n".join(json.dumps(r) for r in records) + "\n", encoding="utf-8")
    print(f"wrote {len(records)} postings -> {out}")
    return len(records)


if __name__ == "__main__":
    asyncio.run(build(DATASETS / "postings_30.jsonl"))
