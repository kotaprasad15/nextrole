"""Orchestrated runs: start one (202), follow it live over SSE, read its history."""
import asyncio
import json
import sqlite3
from collections.abc import AsyncIterator
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from nextrole.api.deps import current_user_id, get_conn
from nextrole.db import repos
from nextrole.models.outreach import Channel
from nextrole.orchestrator.manager import RunConflict, RunManager

router = APIRouter()
HEARTBEAT_S = 15.0


class StartRun(BaseModel):
    mode: Literal["recommend", "outreach", "single_job"]
    job_id: str = ""  # outreach: a job from your matches
    channel: Channel = "email"
    recipient_name: str = Field(default="", max_length=80)
    url: str = Field(default="", max_length=2000)  # single_job: posting link
    text: str = Field(default="", max_length=30_000)  # single_job: pasted posting text


def _manager(request: Request) -> RunManager:
    return request.app.state.run_manager


def _sse(data: dict, event_id: int | None = None) -> str:
    head = f"id: {event_id}\n" if event_id is not None else ""
    return f"{head}data: {json.dumps(data)}\n\n"


@router.post("/runs", status_code=202)
async def start_run(  # async: it creates a task, which needs the running event loop
    body: StartRun, request: Request, user_id: int = Depends(current_user_id),
    conn: sqlite3.Connection = Depends(get_conn),
) -> dict:
    profile = repos.get_profile(conn, user_id)
    if profile is None:
        raise HTTPException(409, "complete onboarding first")
    initial: dict = {"profile": profile, "channel": body.channel,
                     "recipient_name": body.recipient_name}
    if body.mode == "outreach":
        job = repos.get_job_for_user(conn, user_id, body.job_id)
        if job is None:
            raise HTTPException(404, "job not found in your recommendations")
        initial["job"] = job
    elif body.mode == "single_job":
        if not body.url.strip() and not body.text.strip():
            raise HTTPException(422, "paste a job posting link or its text")
        initial.update(url=body.url, text=body.text)
    try:
        run_id = _manager(request).start(user_id=user_id, mode=body.mode, initial=initial)
    except RunConflict as exc:
        raise HTTPException(409, str(exc)) from exc
    return {"run_id": run_id}


@router.get("/runs")
def list_runs(
    user_id: int = Depends(current_user_id), conn: sqlite3.Connection = Depends(get_conn)
) -> list[dict]:
    return [dict(r) for r in repos.list_runs(conn, user_id)]


@router.get("/runs/{run_id}")
def get_run(
    run_id: str, user_id: int = Depends(current_user_id),
    conn: sqlite3.Connection = Depends(get_conn),
) -> dict:
    row = repos.get_run(conn, user_id, run_id)
    if row is None:
        raise HTTPException(404, "run not found")
    return {**{k: row[k] for k in ("id", "mode", "status", "job_id", "tokens", "cost_usd",
                                   "error", "started_at", "finished_at")},
            "result": json.loads(row["result_json"]), "events": json.loads(row["events_json"])}


@router.get("/runs/{run_id}/events")
async def run_events(
    run_id: str, request: Request, user_id: int = Depends(current_user_id),
    conn: sqlite3.Connection = Depends(get_conn),
) -> StreamingResponse:
    """Server-Sent Events: replays past steps, then streams live until `run_finished`."""
    sink = _manager(request).sink_for(user_id, run_id)
    row = None if sink else repos.get_run(conn, user_id, run_id)
    if sink is None and row is None:
        raise HTTPException(404, "run not found")

    async def stream() -> AsyncIterator[str]:
        if sink is None:  # finished run: replay its stored events
            for e in json.loads(row["events_json"]):
                yield _sse(e, e["seq"])
            return
        async for event in sink.stream(heartbeat=HEARTBEAT_S):
            if event is None:
                if await request.is_disconnected():
                    return
                yield ": keepalive\n\n"
            else:
                yield _sse(event.model_dump(), event.seq)
            await asyncio.sleep(0)

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
