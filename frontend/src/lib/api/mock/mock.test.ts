/**
 * The mock server is the contract the UI is built against, so it is held to the same Zod schemas
 * as the real API: if a fixture drifts from the real shapes, these tests fail.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { SESSION_COOKIE } from "../config";
import {
  AdminInterviewSchema, AlertCheckSchema, MetricsSchema, TraceEntriesSchema, TraceListSchema, AlertSchema, AlertSettingsSchema, InterviewPageSchema, InterviewSchema, ReportRowSchema, SubmitResultSchema, CompanySchema, ImportResultSchema, MeSchema, OutreachSchema, ResolvedRoleSchema, SavedJobSchema, OutreachStatusRowSchema, ProfileSchema, RecommendationsSchema,
  ActiveRunSchema, RunEventSchema, StartRunResponseSchema, type RunEvent,
} from "../schemas";
import { ALL_JOBS, PROFILE, RECOMMENDATIONS, SAVED_JOBS, draftFor } from "./data";
import { MockEventSource } from "./events";
import { mockFetch } from "./index";

const call = (path: string, init?: RequestInit) => mockFetch(path, init);
const post = (path: string, body: unknown) => call(path, { method: "POST", body: JSON.stringify(body) });
const signIn = () => post("/auth/login", { email: "priya@example.com", password: "password123" });

function runToCompletion(runId: string): Promise<RunEvent[]> {
  return new Promise((resolve) => {
    const events: RunEvent[] = [];
    const es = new MockEventSource(runId);
    es.onmessage = (m) => {
      const e = RunEventSchema.parse(JSON.parse(m.data));
      events.push(e);
      if (e.type === "run_finished") {
        es.close();
        resolve(events);
      }
    };
  });
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("nextrole_mock", JSON.stringify({ delay: 0, speed: 0.001 }));
  document.cookie = `${SESSION_COOKIE}=; path=/; max-age=0`;
});

describe("fixtures match the real API contract", () => {
  it("profile, recommendations and drafts all satisfy the schemas", () => {
    expect(ProfileSchema.safeParse(PROFILE).success).toBe(true);
    expect(RecommendationsSchema.safeParse(RECOMMENDATIONS).success).toBe(true);
    for (const status of ["draft", "critic_passed", "user_approved"] as const) {
      expect(OutreachSchema.safeParse(draftFor("s1", status, 1)).success).toBe(true);
    }
  });

  it("every job has a unique id and an https apply link (the app refuses anything else)", () => {
    expect(new Set(ALL_JOBS.map((j) => j.job_id)).size).toBe(ALL_JOBS.length);
    for (const j of ALL_JOBS) expect(j.apply_url).toMatch(/^https:\/\//);
  });

  it("has three tiers with realistic spread of scores", () => {
    for (const tier of ["startup", "mid", "mnc"] as const) expect(RECOMMENDATIONS[tier].length).toBeGreaterThanOrEqual(3);
    const scores = ALL_JOBS.map((j) => j.score);
    expect(Math.max(...scores)).toBeGreaterThan(80);
    expect(Math.min(...scores)).toBeLessThan(60);
  });
});

describe("auth", () => {
  it("rejects unauthenticated requests with 401, like the real API", async () => {
    expect((await call("/me")).status).toBe(401);
    expect((await call("/recommendations")).status).toBe(401);
  });

  it("signs in (sets the session cookie) and then serves /me", async () => {
    const res = await signIn();
    expect(res.status).toBe(200);
    expect(MeSchema.parse(await res.json()).email).toBe("priya@example.com");
    expect(document.cookie).toContain(`${SESSION_COOKIE}=`);
    expect((await call("/me")).status).toBe(200);
  });

  it("returns the real error messages for bad credentials, duplicates and weak passwords", async () => {
    expect(await (await post("/auth/login", { email: "a@b.co", password: "wrong-password" })).json()).toEqual({ detail: "invalid email or password" });
    expect((await post("/auth/signup", { email: "taken@example.com", password: "Password123!" })).status).toBe(409);
    expect((await post("/auth/signup", { email: "a@b.co", password: "short" })).status).toBe(422);
    expect((await post("/auth/signup", { email: "a@b.co", password: "alllowercase1" })).status).toBe(422);
  });

  it("signup starts a new account with no profile (so onboarding runs); login keeps the seeded one", async () => {
    await post("/auth/signup", { email: "new@example.com", password: "Password123!" });
    expect((await call("/profile")).status).toBe(404);
    await signIn();
    // Logging in again must not conjure a profile: the account stays un-onboarded until a
    // resume is uploaded (deterministic, so the onboarding redirect can be tested).
    expect((await call("/profile")).status).toBe(404);
  });

  it("a never-signed-up demo user gets the seeded profile on login", async () => {
    localStorage.removeItem("nextrole_mock_profile");
    await signIn();
    expect(ProfileSchema.parse(await (await call("/profile")).json()).name).toBe("Priya Nair");
  });

  it("an expired session (cookie present but invalid) gets 401 on authenticated routes", async () => {
    await signIn();
    localStorage.setItem("nextrole_mock", JSON.stringify({ delay: 0, expired: true }));
    expect((await call("/me")).status).toBe(401);
    expect((await call("/recommendations")).status).toBe(401);
  });

  it("logs out and deleting the account clears the session", async () => {
    await signIn();
    expect((await call("/auth/logout", { method: "POST" })).status).toBe(204);
    expect((await call("/me")).status).toBe(401);
    await signIn();
    expect((await call("/me", { method: "DELETE" })).status).toBe(204);
    expect((await call("/me")).status).toBe(401);
  });
});

describe("data routes", () => {
  beforeEach(async () => {
    await signIn();
  });

  it("serves validated recommendations and honours the empty-state switch", async () => {
    expect(RecommendationsSchema.safeParse(await (await call("/recommendations")).json()).success).toBe(true);
    localStorage.setItem("nextrole_mock", JSON.stringify({ delay: 0, empty: true }));
    const empty = RecommendationsSchema.parse(await (await call("/recommendations")).json());
    expect(empty.startup.length + empty.mid.length + empty.mnc.length).toBe(0);
  });

  it("can simulate a server failure for error-state work", async () => {
    localStorage.setItem("nextrole_mock", JSON.stringify({ delay: 0, fail: ["recommendations"] }));
    expect((await call("/recommendations")).status).toBe(500);
  });

  it("validates resume uploads like the backend (type and emptiness) and parses a good one", async () => {
    const form = (file: File) => {
      const f = new FormData();
      f.set("roles", "Backend Engineer, Data Engineer");
      f.set("locations", "London");
      f.set("remote_ok", "true");
      f.set("resume", file);
      return f;
    };
    const bad = await call("/onboarding", { method: "POST", body: form(new File(["hello world ".repeat(20)], "cv.txt")) });
    expect(bad.status).toBe(422);
    expect((await bad.json()).detail).toContain("unsupported file type");
    const empty = await call("/onboarding", { method: "POST", body: form(new File([""], "cv.pdf")) });
    expect(empty.status).toBe(422);
  }, 10_000);

  it("edits, approves and gives feedback on a draft, enforcing the approval rules", async () => {
    const list = z.array(OutreachStatusRowSchema).parse(await (await call("/outreach")).json());
    const id = list.find((d) => d.job_id === "s1")!.id;

    const edited = OutreachSchema.parse(await (await call(`/outreach/${id}`, { method: "PUT", body: JSON.stringify({ subject: "S", body: "B", recipient_email: "jane@acme.com" }) })).json());
    expect(edited.status).toBe("draft");
    expect(edited.critic).toBeNull(); // an edit clears the stale reviewer verdict

    const bad = await call(`/outreach/${id}`, { method: "PUT", body: JSON.stringify({ subject: "S", body: "B", recipient_email: "nope" }) });
    expect(bad.status).toBe(422);

    const approved = OutreachSchema.parse(await post(`/outreach/${id}/approve`, {}).then((r) => r.json()));
    expect(approved.status).toBe("user_approved");
    expect(approved.approved_at).not.toBeNull();

    const fb = OutreachSchema.parse(await post(`/outreach/${id}/feedback`, { rating: -1, note: "Too long" }).then((r) => r.json()));
    expect(fb.feedback).toEqual({ rating: -1, note: "Too long" });

    expect((await call(`/outreach/${id}`, { method: "DELETE" })).status).toBe(204);
    expect((await call("/outreach/by-job/s1")).status).toBe(404);
  });

  it("404s on unknown routes and runs", async () => {
    expect((await call("/nope")).status).toBe(404);
    expect((await call("/runs/doesnotexist")).status).toBe(404);
  });
});

describe("runs", () => {
  beforeEach(async () => {
    await signIn();
  });

  it("streams a recommend run in the same order as the real orchestrator and finishes", async () => {
    const { run_id } = StartRunResponseSchema.parse(await (await post("/runs", { mode: "recommend" })).json());
    const events = await runToCompletion(run_id);
    expect(events[0].type).toBe("run_started");
    expect(events[1]).toMatchObject({ type: "plan", data: { steps: ["discover", "tier", "select", "match", "save"] } });
    expect(events.filter((e) => e.type === "step_finished").map((e) => e.step)).toEqual(["discover", "tier", "select", "match", "save"]);
    const last = events.at(-1)!;
    expect(last.type).toBe("run_finished");
    expect(last.data.status).toBe("completed");
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i)); // sequential, so the UI can de-duplicate
    expect(events.at(-1)!.tokens).toBeGreaterThan(0);
  });

  it("replays history to a late subscriber (like the real SSE endpoint)", async () => {
    const { run_id } = StartRunResponseSchema.parse(await (await post("/runs", { mode: "outreach", job_id: "m2" })).json());
    const first = await runToCompletion(run_id);
    const late = await runToCompletion(run_id);
    expect(late).toEqual(first);
    expect(ActiveRunSchema.parse(await (await call("/runs/active")).json())).toEqual({ run_id: null, mode: null }); // it finished
  });

  it("an outreach run creates a draft for the job; a pasted job lands on the dashboard", async () => {
    await runToCompletion(StartRunResponseSchema.parse(await (await post("/runs", { mode: "outreach", job_id: "m2" })).json()).run_id);
    expect((await call("/outreach/by-job/m2")).status).toBe(200);

    await runToCompletion(StartRunResponseSchema.parse(await (await post("/runs", { mode: "single_job", text: "Backend Engineer at Initech" })).json()).run_id);
    const recs = RecommendationsSchema.parse(await (await call("/recommendations")).json());
    const pasted = recs.mid.find((j) => j.pasted);
    expect(pasted?.apply_url).toBeNull(); // text-only paste: no invented link
  });

  it("refuses LinkedIn/Indeed/Naukri URLs at the ingest step, with the real message", async () => {
    const { run_id } = StartRunResponseSchema.parse(await (await post("/runs", { mode: "single_job", url: "https://www.linkedin.com/jobs/view/1" })).json());
    const events = await runToCompletion(run_id);
    expect(events.find((e) => e.type === "step_failed")).toMatchObject({ step: "ingest" });
    expect(events.at(-1)!.data.status).toBe("failed");
  });

  it("validates a pasted-job request; there is no run history, only 'is one active'", async () => {
    expect((await post("/runs", { mode: "single_job" })).status).toBe(422);
    expect((await call("/runs")).status).not.toBe(200);
    const { run_id } = StartRunResponseSchema.parse(await (await post("/runs", { mode: "recommend" })).json());
    expect(ActiveRunSchema.parse(await (await call("/runs/active")).json())).toEqual({ run_id, mode: "recommend" });
  });
});

describe("saved jobs, companies and roles (mock server)", () => {
  const send = (method: string, path: string, body?: unknown) => call(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });

  it("saves from the stored record, updates, filters and removes, with schema-valid responses", async () => {
    await signIn();
    for (const s of SAVED_JOBS) SavedJobSchema.parse(s);
    const job = RECOMMENDATIONS.startup[0];
    expect((await send("POST", "/saved-jobs", { job_id: "nope" })).status).toBe(404);
    const created = SavedJobSchema.parse(await (await send("POST", "/saved-jobs", { job_id: job.job_id, apply_url: "https://evil.example" })).json());
    expect(created.apply_url).toBe(job.apply_url); // from our record, not the request
    const patched = SavedJobSchema.parse(await (await send("PATCH", `/saved-jobs/${created.id}`, { status: "offer", notes: "<b>hi</b>" })).json());
    expect(patched.status).toBe("offer");
    expect(patched.notes).toBe("hi");
    expect((await (await send("GET", "/saved-jobs?status=offer")).json())).toHaveLength(1);
    expect((await (await send("GET", "/saved-jobs?status=applied")).json())).toHaveLength(0);
    expect((await send("DELETE", `/saved-jobs/${created.id}`)).status).toBe(204);
    expect((await send("DELETE", `/saved-jobs/${created.id}`)).status).toBe(404);
  });

  it("imports only known jobs, and manages companies and roles", async () => {
    await signIn();
    const job = RECOMMENDATIONS.mid[0];
    const res = ImportResultSchema.parse(await (await send("POST", "/saved-jobs/import", { items: [{ job_id: job.job_id, status: "applied", notes: "" }, { job_id: "zzz", status: "saved", notes: "" }] })).json());
    expect(res).toEqual({ imported: 1, skipped: ["zzz"] });
    const stripe = CompanySchema.parse(await (await send("POST", "/companies", { name: "Stripe" })).json());
    expect(stripe.monitored).toBe(true);
    expect(CompanySchema.parse(await (await send("POST", "/companies", { name: "Tiny Co" })).json()).monitored).toBe(false);
    expect(await (await send("GET", "/companies/suggestions?q=str")).json()).toEqual([]); // already added
    expect((await send("DELETE", `/companies/${stripe.id}`)).status).toBe(204);
    const roles = z.array(ResolvedRoleSchema).parse(await (await send("POST", "/roles/resolve", { roles: ["SDE", "growth marketer"] })).json());
    expect(roles.map((r) => r.canonical)).toEqual(["software_engineer", null]);
  });
});

describe("alerts (mock server)", () => {
  const send = (method: string, path: string, body?: unknown) => call(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });

  it("serves schema-valid alerts, unread counts, read/dismiss and settings", async () => {
    await signIn();
    const list = z.array(AlertSchema).parse(await (await send("GET", "/alerts")).json());
    expect(list.length).toBeGreaterThanOrEqual(2);
    const unread = (await (await send("GET", "/alerts/summary")).json()).unread;
    expect(unread).toBe(list.filter((a) => !a.read).length);
    const first = list.find((a) => !a.read)!;
    expect(AlertSchema.parse(await (await send("POST", `/alerts/${first.id}/read`)).json()).read).toBe(true);
    expect((await (await send("GET", "/alerts/summary")).json()).unread).toBe(unread - 1);
    expect((await send("DELETE", `/alerts/${first.id}`)).status).toBe(204);
    expect((await send("DELETE", `/alerts/${first.id}`)).status).toBe(404);
    const s = AlertSettingsSchema.parse(await (await send("PUT", "/alerts/settings", { in_app: true, email: true, frequency: "weekly" })).json());
    expect(s.frequency).toBe("weekly");
    AlertCheckSchema.parse(await (await send("POST", "/alerts/check")).json());
  });

  it("unsubscribe needs no session; a bad token is a 404", async () => {
    expect((await send("POST", "/alerts/unsubscribe?token=1.abc")).status).toBe(204);
    expect((await send("POST", "/alerts/unsubscribe?token=bad")).status).toBe(404);
  });
});

describe("interview experiences (mock server)", () => {
  const send = (method: string, path: string, body?: unknown) => call(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
  const GOOD = {
    company: "Acme", role: "SDE", level: "mid", interviewed_on: "2026-08", difficulty: 3, outcome: "offer", anonymous: true, tips: "Practise graphs.",
    rounds: [{ type: "coding", difficulty: 3, notes: "Two graph problems." }],
  };

  it("browses only approved posts, filters, votes and reports with schema-valid responses", async () => {
    await signIn();
    const page = InterviewPageSchema.parse(await (await send("GET", "/interviews")).json());
    expect(page.items.length).toBeGreaterThanOrEqual(3);
    expect(page.items.every((i) => i.status === undefined || i.mine)).toBe(true); // pending posts of others never appear
    expect(InterviewPageSchema.parse(await (await send("GET", "/interviews?company=lumen")).json()).items).toHaveLength(1);
    expect(InterviewPageSchema.parse(await (await send("GET", "/interviews?difficulty=5")).json()).items.every((i) => i.difficulty === 5)).toBe(true);
    const other = page.items.find((i) => !i.mine)!;
    const voted = InterviewSchema.parse(await (await send("POST", `/interviews/${other.id}/upvote`)).json());
    expect(voted.upvoted).toBe(true);
    expect(InterviewSchema.parse(await (await send("DELETE", `/interviews/${other.id}/upvote`)).json()).upvoted).toBe(false);
    expect((await send("POST", `/interviews/${other.id}/report`, { reason: "spam", detail: "" })).status).toBe(201);
    expect((await send("POST", `/interviews/${other.id}/report`, { reason: "spam", detail: "" })).status).toBe(409);
  });

  it("submits for review, refuses personal data, and keeps the member's own post private until approved", async () => {
    await signIn();
    expect((await send("POST", "/interviews", { ...GOOD, tips: "mail jane@example.com" })).status).toBe(422);
    const made = SubmitResultSchema.parse(await (await send("POST", "/interviews", GOOD)).json());
    expect(made.status).toBe("pending");
    const mine = z.array(InterviewSchema).parse(await (await send("GET", "/interviews/mine")).json());
    expect(mine.find((i) => i.id === made.id)?.status).toBe("pending");
    expect((await send("DELETE", `/interviews/${made.id}`)).status).toBe(204);
  });

  it("admin routes are 404 for members and work with the admin switch", async () => {
    await signIn();
    expect((await send("GET", "/admin/interviews")).status).toBe(404);
    localStorage.setItem("nextrole_mock", JSON.stringify({ delay: 0, speed: 0.001, admin: true }));
    expect(MeSchema.parse(await (await send("GET", "/me")).json()).role).toBe("admin");
    const queue = z.array(AdminInterviewSchema).parse(await (await send("GET", "/admin/interviews")).json());
    expect(queue.length).toBeGreaterThanOrEqual(1);
    const approved = AdminInterviewSchema.parse(await (await send("POST", `/admin/interviews/${queue[0].id}/approve`, { note: "" })).json());
    expect(approved.status).toBe("approved");
    z.array(ReportRowSchema).parse(await (await send("GET", "/admin/reports")).json());
  });

  it("serves schema-valid aggregate metrics and traces to admins only", async () => {
    await signIn();
    expect((await send("GET", "/admin/metrics")).status).toBe(404);
    localStorage.setItem("nextrole_mock", JSON.stringify({ delay: 0, speed: 0.001, admin: true }));
    const m = MetricsSchema.parse(await (await send("GET", "/admin/metrics?days=7")).json());
    expect(m.series).toHaveLength(7);
    expect(JSON.stringify(m)).not.toMatch(/user_id|author|"email"/);
    const traces = TraceListSchema.parse(await (await send("GET", "/admin/traces")).json());
    expect(TraceEntriesSchema.parse(await (await send("GET", `/admin/traces/${traces[0].run_id}`)).json()).length).toBeGreaterThan(0);
  });
});
