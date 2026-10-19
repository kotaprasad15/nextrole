"""Step implementations for orchestrated runs.

Each step is a small method returning `(state_update, detail)`: it does one thing with the
existing agents and reports a one-line, human-readable detail for the live feed. Cross-cutting
concerns (events, tracing, error policy) live in `graph.instrument`, not here, so the steps
read like the pipeline they implement.
"""
from nextrole.agents.critic import CriticAgent
from nextrole.agents.factsheet import build_fact_sheet
from nextrole.agents.ingest import IngestAgent
from nextrole.agents.matcher import MatcherAgent, select_candidates
from nextrole.agents.tiering import TieringAgent
from nextrole.agents.writer import WriterAgent
from nextrole.db import repos
from nextrole.memory import build_style_memory
from nextrole.models.match import MatchResult
from nextrole.orchestrator.state import Deps, RunState
from nextrole.outreach import rank_report, research_company


class Steps:
    def __init__(self, deps: Deps) -> None:
        self.d = deps

    # ---------------- recommendation steps ----------------

    async def discover(self, s: RunState) -> tuple[dict, str]:
        boards = self.d.boards_loader()
        found = await self.d.discover(boards, s["profile"].preferences)
        down = f" ({len(found.errors)} unavailable)" if found.errors else ""
        return {"found": found}, f"{len(found.jobs)} openings from {len(boards)} boards{down}"

    async def tier(self, s: RunState) -> tuple[dict, str]:
        if s["mode"] == "recommend":
            companies = sorted({j.company for j in s["found"].jobs})
        else:
            companies = [s["job"].company]
        tiers = await TieringAgent(self.d.llm, self.d.conn, self.d.settings).classify(companies)
        return {"tiers": tiers}, f"{len(tiers)} compan{'y' if len(tiers) == 1 else 'ies'} classified"

    async def select(self, s: RunState) -> tuple[dict, str]:
        st = self.d.settings
        found = s["found"]
        picked = select_candidates(found.jobs, s["tiers"], s["profile"], st.match_candidates,
                                   st.per_company_cap)
        return {"candidates": picked}, f"{len(picked)} candidates picked from {len(found.jobs)} openings"

    async def match(self, s: RunState) -> tuple[dict, str]:
        matcher = MatcherAgent(self.d.llm, self.d.settings)
        if s["mode"] == "recommend":
            cands = s["candidates"]
            matches = await matcher.score_all(s["profile"], cands) if cands else []
            return {"matches": matches}, f"scored {len(matches)} of {len(cands)} candidates"
        m = await matcher.score_one(s["profile"], s["job"])
        return {"matches": [m]}, f"match score {m.score}/100"

    async def pin(self, s: RunState) -> tuple[dict, str]:
        """Pasted job: store it right after matching so it is on the dashboard even if the
        later drafting steps fail."""
        job: MatchResult = s["matches"][0]
        repos.save_jobs(self.d.conn, [s["job"]])
        repos.add_pinned_match(self.d.conn, s["user_id"], job)
        return {}, "added to your dashboard"

    # ---------------- outreach steps ----------------

    async def ingest(self, s: RunState) -> tuple[dict, str]:
        job = await IngestAgent(self.d.llm, self.d.settings, self.d.http, self.d.resolver).run(
            url=s.get("url", ""), text=s.get("text", ""))
        return {"job": job}, f"{job.title} at {job.company}"

    async def research(self, s: RunState) -> tuple[dict, str]:
        research = await research_company(
            llm=self.d.llm, settings=self.d.settings, conn=self.d.conn, http=self.d.http,
            job=s["job"])
        return {"research": research}, f"{len(research.facts)} sourced facts about {s['job'].company}"

    async def facts(self, s: RunState) -> tuple[dict, str]:
        research = s.get("research")
        warnings = list(s.get("warnings", []))
        if research is not None and not research.facts:
            warnings.append("No reliable public information found about the company.")
        facts = build_fact_sheet(s["profile"], s["job"], research)
        memory = None
        detail = f"{len(facts)} facts available to the writer"
        if s.get("user_id"):
            memory = build_style_memory(self.d.conn, self.d.settings, s["user_id"], s["job"].id)
            if memory:
                detail += (f"; using {len(memory.notes)} feedback note(s) and "
                           f"{len(memory.examples)} past draft(s) for style")
        return {"facts": facts, "memory": memory, "warnings": warnings}, detail

    async def write(self, s: RunState) -> tuple[dict, str]:
        draft = await WriterAgent(self.d.llm, self.d.settings).write(
            facts=s["facts"], job=s["job"], channel=s.get("channel", "email"),
            recipient_name=s.get("recipient_name", ""), previous=s.get("previous"),
            memory=s.get("memory"))
        return {"draft": draft}, f"draft attempt {s.get('attempts', 0) + 1} ({len(draft.body.split())} words)"

    async def critic(self, s: RunState) -> tuple[dict, str]:
        draft = s["draft"]
        report = await CriticAgent(self.d.llm, self.d.settings).review(draft, s["facts"])
        best = s.get("best")
        if best is None or rank_report(report) > rank_report(best[1]):
            best = (draft, report)
        passed = report.verdict == "pass"
        detail = f"score {report.overall}/100, " + ("passed" if passed else "needs a rewrite")
        return {"attempts": s.get("attempts", 0) + 1, "previous": (draft, report), "best": best,
                "passed": passed, "reports": [*s.get("reports", []), report]}, detail

    async def save(self, s: RunState) -> tuple[dict, str]:
        if s["mode"] == "recommend":
            repos.save_jobs(self.d.conn, s["candidates"])
            repos.replace_matches(self.d.conn, s["user_id"], s["matches"])
            return {}, f"saved {len(s['matches'])} recommendations"

        draft, report = s["best"]
        warnings = list(s.get("warnings", []))
        if report.verdict == "pass":
            draft.status = "critic_passed"
        else:
            problems = report.unsupported_claims + report.violations
            why = (f": {'; '.join(problems[:3])}" if problems
                   else f" (score {report.overall}/{self.d.settings.critic_threshold})")
            warnings.append(f"The reviewer was not fully satisfied after {s.get('attempts', 0)} "
                            f"attempt(s){why}. Please review carefully before approving.")
        update: dict = {"best": (draft, report), "warnings": warnings}
        if s.get("persist", True):
            oid = repos.upsert_outreach(self.d.conn, s["user_id"], s["job"].id, draft, report,
                                        s["facts"], warnings, s.get("attempts", 0))
            update["outreach_id"] = oid
        return update, f"draft saved ({draft.status})"
