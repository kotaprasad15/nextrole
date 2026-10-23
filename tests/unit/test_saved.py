"""Saved jobs (snapshots, status, notes, delisting), watched companies and the roles endpoints."""
import pytest
from fastapi.testclient import TestClient
from tests.unit.test_api import ctx, signup  # noqa: F401  (ctx is a fixture)

from nextrole.db import repos, saved_repo
from nextrole.models.company import CompanyTier
from nextrole.models.job import Job
from nextrole.models.match import MatchResult


def make_job(n=1, company="Acme", title="Backend Engineer", desc="Build payment APIs. " * 40, source="greenhouse"):
    return Job(source=source, source_id=str(n), title=title, company=company, location="Remote", remote=True,
               description=desc, apply_url=f"https://boards.greenhouse.io/{company.lower()}/jobs/{n}")


def give_matches(app, email, jobs, tier="startup"):
    conn = app.state.conn
    uid = conn.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()["id"]
    repos.save_jobs(conn, jobs)
    repos.save_tiers(conn, [CompanyTier(company_key=j.company.lower(), tier=tier, method="seed") for j in jobs])
    repos.replace_matches(conn, uid, [MatchResult(job_id=j.id, score=80, strengths=[], gaps=[], rationale="ok") for j in jobs])
    return uid


@pytest.fixture
def app_user(ctx):  # noqa: F811
    signup(ctx.client, "a@b.co")
    jobs = [make_job(1), make_job(2, "Globex", "Data Engineer")]
    uid = give_matches(ctx.app, "a@b.co", jobs)
    return ctx, jobs, uid


def test_saving_snapshots_the_posting_from_our_own_record(app_user):
    ctx, jobs, _ = app_user  # noqa: F811
    r = ctx.client.post("/saved-jobs", json={"job_id": jobs[0].id, "apply_url": "https://evil.example.com", "title": "x"})
    assert r.status_code == 201
    body = r.json()
    assert body["apply_url"] == jobs[0].apply_url and body["title"] == "Backend Engineer"  # client values ignored
    assert body["status"] == "saved" and body["listed"] is True and body["tier"] == "startup"
    assert body["summary"].startswith("Build payment APIs") and len(body["summary"]) <= 510
    again = ctx.client.post("/saved-jobs", json={"job_id": jobs[0].id})
    assert again.json()["id"] == body["id"] and len(ctx.client.get("/saved-jobs").json()) == 1  # idempotent


def test_snapshot_survives_the_job_leaving_the_matches_and_the_jobs_table(app_user):
    ctx, jobs, uid = app_user  # noqa: F811
    sid = ctx.client.post("/saved-jobs", json={"job_id": jobs[0].id}).json()["id"]
    repos.replace_matches(ctx.app.state.conn, uid, [])
    ctx.app.state.conn.execute("DELETE FROM jobs")
    ctx.app.state.conn.commit()
    entry = ctx.client.get("/saved-jobs").json()[0]
    assert entry["id"] == sid and entry["title"] == "Backend Engineer" and entry["apply_url"] == jobs[0].apply_url


def test_only_your_own_matches_can_be_saved_and_unknown_ids_are_404(app_user):
    ctx, jobs, _ = app_user  # noqa: F811
    other = TestClient(ctx.app)
    signup(other, "b@b.co")
    assert other.post("/saved-jobs", json={"job_id": jobs[0].id}).status_code == 404  # not B's match
    assert ctx.client.post("/saved-jobs", json={"job_id": "nope"}).status_code == 404
    assert TestClient(ctx.app).post("/saved-jobs", json={"job_id": jobs[0].id}).status_code == 401


def test_status_and_notes_update_and_validate(app_user):
    ctx, jobs, _ = app_user  # noqa: F811
    sid = ctx.client.post("/saved-jobs", json={"job_id": jobs[0].id}).json()["id"]
    r = ctx.client.patch(f"/saved-jobs/{sid}", json={"status": "interview", "notes": "Call <b>Sam</b> <script>x()</script> on Friday"})
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "interview" and body["notes"] == "Call Sam on Friday"  # plain text only
    assert body["status_updated_at"] >= body["saved_at"]
    assert ctx.client.patch(f"/saved-jobs/{sid}", json={"status": "hired"}).status_code == 422
    assert ctx.client.patch("/saved-jobs/9999", json={"status": "offer"}).status_code == 404
    for s in ("saved", "applied", "interview", "offer", "rejected"):
        assert ctx.client.patch(f"/saved-jobs/{sid}", json={"status": s}).json()["status"] == s


def test_notes_and_snapshot_are_encrypted_at_rest(app_user):
    ctx, jobs, _ = app_user  # noqa: F811
    sid = ctx.client.post("/saved-jobs", json={"job_id": jobs[0].id}).json()["id"]
    ctx.client.patch(f"/saved-jobs/{sid}", json={"notes": "my secret salary expectation 200k"})
    raw = ctx.app.state.conn.serialize()
    assert b"secret salary" not in raw
    row = ctx.app.state.conn.execute("SELECT notes, snapshot_json FROM saved_jobs").fetchone()
    assert row["notes"].startswith("enc:v1:") and row["snapshot_json"].startswith("enc:v1:")


def test_filters_search_and_sorting(ctx):  # noqa: F811
    signup(ctx.client, "a@b.co")
    jobs = [make_job(1, "Acme", "Backend Engineer"), make_job(2, "Globex", "Data Engineer"), make_job(3, "Initech", "SRE")]
    give_matches(ctx.app, "a@b.co", jobs)
    c = ctx.client
    ids = [c.post("/saved-jobs", json={"job_id": j.id}).json()["id"] for j in jobs]
    c.patch(f"/saved-jobs/{ids[1]}", json={"status": "applied", "notes": "referred by Dana"})
    c.patch(f"/saved-jobs/{ids[2]}", json={"status": "rejected"})
    ctx.app.state.conn.execute("UPDATE saved_jobs SET tier = 'mnc', listed = 0 WHERE id = ?", (ids[2],))
    ctx.app.state.conn.commit()

    titles = lambda **q: [r["title"] for r in c.get("/saved-jobs", params=q).json()]
    assert titles() == ["SRE", "Data Engineer", "Backend Engineer"]  # newest first
    assert titles(sort="saved_asc") == ["Backend Engineer", "Data Engineer", "SRE"]
    assert titles(sort="company") == ["Backend Engineer", "Data Engineer", "SRE"]
    assert titles(status="applied") == ["Data Engineer"]
    assert titles(tier="mnc") == ["SRE"]
    assert titles(listed="false") == ["SRE"] and len(titles(listed="true")) == 2
    assert titles(q="dana") == ["Data Engineer"]  # searches notes too
    assert titles(q="glob") == ["Data Engineer"] and titles(q="nothing") == []
    assert c.get("/saved-jobs", params={"status": "bogus"}).status_code == 422


def test_unsave_and_cross_user_isolation(app_user):
    ctx, jobs, _ = app_user  # noqa: F811
    sid = ctx.client.post("/saved-jobs", json={"job_id": jobs[0].id}).json()["id"]
    other = TestClient(ctx.app)
    signup(other, "b@b.co")
    assert other.get("/saved-jobs").json() == []
    assert other.patch(f"/saved-jobs/{sid}", json={"status": "offer"}).status_code == 404
    assert other.delete(f"/saved-jobs/{sid}").status_code == 404
    assert ctx.client.get("/saved-jobs").json()[0]["status"] == "saved"
    assert ctx.client.delete(f"/saved-jobs/{sid}").status_code == 204
    assert ctx.client.delete(f"/saved-jobs/{sid}").status_code == 404 and ctx.client.get("/saved-jobs").json() == []


def test_save_cap(app_user, monkeypatch):
    ctx, jobs, _ = app_user  # noqa: F811
    monkeypatch.setattr(saved_repo, "MAX_SAVED", 1)
    assert ctx.client.post("/saved-jobs", json={"job_id": jobs[0].id}).status_code == 201
    assert ctx.client.post("/saved-jobs", json={"job_id": jobs[1].id}).status_code == 409


def test_import_only_takes_jobs_in_current_matches_and_reports_the_rest(app_user):
    ctx, jobs, _ = app_user  # noqa: F811
    r = ctx.client.post("/saved-jobs/import", json={"items": [
        {"job_id": jobs[0].id, "status": "applied", "notes": "from the old tracker", "apply_url": "https://evil.example.com"},
        {"job_id": "gone-job", "status": "offer"}]})
    assert r.json() == {"imported": 1, "skipped": ["gone-job"]}
    entry = ctx.client.get("/saved-jobs").json()[0]
    assert entry["status"] == "applied" and entry["notes"] == "from the old tracker" and entry["apply_url"] == jobs[0].apply_url
    assert ctx.client.post("/saved-jobs/import", json={"items": [{"job_id": jobs[0].id}]}).json()["imported"] == 0  # again: no dupes


# ---- "no longer listed" ----
def test_postings_removed_by_the_source_are_marked_and_relisting_restores_them(app_user):
    ctx, jobs, _uid = app_user  # noqa: F811
    conn = ctx.app.state.conn
    ctx.client.post("/saved-jobs", json={"job_id": jobs[0].id})
    ctx.client.post("/saved-jobs", json={"job_id": jobs[1].id})
    listed = lambda: {r["title"]: r["listed"] for r in ctx.client.get("/saved-jobs").json()}

    # Source answered, one posting is gone
    assert saved_repo.update_listing(conn, {jobs[1].id}, {"greenhouse"}, set()) == 1
    assert listed() == {"Backend Engineer": False, "Data Engineer": True}
    assert ctx.client.get("/saved-jobs").json()[1]["delisted_at"] or ctx.client.get("/saved-jobs").json()[0]["delisted_at"]
    # A source with errors proves nothing: nothing changes
    assert saved_repo.update_listing(conn, set(), {"greenhouse"}, {"greenhouse"}) == 0
    assert listed()["Data Engineer"] is True
    # It comes back
    assert saved_repo.update_listing(conn, {jobs[0].id, jobs[1].id}, {"greenhouse"}, set()) == 1
    assert listed() == {"Backend Engineer": True, "Data Engineer": True}


def test_pasted_jobs_and_unchecked_sources_are_never_marked(ctx):  # noqa: F811
    signup(ctx.client, "a@b.co")
    pasted = Job(source="pasted", source_id="p", title="Eng", company="Zed", description="x" * 80)
    lever = make_job(7, "Lev", source="lever")
    give_matches(ctx.app, "a@b.co", [pasted, lever])
    for j in (pasted, lever):
        ctx.client.post("/saved-jobs", json={"job_id": j.id})
    assert saved_repo.update_listing(ctx.app.state.conn, set(), {"greenhouse"}, set()) == 0  # lever not checked
    assert saved_repo.update_listing(ctx.app.state.conn, set(), {"greenhouse", "lever"}, set()) == 1  # only lever
    assert {r["source"]: r["listed"] for r in ctx.client.get("/saved-jobs").json()} == {"pasted": True, "lever": False}


# ---- companies ----
def test_watched_companies(ctx):  # noqa: F811
    signup(ctx.client, "a@b.co")
    c = ctx.client
    r = c.post("/companies", json={"name": "  Stripe, Inc.  "})
    assert r.status_code == 201 and r.json()["name"] == "Stripe, Inc." and r.json()["monitored"] is True
    assert c.post("/companies", json={"name": "stripe"}).json()["id"] == r.json()["id"]  # same company
    custom = c.post("/companies", json={"name": "My Tiny Startup"}).json()
    assert custom["monitored"] is False  # we cannot read its board: the UI says so
    assert [x["name"] for x in c.get("/companies").json()] == ["My Tiny Startup", "Stripe, Inc."]
    assert "Stripe" not in c.get("/companies/suggestions", params={"q": "stri"}).json()  # already added
    assert "Airbnb" in c.get("/companies/suggestions", params={"q": "air"}).json()
    assert c.post("/companies", json={"name": "<b></b>"}).status_code == 422
    assert c.post("/companies", json={"name": "x" * 200}).status_code == 422

    other = TestClient(ctx.app)
    signup(other, "b@b.co")
    assert other.get("/companies").json() == [] and other.delete(f"/companies/{custom['id']}").status_code == 404
    assert c.delete(f"/companies/{custom['id']}").status_code == 204
    assert len(c.get("/companies").json()) == 1


def test_company_cap(ctx, monkeypatch):  # noqa: F811
    signup(ctx.client, "a@b.co")
    monkeypatch.setattr(saved_repo, "MAX_COMPANIES", 2)
    assert [ctx.client.post("/companies", json={"name": n}).status_code for n in ("A1", "B2", "C3")] == [201, 201, 409]


# ---- roles ----
def test_role_endpoints(ctx):  # noqa: F811
    assert TestClient(ctx.app).get("/roles/taxonomy").status_code == 401
    signup(ctx.client, "a@b.co")
    tax = ctx.client.get("/roles/taxonomy").json()
    assert {"canonical": "forward_deployed_engineer", "label": "Forward Deployed Engineer"}.items() <= next(
        r for r in tax if r["canonical"] == "forward_deployed_engineer").items()
    out = ctx.client.post("/roles/resolve", json={"roles": ["SDE", "FDE", "growth marketer"]}).json()
    assert [o["canonical"] for o in out] == ["software_engineer", "forward_deployed_engineer", None]
    assert ctx.client.post("/roles/resolve", json={"roles": ["x"] * 25}).status_code == 422


def test_export_and_deletion_cover_saved_jobs_and_companies(app_user):
    ctx, jobs, _ = app_user  # noqa: F811
    ctx.client.post("/saved-jobs", json={"job_id": jobs[0].id})
    ctx.client.post("/companies", json={"name": "Stripe"})
    data = ctx.client.get("/me/export").json()
    assert data["saved_jobs"][0]["title"] == "Backend Engineer" and data["watched_companies"] == ["Stripe"]
    assert ctx.client.delete("/me").status_code == 204
    conn = ctx.app.state.conn
    assert conn.execute("SELECT COUNT(*) FROM saved_jobs").fetchone()[0] == 0
    assert conn.execute("SELECT COUNT(*) FROM user_companies").fetchone()[0] == 0
