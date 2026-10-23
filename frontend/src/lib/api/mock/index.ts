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
import type { Alert, AlertSettings, Company, JobCard, Outreach, Profile, Recommendations, SavedJob, SavedStatus, StartRunBody, Tier } from "../schemas";
import { ALL_JOBS, MOCK_EMAIL, PAST_RUNS, PROFILE, RECOMMENDATIONS, draftFor } from "./data";
import { getMockRun, startMockRun } from "./events";
import { interviewRoutes } from "./interviews";

interface Flags { delay?: number; empty?: boolean; fail?: string[]; speed?: number; expired?: boolean; admin?: boolean }

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

// ---- saved jobs and companies (persisted in localStorage so a reload keeps them) ----
const SAVED_KEY = "nextrole_mock_saved";
const COMPANIES_KEY = "nextrole_mock_companies";
const BOARD_COMPANIES = ["Stripe", "Airbnb", "Databricks", "Cloudflare", "Figma", "Discord", "Coinbase"];
const read = <T,>(key: string, fallback: T): T => {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback;
  } catch {
    return fallback;
  }
};
const loadSaved = () => read<SavedJob[]>(SAVED_KEY, []);
const storeSaved = (rows: SavedJob[]) => localStorage.setItem(SAVED_KEY, JSON.stringify(rows));
const loadCompanies = () => read<Company[]>(COMPANIES_KEY, []);
const storeCompanies = (rows: Company[]) => localStorage.setItem(COMPANIES_KEY, JSON.stringify(rows));
const ROLE_ALIASES: Record<string, [string, string]> = {
  sde: ["software_engineer", "Software Engineer"],
  swe: ["software_engineer", "Software Engineer"],
  "software engineer": ["software_engineer", "Software Engineer"],
  fde: ["forward_deployed_engineer", "Forward Deployed Engineer"],
  "forward deployed engineer": ["forward_deployed_engineer", "Forward Deployed Engineer"],
  "backend engineer": ["backend_engineer", "Backend Engineer"],
  "data engineer": ["data_engineer", "Data Engineer"],
};

function savedFromCard(card: JobCard, tier: Tier, status: SavedStatus, id: number): SavedJob {
  const now = new Date().toISOString();
  return {
    id, job_id: card.job_id, tier, status, notes: "", saved_at: now, status_updated_at: now, listed: true, delisted_at: null,
    title: card.title, company: card.company, location: card.location, remote: card.remote, apply_url: card.apply_url,
    summary: card.rationale, source: card.pasted ? "pasted" : "greenhouse",
  };
}

const ALERTS_KEY = "nextrole_mock_alerts";
const ALERT_SETTINGS_KEY = "nextrole_mock_alert_settings";
const DEMO_ALERTS: Alert[] = [
  {
    id: 1, job_id: "al1", title: "Software Development Engineer II", company: "Stripe", location: "Remote (EU)", remote: true,
    apply_url: "https://boards.example.com/stripe/101", summary: "Build and operate payment APIs.", role: "SDE",
    why: "\u201cSoftware Development Engineer II\u201d is a Software Engineer role, the same kind of job as your wanted role \u201cSDE\u201d.",
    confidence: 0.95, method: "taxonomy", created_at: "2026-10-20T08:00:00+00:00", read: false,
  },
  {
    id: 2, job_id: "al2", title: "Customer Solutions Engineer", company: "Figma", location: "London", remote: false,
    apply_url: "https://boards.example.com/figma/7", summary: "Work with enterprise customers on integrations.", role: "Forward Deployed Engineer",
    why: "Customer Solutions Engineer is hands-on customer engineering, close to your forward deployed engineer target.",
    confidence: 0.82, method: "llm", created_at: "2026-10-19T08:00:00+00:00", read: true,
  },
];
const loadAlerts = () => read<Alert[]>(ALERTS_KEY, DEMO_ALERTS);
const storeAlerts = (rows: Alert[]) => localStorage.setItem(ALERTS_KEY, JSON.stringify(rows));
const loadAlertSettings = () => read<AlertSettings>(ALERT_SETTINGS_KEY, { in_app: true, email: false, frequency: "daily", email_available: true });

function alertRoutes(method: string, path: string, body: unknown): Response | null {
  const url = new URL(path, "http://mock");
  const route = url.pathname;
  if (route === "/alerts" && method === "GET") {
    const rows = [...loadAlerts()].sort((a, b) => b.created_at.localeCompare(a.created_at));
    return json(url.searchParams.get("unread") === "true" ? rows.filter((a) => !a.read) : rows);
  }
  if (route === "/alerts/summary" && method === "GET") return json({ unread: loadAlerts().filter((a) => !a.read).length });
  if (route === "/alerts/settings" && method === "GET") return json(loadAlertSettings());
  if (route === "/alerts/settings" && method === "PUT") {
    const next = { ...loadAlertSettings(), ...(body as Partial<AlertSettings>) };
    localStorage.setItem(ALERT_SETTINGS_KEY, JSON.stringify(next));
    return json(next);
  }
  if (route === "/alerts/read-all" && method === "POST") {
    const rows = loadAlerts();
    const updated = rows.filter((a) => !a.read).length;
    storeAlerts(rows.map((a) => ({ ...a, read: true })));
    return json({ updated });
  }
  if (route === "/alerts/check" && method === "POST") return json({ created: 0, boards: loadCompanies().filter((c) => c.monitored).length, errors: 0 });
  if (route === "/alerts/unsubscribe" && method === "POST") return url.searchParams.get("token") === "bad" ? err("link not valid", 404) : noContent();
  const one = route.match(/^\/alerts\/(\d+)(\/read)?$/);
  if (one) {
    const rows = loadAlerts();
    const i = rows.findIndex((a) => a.id === Number(one[1]));
    if (i < 0) return err("alert not found", 404);
    if (method === "DELETE") {
      storeAlerts(rows.filter((_, j) => j !== i));
      return noContent();
    }
    if (method === "POST" && one[2]) {
      rows[i] = { ...rows[i], read: true };
      storeAlerts(rows);
      return json(rows[i]);
    }
  }
  return null;
}

function savedRoutes(method: string, path: string, body: unknown): Response | null {
  const url = new URL(path, "http://mock");
  const route = url.pathname;
  const find = (job_id: string): [JobCard, Tier] | null => {
    for (const t of ["startup", "mid", "mnc"] as const) {
      const c = state.recs[t].find((x) => x.job_id === job_id);
      if (c) return [c, t];
    }
    return null;
  };
  if (route === "/saved-jobs" && method === "GET") {
    const q = url.searchParams;
    let rows = loadSaved();
    if (q.get("status")) rows = rows.filter((r) => r.status === q.get("status"));
    if (q.get("tier")) rows = rows.filter((r) => r.tier === q.get("tier"));
    if (q.get("listed")) rows = rows.filter((r) => String(r.listed) === q.get("listed"));
    const needle = (q.get("q") ?? "").toLowerCase();
    if (needle) rows = rows.filter((r) => `${r.title} ${r.company} ${r.notes}`.toLowerCase().includes(needle));
    rows = [...rows].sort((a, b) => b.saved_at.localeCompare(a.saved_at) || b.id - a.id);
    if (q.get("sort") === "saved_asc") rows.reverse();
    if (q.get("sort") === "company") rows.sort((a, b) => a.company.localeCompare(b.company));
    return json(rows);
  }
  if (route === "/saved-jobs" && method === "POST") {
    const b = body as { job_id: string; status?: SavedStatus };
    const hit = find(b.job_id);
    if (!hit) return err("job not found", 404);
    const rows = loadSaved();
    const existing = rows.find((r) => r.job_id === b.job_id);
    if (existing) return json(existing, 201);
    const row = savedFromCard(hit[0], hit[1], b.status ?? "saved", Date.now() % 1e9);
    storeSaved([...rows, row]);
    return json(row, 201);
  }
  if (route === "/saved-jobs/import" && method === "POST") {
    const items = (body as { items: { job_id: string; status: SavedStatus; notes: string }[] }).items;
    const rows = loadSaved();
    let imported = 0;
    const skipped: string[] = [];
    for (const it of items) {
      const hit = find(it.job_id);
      if (!hit) skipped.push(it.job_id);
      else if (!rows.some((r) => r.job_id === it.job_id)) {
        rows.push({ ...savedFromCard(hit[0], hit[1], it.status, (Date.now() % 1e9) + imported), notes: it.notes });
        imported++;
      }
    }
    storeSaved(rows);
    return json({ imported, skipped });
  }
  const one = route.match(/^\/saved-jobs\/(\d+)$/);
  if (one) {
    const rows = loadSaved();
    const i = rows.findIndex((r) => r.id === Number(one[1]));
    if (i < 0) return err("saved job not found", 404);
    if (method === "DELETE") {
      rows.splice(i, 1);
      storeSaved(rows);
      return noContent();
    }
    if (method === "PATCH") {
      const b = body as { status?: SavedStatus; notes?: string };
      rows[i] = { ...rows[i], ...(b.status ? { status: b.status, status_updated_at: new Date().toISOString() } : {}), ...(b.notes !== undefined ? { notes: b.notes.replace(/<[^>]*>/g, "").slice(0, 2000) } : {}) };
      storeSaved(rows);
      return json(rows[i]);
    }
  }
  if (route === "/companies" && method === "GET") return json(loadCompanies());
  if (route === "/companies/suggestions" && method === "GET") {
    const have = new Set(loadCompanies().map((c) => c.name.toLowerCase()));
    const q = (url.searchParams.get("q") ?? "").toLowerCase();
    return json(BOARD_COMPANIES.filter((n) => !have.has(n.toLowerCase()) && n.toLowerCase().includes(q)));
  }
  if (route === "/companies" && method === "POST") {
    const name = String((body as { name: string }).name ?? "").replace(/<[^>]*>/g, "").trim();
    if (!name) return err("Enter a company name.", 422);
    const rows = loadCompanies();
    const dup = rows.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (dup) return json(dup, 201);
    const row: Company = { id: (Date.now() % 1e9) + rows.length, name, monitored: BOARD_COMPANIES.some((n) => n.toLowerCase() === name.toLowerCase()) };
    storeCompanies([...rows, row]);
    return json(row, 201);
  }
  const co = route.match(/^\/companies\/(\d+)$/);
  if (co && method === "DELETE") {
    const rows = loadCompanies();
    if (!rows.some((c) => c.id === Number(co[1]))) return err("company not found", 404);
    storeCompanies(rows.filter((c) => c.id !== Number(co[1])));
    return noContent();
  }
  if (route === "/roles/taxonomy" && method === "GET") {
    const seen = new Map<string, { canonical: string; label: string; aliases: string[] }>();
    for (const [alias, [canonical, label]] of Object.entries(ROLE_ALIASES)) {
      const e = seen.get(canonical) ?? { canonical, label, aliases: [] };
      e.aliases.push(alias);
      seen.set(canonical, e);
    }
    return json([...seen.values()]);
  }
  if (route === "/roles/resolve" && method === "POST") {
    const roles = (body as { roles: string[] }).roles;
    return json(roles.map((text) => {
      const hit = ROLE_ALIASES[text.trim().toLowerCase()];
      return { text, canonical: hit?.[0] ?? null, label: hit?.[1] ?? null, also_matches: hit ? Object.keys(ROLE_ALIASES).filter((a) => ROLE_ALIASES[a][0] === hit[0]) : [] };
    }));
  }
  return null;
}

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
    if (route === "/auth/signup" && (password.length < 8 || !/\p{Lu}/u.test(password) || !/\p{Ll}/u.test(password) || !/[^\p{L}\p{N}\s]/u.test(password))) {
      return err("password needs at least 8 characters, an uppercase letter, a lowercase letter, a special character", 422);
    }
    if (password.length < 1) return err("password required", 422);
    setSession();
    if (route === "/auth/signup") saveProfileLocal(null); // new account: goes through onboarding
    else if (localStorage.getItem(PROFILE_KEY) === null) saveProfileLocal(PROFILE);
    return json({ email: email.toLowerCase() }, route === "/auth/signup" ? 201 : 200);
  }
  if (method === "POST" && route === "/auth/logout") {
    clearSession();
    return noContent();
  }
  if (method === "POST" && route === "/alerts/unsubscribe") return alertRoutes(method, path, body)!; // public: the token is the credential
  if (!hasSession() || f.expired) return err("not authenticated", 401);
  if (route === "/me") {
    if (method === "DELETE") {
      clearSession();
      localStorage.removeItem(PROFILE_KEY);
      return noContent();
    }
    return json({ email: MOCK_EMAIL, role: f.admin ? "admin" : "user" });
  }
  if (route === "/me/export") {
    return json({ format: 1, exported_at: new Date().toISOString(), account: { email: MOCK_EMAIL }, profile: loadProfile() });
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

  const savedResponse = savedRoutes(method, path, body) ?? alertRoutes(method, path, body)
    ?? interviewRoutes(method, path, body, { json, err, noContent, admin: Boolean(f.admin) });
  if (savedResponse) return savedResponse;

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
