"""Live demo (no API key needed): `uv run python -m nextrole.jobs_demo "software engineer" "remote"`."""
import asyncio
import sys

from nextrole.models.profile import Preferences
from nextrole.sources.registry import discover, load_boards


async def main(role: str, location: str) -> None:
    prefs = Preferences(roles=[role], locations=[location] if location != "remote" else [])
    res = await discover(load_boards(), prefs)
    print(f"{len(res.jobs)} jobs from {len(load_boards())} boards; {len(res.errors)} failed")
    for k, v in res.errors.items():
        print(f"  ! {k}: {v}")
    for j in res.jobs[:15]:
        print(f"- {j.title} | {j.company} | {j.location}\n    {j.apply_url}")


if __name__ == "__main__":
    args = sys.argv[1:]
    asyncio.run(main(args[0] if args else "software engineer", args[1] if len(args) > 1 else "remote"))
