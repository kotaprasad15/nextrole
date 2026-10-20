/**
 * In-memory fake of the NextRole backend (same routes, status codes and shapes). Used when
 * NEXT_PUBLIC_API_MODE=mock so the UI can be developed, screenshot and demoed with no backend
 * and no LLM. Dev switches (localStorage key `nextrole_mock`, JSON):
 *   { "delay": 250, "empty": true, "fail": ["recommendations"], "speed": 0.2, "expired": true }
 * `empty` shows empty states, `fail` makes a named route return 500, `speed` scales run timers,
 * `expired` makes every authenticated route return 401 even though a cookie is present
 * (simulates an expired session).
 */
import { SESSION_COOKIE } from "../config";
import type { JobCard, Outreach, Profile, Recommendations, StartRunBody } from "../schemas";
import { ALL_JOBS, MOCK_EMAIL, PAST_RUNS, PROFILE, RECOMMENDATIONS, draftFor } from "./data";
import { getMockRun, startMockRun } from "./events";

interface Flags { delay?: number; empty?: boolean; fail?: string[]; speed?: number; expired?: boolean }

function flags(): Flags {
  try {
    return JSON.parse(localStorage.getItem("nextrole_mock") ?? "{}");
  } catch {
    return {};
  }
}

const PROFILE_KEY = "nextrole_mock_profile";
function loadProfile(): Profile | null {
  const raw = localStorage.getItem(PROFILE_KEY);
  if (raw === null) return PROFILE; // seeded demo user
  return raw === "null" ? null : (JSON.parse(raw) as Profile);
}
const saveProfileLocal = (p: Profile | null) => localStorage.setItem(PROFILE_KEY, JSON.stringify(p));

const state = {
  recs: structuredClone(RECOMMENDATIONS) as Recommendations,
  drafts: new Map<string, Outreach>([
    ["s1", draftFor("s1", "critic_passed", 1)],
    ["m1", draftFor("m1", "user_approved", 2)],
  ]),
  nextDraftId: 3,
  started: new Map<string, string>(),
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const err = (detail: string, status: number) => json({ detail }, status);
const noContent = () => new Response(null, { status: 204 });

const hasSession = () => typeof document !== "undefined" && document.cookie.split("; ").some((c) => c.startsWith(`${SESSION_COOKIE}=`));
const setSession = () => (document.cookie = `${SESSION_COOKIE}=mock; path=/; max-age=604800; samesite=lax`);
const clearSession = () => (document.cookie = `${SESSION_COOKIE}=; path=/; max-age=0`);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const allCards = (): JobCard[] => [...state.recs.startup, ...state.recs.mid, ...state.recs.mnc];

function finishRun(body: StartRunBody) {
  return (run: { mode: string; id: string }) => {
    if (run.mode === "outreach" && body.job_id) putDraft(body.job_id);
    if (run.mode === "single_job") {
      const id = `p${Date.now() % 100000}`;
      const card: JobCard = {
        job_id: id, title: "Backend Engineer", company: "Initech", location: "Remote", remote: true, score: 78,
        rationale: "Your FastAPI and PostgreSQL experience matches the API work in this posting.",
        strengths: ["FastAPI experience", "SQL reporting work"], gaps: ["No payments domain experience"],
        apply_url: body.url?.startsWith("https://") ? body.url : null, pasted: true,
      };
      state.recs.mid.unshift(card);
      putDraft(id, card);
    }
  };
}

function putDraft(jobId: string, card?: JobCard) {
  const existing = state.drafts.get(jobId);
  const base = draftFor(card ? ALL_JOBS[0].job_id : jobId, "critic_passed", existing?.id ?? state.nextDraftId++);
  const found = card ?? allCards().find((c) => c.job_id === jobId);
  state.drafts.set(jobId, {
    ...base, job_id: jobId, job_title: found?.title ?? base.job_title, company: found?.company ?? base.company,
    recipient_email: existing?.recipient_email ?? "", approved_at: null, status: "critic_passed",
  });
}

export async function mockFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const f = flags();
  await sleep(f.delay ?? 250);
  const method = (init.method ?? "GET").toUpperCase();
  const route = path.split("?")[0];
  const body = typeof init.body === "string" ? JSON.parse(init.body) : init.body;

  if (f.fail?.some((n) => route.includes(n))) return err("Simulated server error", 500);

  // ---- auth ----
  if (method === "POST" && (route === "/auth/login" || route === "/auth/signup")) {
    const { email, password } = body as { email: string; password: string };
    if (route === "/auth/signup" && email.toLowerCase() === "taken@example.com") return err("email already registered", 409);
    if (route === "/auth/login" && password === "wrong-password") return err("invalid email or password", 401);
    if (!email.includes("@")) return err("invalid email", 422);
    if (password.length < 8) return err("String should have at least 8 characters", 422);
    setSession();
    if (route === "/auth/signup") saveProfileLocal(null); // new account: goes through onboarding
    else if (localStorage.getItem(PROFILE_KEY) === null) saveProfileLocal(PROFILE);
    return json({ email: email.toLowerCase() }, route === "/auth/signup" ? 201 : 200);
  }
  if (method === "POST" && route === "/auth/logout") {
    clearSession();
    return noContent();
  }
  if (!hasSession() || f.expired) return err("not authenticated", 401);
  if (route === "/me") {
    if (method === "DELETE") {
      clearSession();
      localStorage.removeItem(PROFILE_KEY);
      return noContent();
    }
    return json({ email: MOCK_EMAIL });
  }

  // ---- profile / onboarding ----
  if (route === "/profile") {
    if (method === "PUT") {
      saveProfileLocal(body as Profile);
      return json(body);
    }
    const p = loadProfile();
    return p ? json(p) : err("no profile yet: complete onboarding", 404);
  }
  if (method === "POST" && route === "/onboarding") {
    const form = body as FormData;
    const file = form.get("resume") as File | null;
    const name = file?.name?.toLowerCase() ?? "";
    if (!file || file.size === 0) return err("empty file", 422);
    if (file.size > 5 * 1024 * 1024) return err("file too large (max 5 MB)", 422);
    if (!name.endsWith(".pdf") && !name.endsWith(".docx")) return err("unsupported file type: upload a PDF or DOCX", 422);
    const csv = (k: string) => String(form.get(k) ?? "").split(",").map((x) => x.trim()).filter(Boolean);
    await sleep(2800 * (f.speed ?? 1)); // resume parsing is the slow step in the real app
    const parsed: Profile = {
      ...PROFILE,
      preferences: {
        roles: csv("roles"), locations: csv("locations"), remote_ok: form.get("remote_ok") !== "false",
        experience_level: String(form.get("experience_level") ?? ""), extras: String(form.get("extras") ?? ""),
      },
    };
    saveProfileLocal(parsed);
    return json(parsed);
  }

  // ---- recommendations ----
  if (method === "GET" && route === "/recommendations") {
    return json(f.empty ? { startup: [], mid: [], mnc: [] } : state.recs);
  }

  // ---- runs ----
  if (method === "POST" && route === "/runs") {
    const b = body as StartRunBody;
    if (b.mode === "single_job" && !b.url?.trim() && !b.text?.trim()) return err("paste a job posting link or its text", 422);
    const blocked = /linkedin\.com|indeed\.com|naukri\.com/i.test(b.url ?? "") && !b.text?.trim();
    const id = startMockRun(b.mode, finishRun(b), {
      speed: f.speed ?? 1,
      failWith: blocked ? "NextRole doesn't read LinkedIn, Indeed or Naukri pages. Paste the posting text instead (you can keep the link too)." : undefined,
      failAt: 0,
    });
    state.started.set(id, new Date().toISOString().slice(0, 19).replace("T", " "));
    return json({ run_id: id }, 202);
  }
  if (method === "GET" && route === "/runs") {
    const live = [...state.started].map(([id, at]) => getMockRun(id)!.detail(at));
    const rows = [...live, ...PAST_RUNS].map((r) => ({ ...r, result: undefined, events: undefined }));
    return json(f.empty ? [] : rows);
  }
  const runMatch = route.match(/^\/runs\/([^/]+)$/);
  if (method === "GET" && runMatch) {
    const id = runMatch[1];
    const live = getMockRun(id);
    if (live) return json(live.detail(state.started.get(id) ?? ""));
    const past = PAST_RUNS.find((r) => r.id === id);
    return past ? json(past) : err("run not found", 404);
  }

  // ---- outreach ----
  if (method === "GET" && route === "/outreach") {
    return json(f.empty ? [] : [...state.drafts.values()].map((d) => ({ id: d.id, job_id: d.job_id, status: d.status })));
  }
  const byJob = route.match(/^\/outreach\/by-job\/([^/]+)$/);
  if (method === "GET" && byJob) {
    const d = state.drafts.get(decodeURIComponent(byJob[1]));
    return d ? json(d) : err("no draft for this job yet", 404);
  }
  const one = route.match(/^\/outreach\/(\d+)(\/approve|\/feedback)?$/);
  if (one) {
    const draft = [...state.drafts.values()].find((d) => d.id === Number(one[1]));
    if (!draft) return err("draft not found", 404);
    if (method === "DELETE") {
      state.drafts.delete(draft.job_id);
      return noContent();
    }
    if (method === "PUT") {
      const b = body as { subject: string; body: string; recipient_email: string };
      if (b.recipient_email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.recipient_email)) return err("invalid recipient email", 422);
      Object.assign(draft, b, { status: "draft", critic: null, approved_at: null });
      return json(draft);
    }
    if (method === "POST" && one[2] === "/approve") {
      Object.assign(draft, { status: "user_approved", approved_at: new Date().toISOString() });
      return json(draft);
    }
    if (method === "POST" && one[2] === "/feedback") {
      const b = body as { rating: number; note: string };
      draft.feedback = { rating: b.rating, note: b.note };
      return json(draft);
    }
  }

  return err(`mock: no route for ${method} ${route}`, 404);
}
