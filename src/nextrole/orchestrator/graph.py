"""The Orchestrator: a LangGraph supervisor that plans each run, routes work, and enforces caps.

Shape: every worker step returns to one `orchestrator` node, which decides the next step. That
single choke point is where the guarantees live:
  * step cap          - `run_max_steps` total steps (LangGraph's recursion limit is a backstop)
  * budget            - checked before every step; when exhausted we skip remaining work but
                        still save whatever was produced
  * rewrite loop cap  - after the Critic, go back to the Writer only while the draft fails and
                        fewer than `critic_max_retries` rewrites have happened
  * failure policy    - per step: research failures are skipped, writer/critic failures keep
                        the best draft so far, anything else aborts the run

Design decision: the plan is rule-based, not an LLM call. The pipelines are fixed per mode, so
an LLM planner would add cost and nondeterminism without improving routing; the orchestration
value is in the routing, caps and recovery, which are deterministic and testable (`decide`).
"""
import asyncio
import logging
import time
from collections.abc import Awaitable, Callable

from langgraph.errors import GraphRecursionError
from langgraph.graph import END, StateGraph

from nextrole.agents.ingest import IngestError
from nextrole.config import Settings
from nextrole.llm.budget import BudgetExceeded
from nextrole.orchestrator.nodes import Steps
from nextrole.orchestrator.state import Deps, RunState

log = logging.getLogger(__name__)

PLANS: dict[str, list[str]] = {
    "recommend": ["discover", "tier", "select", "match", "save"],
    "outreach": ["research", "facts", "write", "critic", "save"],
    "single_job": ["ingest", "tier", "match", "pin", "research", "facts", "write", "critic", "save"],
}
LOOP_STEPS = ("write", "critic")
# What to do when a step raises: "skip" (continue without it), "loop" (keep the best draft so
# far), otherwise abort the run.
FAILURE_POLICY = {"research": "skip", "write": "loop", "critic": "loop"}

StepFn = Callable[[RunState], Awaitable[tuple[dict, str]]]


def decide(
    state: RunState, *, max_steps: int, max_rewrites: int, budget_exhausted: bool
) -> tuple[str, dict]:
    """Pure routing function: (next step name, state updates). Unit-tested directly."""
    steps = state.get("steps", 0)
    updates: dict = {"steps": steps + 1}
    if state.get("abort"):
        return "finalize", updates
    if steps >= max_steps:
        updates.update(abort=True, error=f"step limit ({max_steps}) reached", error_kind="error")
        return "finalize", updates

    plan, last = state["plan"], state.get("last")
    if last is None:
        nxt = plan[0]
    elif state.get("stop_loop") and last in LOOP_STEPS:
        # A rewrite failed (or the loop was stopped): do not review a stale draft; save the best.
        nxt = plan[plan.index("critic") + 1]
    elif last == "critic":
        done = (state.get("passed") or state.get("stop_loop")
                or state.get("rewrites", 0) >= max_rewrites)
        if done:
            nxt = plan[plan.index("critic") + 1]
        else:
            nxt = "write"
            updates["rewrites"] = state.get("rewrites", 0) + 1
    else:
        i = plan.index(last) + 1
        nxt = plan[i] if i < len(plan) else "finalize"

    if budget_exhausted and nxt not in ("save", "finalize"):
        partial = state.get("best") or (state["mode"] == "recommend" and state.get("matches"))
        if partial:
            updates["warnings"] = [*state.get("warnings", []),
                                   "Run budget reached; showing the results produced so far."]
            nxt = "save"
        else:
            updates.update(abort=True, error="run budget exhausted", error_kind="budget")
            nxt = "finalize"
    return nxt, updates


def _failure_update(name: str, exc: Exception, state: RunState) -> tuple[dict, str]:
    """Apply the step's failure policy. Returns (state update, user-facing message)."""
    if isinstance(exc, (BudgetExceeded, IngestError)):
        kind, msg = ("budget" if isinstance(exc, BudgetExceeded) else "ingest"), str(exc)
    else:
        kind, msg = "error", f"{name} failed ({type(exc).__name__})"
        log.exception("step %s failed", name, exc_info=exc)
    warnings = list(state.get("warnings", []))
    policy = FAILURE_POLICY.get(name, "abort")
    if policy == "skip":
        warnings.append(f"Company research unavailable ({type(exc).__name__}); "
                        "used the job posting only.")
        return {"research": None, "warnings": warnings}, msg
    if policy == "loop" and state.get("best"):
        warnings.append(f"Stopped early ({type(exc).__name__}); showing the best draft so far.")
        return {"stop_loop": True, "warnings": warnings}, msg
    return {"abort": True, "error": msg, "error_kind": kind, "warnings": warnings}, msg


def _instrument(name: str, fn: StepFn, deps: Deps) -> Callable[[RunState], Awaitable[dict]]:
    """Wrap a step with events, tracing and its failure policy."""
    async def node(state: RunState) -> dict:
        sink, budget = deps.sink, deps.llm.budget
        data = {"attempt": state.get("attempts", 0) + 1} if name in LOOP_STEPS else {}
        sink.emit("step_started", step=name, data=data)
        start = time.perf_counter()
        try:
            update, detail = await fn(state)
            event_type = "step_finished"
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - every step failure goes through its policy
            update, detail = _failure_update(name, exc, state)
            event_type = "step_failed"
        latency = (time.perf_counter() - start) * 1000
        sink.emit(event_type, step=name, detail=detail, latency_ms=round(latency, 1),
                  tokens=budget.tokens_used, cost_usd=round(budget.cost_usd, 6), data=data)
        if deps.llm.tracer:
            deps.llm.tracer.record(f"step:{name}", {}, {"status": event_type, "detail": detail},
                                   latency_ms=latency)
        return {**update, "last": name}

    return node


def _finalize(state: RunState) -> dict:
    mode = state["mode"]
    failed = bool(state.get("abort"))
    result: dict = {"warnings": state.get("warnings", [])}
    if mode == "recommend":
        found = state.get("found")
        result.update(
            discovered=len(found.jobs) if found else 0,
            candidates=len(state.get("candidates", [])),
            matched=len(state.get("matches", [])),
            source_errors=found.errors if found else {})
    else:
        job = state.get("job")
        result.update(job_id=job.id if job else None, outreach_id=state.get("outreach_id"),
                      attempts=state.get("attempts", 0))
    if failed:
        result["error"] = state.get("error", "run failed")
    return {"status": "failed" if failed else "completed", "result": result}


def build_graph(deps: Deps):
    steps = Steps(deps)
    names = sorted({n for plan in PLANS.values() for n in plan})
    settings: Settings = deps.settings

    def orchestrate(state: RunState) -> dict:
        nxt, updates = decide(
            state, max_steps=settings.run_max_steps, max_rewrites=settings.critic_max_retries,
            budget_exhausted=deps.llm.budget.exhausted)
        return {**updates, "next": nxt}

    graph = StateGraph(RunState)
    graph.add_node("orchestrator", orchestrate)
    graph.add_node("finalize", _finalize)
    for name in names:
        # Node ids are prefixed because LangGraph forbids a node sharing a state key's name
        # (e.g. the `facts` step vs the `facts` state field).
        graph.add_node(f"step_{name}", _instrument(name, getattr(steps, name), deps))
        graph.add_edge(f"step_{name}", "orchestrator")
    graph.set_entry_point("orchestrator")
    graph.add_conditional_edges(
        "orchestrator", lambda s: "finalize" if s["next"] == "finalize" else f"step_{s['next']}",
        {**{f"step_{n}": f"step_{n}" for n in names}, "finalize": "finalize"})
    graph.add_edge("finalize", END)
    return graph.compile()


async def run_graph(mode: str, deps: Deps, initial: dict) -> RunState:
    """Run one orchestrated pipeline to completion and return the final state."""
    plan = PLANS[mode]
    state: RunState = {
        "persist": True, **initial, "mode": mode, "plan": plan, "steps": 0, "rewrites": 0,
        "attempts": 0, "warnings": [],
    }  # type: ignore[typeddict-item]
    deps.sink.emit("run_started", data={"mode": mode})
    deps.sink.emit("plan", data={"steps": plan})
    graph = build_graph(deps)
    try:
        return await graph.ainvoke(state, config={
            "recursion_limit": deps.settings.run_max_steps * 2 + 10})
    except GraphRecursionError:
        return {**state, "abort": True, "status": "failed", "error_kind": "error",
                "error": "step limit reached", "result": {"error": "step limit reached"}}
