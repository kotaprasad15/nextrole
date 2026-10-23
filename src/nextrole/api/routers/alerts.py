"""Alerts: in-app notifications, delivery settings, "check now", and one-click unsubscribe."""
import sqlite3
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel

from nextrole.alerts import store
from nextrole.api.deps import current_user_id, get_conn, rate_limit_ip, rate_limit_user

router = APIRouter()


class AlertOut(BaseModel):
    id: int
    job_id: str
    title: str
    company: str
    location: str
    remote: bool
    apply_url: str | None  # copied from the source record, never produced by a model
    summary: str
    role: str  # which of your wanted roles it matched
    why: str  # one short line: why this matched
    confidence: float
    method: Literal["taxonomy", "embedding", "llm"]
    created_at: str
    read: bool


class SettingsIn(BaseModel):
    in_app: bool = True
    email: bool = False
    frequency: Literal["instant", "daily", "weekly", "off"] = "daily"


class SettingsOut(SettingsIn):
    email_available: bool  # False when the server has no SMTP configured: alerts stay in-app


def _settings_out(request: Request, row: dict) -> SettingsOut:
    return SettingsOut(in_app=bool(row["in_app"]), email=bool(row["email"]), frequency=row["frequency"],
                       email_available=request.app.state.mailer.available)


@router.get("/alerts", response_model=list[AlertOut])
def list_alerts(unread: bool = False, limit: int = Query(default=100, ge=1, le=200),
                user_id: int = Depends(current_user_id), conn: sqlite3.Connection = Depends(get_conn)):
    return store.list_alerts(conn, user_id, unread_only=unread, limit=limit)


@router.get("/alerts/summary")
def summary(user_id: int = Depends(current_user_id), conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    return {"unread": store.unread_count(conn, user_id)}


@router.get("/alerts/settings", response_model=SettingsOut)
def get_alert_settings(request: Request, user_id: int = Depends(current_user_id), conn: sqlite3.Connection = Depends(get_conn)):
    return _settings_out(request, store.get_settings_row(conn, user_id))


@router.put("/alerts/settings", response_model=SettingsOut)
def put_alert_settings(body: SettingsIn, request: Request, user_id: int = Depends(current_user_id),
                       conn: sqlite3.Connection = Depends(get_conn)):
    if body.email and not request.app.state.mailer.available:
        raise HTTPException(409, "Email is not set up on this server. Alerts will appear in NextRole only.")
    return _settings_out(request, store.update_settings(conn, user_id, in_app=body.in_app, email=body.email, frequency=body.frequency))


@router.post("/alerts/read-all")
def read_all(user_id: int = Depends(current_user_id), conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    return {"updated": store.mark_read(conn, user_id)}


@router.post("/alerts/check", dependencies=[rate_limit_user("alerts-check", 3, 3600)])
async def check_now(request: Request, user_id: int = Depends(current_user_id)) -> dict:
    """Run the alert pass for the caller only (fetches their watched companies' boards)."""
    stats = await request.app.state.run_alerts([user_id])
    return {"created": stats["alerts_created"], "boards": stats["boards"], "errors": stats["errors"]}


@router.post("/alerts/unsubscribe", status_code=204, dependencies=[rate_limit_ip("unsubscribe", 30, 3600)])
def unsubscribe(token: str = Query(max_length=120), conn: sqlite3.Connection = Depends(get_conn)) -> None:
    """Public, token-authenticated (the link in the email): turns email alerts off. A bad token is a 404."""
    uid = store.user_for_unsubscribe_token(conn, token)
    if uid is None:
        raise HTTPException(404, "link not valid")
    store.disable_email(conn, uid)


@router.post("/alerts/{alert_id}/read", response_model=AlertOut)
def read_one(alert_id: int, user_id: int = Depends(current_user_id), conn: sqlite3.Connection = Depends(get_conn)):
    if store.get_alert(conn, user_id, alert_id) is None:
        raise HTTPException(404, "alert not found")
    store.mark_read(conn, user_id, alert_id)
    return store.get_alert(conn, user_id, alert_id)


@router.delete("/alerts/{alert_id}", status_code=204)
def dismiss(alert_id: int, user_id: int = Depends(current_user_id), conn: sqlite3.Connection = Depends(get_conn)) -> None:
    """Dismiss = delete the notification. The job stays 'alerted', so it will not come back."""
    if not store.delete_alert(conn, user_id, alert_id):
        raise HTTPException(404, "alert not found")
