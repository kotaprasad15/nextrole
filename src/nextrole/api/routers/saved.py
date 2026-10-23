"""Saved jobs (with status and notes), watched companies, and the role taxonomy."""
import sqlite3
from functools import lru_cache
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from nextrole.api.deps import current_user_id, get_conn, rate_limit_user
from nextrole.db import repos, saved_repo
from nextrole.models.company import normalize_company
from nextrole.roles import taxonomy
from nextrole.sources.registry import load_boards

router = APIRouter()
Status = Literal["saved", "applied", "interview", "offer", "rejected"]
Writes = rate_limit_user("saved-writes", 300, 3600)


class SavedJobOut(BaseModel):
    id: int
    job_id: str
    tier: str
    status: Status
    notes: str
    saved_at: str
    status_updated_at: str
    listed: bool  # False = the employer no longer lists this posting
    delisted_at: str | None
    title: str
    company: str
    location: str
    remote: bool
    apply_url: str | None  # copied from the stored source record at save time
    summary: str
    source: str


class SaveBody(BaseModel):
    job_id: str = Field(min_length=1, max_length=64)
    status: Status = "saved"


class UpdateBody(BaseModel):
    status: Status | None = None
    notes: str | None = Field(default=None, max_length=saved_repo.MAX_NOTES * 2)


class ImportItem(BaseModel):
    job_id: str = Field(min_length=1, max_length=64)
    status: Status = "saved"
    notes: str = Field(default="", max_length=saved_repo.MAX_NOTES * 2)


class ImportBody(BaseModel):
    items: list[ImportItem] = Field(max_length=200)


def _tier_for(conn: sqlite3.Connection, user_id: int, job_id: str):
    """(job, tier) if the job is one of THIS user's matches: saving is authorised by ownership."""
    for job, _match, tier in repos.list_matches(conn, user_id):
        if job.id == job_id:
            return job, tier
    return None


@router.post("/saved-jobs", response_model=SavedJobOut, status_code=201, dependencies=[Writes])
def save_job(body: SaveBody, user_id: int = Depends(current_user_id), conn: sqlite3.Connection = Depends(get_conn)):
    found = _tier_for(conn, user_id, body.job_id)
    if found is None:
        raise HTTPException(404, "job not found")
    if saved_repo.count_saved(conn, user_id) >= saved_repo.MAX_SAVED:
        raise HTTPException(409, f"You can save up to {saved_repo.MAX_SAVED} jobs. Remove some first.")
    entry, _created = saved_repo.save_job(conn, user_id, found[0], found[1], body.status)
    return entry


@router.get("/saved-jobs", response_model=list[SavedJobOut])
def list_saved(
    status: Status | None = None, tier: Literal["startup", "mid", "mnc"] | None = None,
    listed: bool | None = None, q: str = Query(default="", max_length=100),
    sort: Literal["saved_desc", "saved_asc", "company", "status"] = "saved_desc",
    user_id: int = Depends(current_user_id), conn: sqlite3.Connection = Depends(get_conn),
):
    return saved_repo.list_saved(conn, user_id, status=status, tier=tier, listed=listed, q=q, sort=sort)


@router.patch("/saved-jobs/{saved_id}", response_model=SavedJobOut, dependencies=[Writes])
def update_saved(
    saved_id: int, body: UpdateBody, user_id: int = Depends(current_user_id),
    conn: sqlite3.Connection = Depends(get_conn),
):
    entry = saved_repo.update_saved(conn, user_id, saved_id, status=body.status, notes=body.notes)
    if entry is None:
        raise HTTPException(404, "saved job not found")
    return entry


@router.delete("/saved-jobs/{saved_id}", status_code=204, dependencies=[Writes])
def unsave(saved_id: int, user_id: int = Depends(current_user_id), conn: sqlite3.Connection = Depends(get_conn)) -> None:
    if not saved_repo.delete_saved(conn, user_id, saved_id):
        raise HTTPException(404, "saved job not found")


@router.post("/saved-jobs/import", dependencies=[rate_limit_user("saved-import", 10, 3600)])
def import_saved(body: ImportBody, user_id: int = Depends(current_user_id), conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    """One-time move of the old browser-only saves/tracker. Only jobs that are in the user's current
    matches can be imported (the snapshot is built from OUR record, never from what the browser sends);
    the rest are reported as skipped so nothing is silently lost."""
    matches = {job.id: (job, tier) for job, _m, tier in repos.list_matches(conn, user_id)}
    imported, skipped = 0, []
    room = saved_repo.MAX_SAVED - saved_repo.count_saved(conn, user_id)
    for item in body.items:
        if item.job_id not in matches or imported >= room:
            skipped.append(item.job_id)
            continue
        entry, created = saved_repo.save_job(conn, user_id, matches[item.job_id][0], matches[item.job_id][1], item.status)
        if created:
            saved_repo.update_saved(conn, user_id, entry["id"], notes=item.notes or None)
            imported += 1
    return {"imported": imported, "skipped": skipped}


# ---- companies ----
@lru_cache(maxsize=1)
def _board_names() -> dict[str, str]:
    return {normalize_company(b.company): b.company for b in load_boards()}


class CompanyOut(BaseModel):
    id: int
    name: str
    monitored: bool  # True when we can read this company's job board (alerts only fire for these)


class CompanyBody(BaseModel):
    name: str = Field(min_length=1, max_length=80)


def _company_out(row: dict) -> CompanyOut:
    return CompanyOut(id=row["id"], name=row["display_name"], monitored=row["company_key"] in _board_names())


@router.get("/companies", response_model=list[CompanyOut])
def list_companies(user_id: int = Depends(current_user_id), conn: sqlite3.Connection = Depends(get_conn)):
    return [_company_out(r) for r in saved_repo.list_companies(conn, user_id)]


@router.get("/companies/suggestions", response_model=list[str])
def company_suggestions(
    q: str = Query(default="", max_length=60), user_id: int = Depends(current_user_id),
    conn: sqlite3.Connection = Depends(get_conn),
):
    """Companies whose boards we can watch, minus the ones already added."""
    have = {r["company_key"] for r in saved_repo.list_companies(conn, user_id)}
    needle = normalize_company(q)
    names = sorted(n for k, n in _board_names().items() if k not in have and needle in k)
    return names[:20]


@router.post("/companies", response_model=CompanyOut, status_code=201, dependencies=[Writes])
def add_company(body: CompanyBody, user_id: int = Depends(current_user_id), conn: sqlite3.Connection = Depends(get_conn)):
    entry, error = saved_repo.add_company(conn, user_id, body.name)
    if entry is None:
        raise HTTPException(422 if "Enter" in error else 409, error)
    return _company_out(entry)


@router.delete("/companies/{company_id}", status_code=204, dependencies=[Writes])
def remove_company(company_id: int, user_id: int = Depends(current_user_id), conn: sqlite3.Connection = Depends(get_conn)) -> None:
    if not saved_repo.delete_company(conn, user_id, company_id):
        raise HTTPException(404, "company not found")


# ---- roles ----
class ResolveBody(BaseModel):
    roles: list[str] = Field(max_length=20)


@router.get("/roles/taxonomy")
def role_taxonomy(_: int = Depends(current_user_id)) -> list[dict]:
    return [{"canonical": r.canonical, "label": r.label, "aliases": list(r.aliases)} for r in taxonomy.taxonomy()]


@router.post("/roles/resolve")
def resolve_roles(body: ResolveBody, _: int = Depends(current_user_id)) -> list[dict]:
    return taxonomy.resolve([r[:80] for r in body.roles])
