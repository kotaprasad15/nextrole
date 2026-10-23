"""The alert job: fetch watched companies' postings, find the ones that fit, notify.

One pass (`run_alerts`):
1. users who watch at least one company, have a profile with wanted roles, and have alerts switched on;
2. fetch every needed board ONCE (boards are shared between users);
3. per user: skip postings already alerted or already judged, score the rest (`alerts.matching`),
   keep within the daily cap, ask the LLM about the borderline band in one batch, store the alerts;
4. send email digests to the users who asked for them, at the frequency they chose;
5. write one aggregate row to `alert_runs` (no user ids).
Failures are contained: one user's error or one board's outage never stops the rest, and an LLM or
budget failure leaves the unjudged postings to be retried on the next run.
"""
import asyncio
import logging
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta

from nextrole.alerts import store
from nextrole.alerts.embedder import Embedder, pack, unpack
from nextrole.alerts.mailer import Mailer, build_digest
from nextrole.alerts.matching import RoleScorer, template_why, verify_borderline
from nextrole.config import Settings
from nextrole.db import repos, saved_repo
from nextrole.llm.budget import BudgetExceeded
from nextrole.llm.client import LLMClient
from nextrole.models.company import normalize_company
from nextrole.models.job import Job
from nextrole.sources.base import Board
from nextrole.sources.registry import FetchResult, fetch_boards, load_boards

log = logging.getLogger(__name__)
Fetcher = Callable[[list[Board]], Awaitable[FetchResult]]
EMAIL_INTERVAL = {"daily": timedelta(hours=23), "weekly": timedelta(days=6, hours=23), "instant": timedelta(0)}


def _watching(conn, only: list[int] | None) -> dict[int, set[str]]:
    sql = "SELECT user_id, company_key FROM user_companies"
    out: dict[int, set[str]] = {}
    for r in conn.execute(sql):
        if only is None or r["user_id"] in only:
            out.setdefault(r["user_id"], set()).add(r["company_key"])
    return out


def _job_vectors(conn, embedder: Embedder, jobs: list[Job]) -> dict[str, list[float]]:
    """Title embeddings, cached per job id and model so each posting is embedded once ever."""
    cached = store.cached_embeddings(conn, [j.id for j in jobs], embedder.name)
    vecs = {jid: unpack(blob) for jid, blob in cached.items()}
    todo = [j for j in jobs if j.id not in vecs]
    if todo:
        fresh = embedder.embed([j.title for j in todo])
        store.store_embeddings(conn, {j.id: pack(v) for j, v in zip(todo, fresh, strict=True)}, embedder.name)
        vecs.update({j.id: v for j, v in zip(todo, fresh, strict=True)})
    return vecs


async def _match_user(
    *, conn, settings: Settings, user_id: int, roles: list[str], jobs: list[Job], vecs: dict[str, list[float]],
    embedder: Embedder, llm_factory: Callable[[], LLMClient], llm_holder: list, now: datetime, stats: dict,
) -> int:
    done = store.checked_job_ids(conn, user_id)
    scorer = RoleScorer(embedder, roles)
    auto, borderline = [], []
    for job in jobs:
        if job.id in done or not job.is_open:
            continue
        cand = scorer.score(job, vecs[job.id])
        if cand is None:
            continue
        if cand.method == "taxonomy" or cand.score >= settings.alert_auto_threshold:
            if cand.method != "taxonomy":
                cand.why, cand.confidence = template_why(job, cand.role, "embedding"), cand.score
            auto.append(cand)
        elif cand.score >= settings.alert_verify_threshold:
            borderline.append(cand)
    stats["candidates"] += len(auto) + len(borderline)

    room = max(0, settings.alert_daily_cap - store.alerts_in_last_day(conn, user_id, now))  # the per-user cap
    auto.sort(key=lambda c: (c.method != "taxonomy", -c.score))
    accepted = auto[:room]
    room -= len(accepted)

    to_verify = sorted(borderline, key=lambda c: -c.score)[:min(room, settings.alert_max_verify_per_user)]
    if to_verify:
        try:
            if not llm_holder:
                llm_holder.append(llm_factory())
            verdicts = await verify_borderline(llm_holder[0], settings, roles, to_verify)
            stats["verified"] += len(to_verify)
        except BudgetExceeded:
            log.warning("alert verification stopped: run budget exhausted")
            verdicts = {}
        except Exception as exc:  # noqa: BLE001 - leave them unjudged; they are retried next run
            log.warning("alert verification failed: %r", exc)
            stats["errors"] += 1
            verdicts = {}
        rejected = []
        for i, cand in enumerate(to_verify):
            v = verdicts.get(i)
            if v is None:
                continue  # no answer: not judged, not remembered
            if v.match and v.confidence >= settings.alert_min_confidence:
                cand.method, cand.confidence = "llm", v.confidence
                cand.why = v.why or template_why(cand.job, cand.role, "embedding")
                accepted.append(cand)
            else:
                rejected.append(cand.job.id)
        store.remember_rejected(conn, user_id, rejected)

    created = 0
    for cand in accepted:
        row = store.create_alert(
            conn, user_id, job_id=cand.job.id, company_key=normalize_company(cand.job.company), role=cand.role,
            score=round(cand.score, 4), confidence=round(cand.confidence, 4), method=cand.method, why=cand.why,
            snapshot=saved_repo.snapshot_of(cand.job), created_at=now.isoformat())
        created += row is not None  # None = already alerted (dedup)
    return created


async def deliver_email(conn, settings: Settings, mailer: Mailer, user_id: int, now: datetime) -> bool:
    """Send this user's unsent alerts if they opted in and their chosen frequency allows it."""
    cfg = store.get_settings_row(conn, user_id)
    if not (cfg["email"] and cfg["frequency"] in EMAIL_INTERVAL and mailer.available):
        return False
    if cfg["last_email_at"]:
        last = datetime.fromisoformat(cfg["last_email_at"])
        if now - last < EMAIL_INTERVAL[cfg["frequency"]]:
            return False
    pending = store.unsent_email_alerts(conn, user_id)
    if not pending:
        return False
    row = conn.execute("SELECT email FROM users WHERE id = ?", (user_id,)).fetchone()
    if row is None:
        return False
    token = store.unsubscribe_token(user_id, cfg["unsubscribe_secret"])
    base = settings.public_base_url.rstrip("/")
    subject, text, headers = build_digest(
        pending, unsubscribe_page=f"{base}/unsubscribe?token={token}", unsubscribe_post=f"{base}/api/alerts/unsubscribe?token={token}")
    await asyncio.to_thread(mailer.send, to=row["email"], subject=subject, text=text, headers=headers)  # only ever to the owner
    store.mark_emailed(conn, user_id, [a["id"] for a in pending], now.isoformat())
    return True


async def run_alerts(
    *, conn, settings: Settings, llm_factory: Callable[[], LLMClient], mailer: Mailer, embedder: Embedder,
    fetcher: Fetcher = fetch_boards, boards_loader: Callable[[], list[Board]] = load_boards,
    user_ids: list[int] | None = None, now: datetime | None = None,
) -> dict:
    now = now or datetime.now(UTC)
    started = now.isoformat()
    stats = {"users": 0, "boards": 0, "jobs_fetched": 0, "candidates": 0, "verified": 0, "alerts_created": 0,
             "emails_sent": 0, "errors": 0}

    watching = _watching(conn, user_ids)
    active: dict[int, list[str]] = {}
    for uid in watching:
        cfg = store.get_settings_row(conn, uid)
        profile = repos.get_profile(conn, uid)
        wants_email = cfg["email"] and cfg["frequency"] != "off"
        if profile and profile.preferences.roles and (cfg["in_app"] or wants_email):
            active[uid] = profile.preferences.roles
    stats["users"] = len(active)
    if not active:
        store.record_run(conn, started, stats)
        return stats

    needed = set().union(*(watching[u] for u in active))
    boards = [b for b in boards_loader() if normalize_company(b.company) in needed]
    stats["boards"] = len(boards)
    fetched = await fetcher(boards) if boards else FetchResult()
    stats["errors"] += len(fetched.errors)
    stats["jobs_fetched"] = len(fetched.all_jobs)
    vecs = _job_vectors(conn, embedder, fetched.all_jobs)

    llm_holder: list[LLMClient] = []
    for uid, roles in active.items():
        try:
            jobs = [j for key in watching[uid] for j in fetched.by_company.get(key, [])]
            stats["alerts_created"] += await _match_user(
                conn=conn, settings=settings, user_id=uid, roles=roles, jobs=jobs, vecs=vecs, embedder=embedder,
                llm_factory=llm_factory, llm_holder=llm_holder, now=now, stats=stats)
            if await deliver_email(conn, settings, mailer, uid, now):
                stats["emails_sent"] += 1
        except Exception as exc:  # noqa: BLE001 - one user's failure must not stop the others
            log.warning("alerts failed for a user: %r", exc)
            stats["errors"] += 1
    store.record_run(conn, started, stats)
    return stats
