"""Onboarding (preferences + resume upload -> Intake agent) and profile review/edit."""
import sqlite3

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from nextrole.agents.intake import run_intake
from nextrole.api.deps import current_user_id, get_conn, get_llm, get_settings_dep, get_store
from nextrole.config import Settings
from nextrole.db import repos
from nextrole.llm.budget import BudgetExceeded
from nextrole.llm.client import LLMClient
from nextrole.models.profile import Preferences, Profile
from nextrole.resume.extract import ResumeError, extract_text
from nextrole.resume.storage import ResumeStore

router = APIRouter()


def _split(csv: str) -> list[str]:
    return [p.strip() for p in csv.split(",") if p.strip()]


@router.post("/onboarding", response_model=Profile)
async def onboarding(
    roles: str = Form(...),
    locations: str = Form(""),
    remote_ok: bool = Form(True),
    experience_level: str = Form(""),
    extras: str = Form(""),
    resume: UploadFile = File(...),
    user_id: int = Depends(current_user_id),
    conn: sqlite3.Connection = Depends(get_conn),
    settings: Settings = Depends(get_settings_dep),
    store: ResumeStore = Depends(get_store),
    llm: LLMClient = Depends(get_llm),
) -> Profile:
    prefs = Preferences(
        roles=_split(roles), locations=_split(locations), remote_ok=remote_ok,
        experience_level=experience_level, extras=extras,
    )
    if not prefs.roles:
        raise HTTPException(422, "at least one desired role is required")
    max_bytes = settings.max_upload_mb * 1024 * 1024
    data = await resume.read(max_bytes + 1)  # bounded read: never buffer an unbounded upload
    try:
        text = extract_text(data, max_bytes)
    except ResumeError as exc:
        raise HTTPException(422, str(exc)) from exc
    try:
        profile = await run_intake(llm, settings.model_fast, text, prefs)
    except BudgetExceeded as exc:
        raise HTTPException(429, str(exc)) from exc
    except ValueError as exc:  # schema validation failed after the repair retry
        raise HTTPException(502, "could not parse resume into a profile; try again") from exc
    old = repos.get_resume_path(conn, user_id)
    repos.save_profile(conn, user_id, profile, store.save(data))
    store.delete(old)
    return profile


@router.get("/profile", response_model=Profile)
def get_profile(
    user_id: int = Depends(current_user_id), conn: sqlite3.Connection = Depends(get_conn)
) -> Profile:
    profile = repos.get_profile(conn, user_id)
    if profile is None:
        raise HTTPException(404, "no profile yet: complete onboarding")
    return profile


@router.put("/profile", response_model=Profile)
def update_profile(
    profile: Profile,
    user_id: int = Depends(current_user_id),
    conn: sqlite3.Connection = Depends(get_conn),
) -> Profile:
    """Review/edit step: the user's edited profile replaces the extracted one."""
    repos.save_profile(conn, user_id, profile)
    return profile
