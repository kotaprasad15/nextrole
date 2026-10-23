/**
 * Mock server for interview experiences and moderation (same routes, status codes and shapes as the
 * real API; held to the Zod schemas by tests). State persists in localStorage so reloads keep it.
 * The mock member is user 1. To preview the moderation page set `{"admin": true}` in `nextrole_mock`.
 */
import type { AdminInterview, InterviewInput } from "../schemas";

type Row = AdminInterview & { voters: number[]; reports: { id: number; reporter: number; reason: string; detail: string; open: boolean }[] };
interface Helpers {
  json: (data: unknown, status?: number) => Response;
  err: (detail: string, status: number) => Response;
  noContent: () => Response;
  admin: boolean;
}

const KEY = "nextrole_mock_interviews";
const ME = 1;
const PAGE = 20;

const seed = (id: number, over: Partial<Row>): Row => ({
  id, company: "Acme", role: "Software Engineer", level: "mid", interviewed_on: "2026-08", difficulty: 3, outcome: "offer",
  rounds: [{ type: "coding", difficulty: 3, notes: "Two medium problems on graphs and arrays." }, { type: "system_design", difficulty: 4, notes: "Design a rate limiter." }],
  tips: "Practise explaining your trade-offs out loud.", created_at: `2026-09-0${id}T09:00:00+00:00`, author: null, mine: false, upvotes: 0, upvoted: false,
  status: "approved", moderator_note: "", author_id: 100 + id, auto_check: { flags: [], llm: null, llm_status: "ok", risk: "low" }, open_reports: 0,
  voters: [], reports: [], ...over,
});

const SEED: Row[] = [
  seed(1, { company: "Lumen Labs", role: "Platform Engineer", difficulty: 4, voters: [201, 202, 203] }),
  seed(2, { company: "Orbit Systems", role: "Backend Engineer", level: "senior", difficulty: 5, outcome: "rejected", tips: "The final round was heavy on distributed systems.", author: "Sam", voters: [201] }),
  seed(3, { company: "Pixel Studio", role: "Data Scientist", level: "junior", difficulty: 2, tips: "Know your statistics: p-values, confidence intervals." }),
  seed(4, { company: "Initech", role: "Software Engineer", status: "pending", author_id: ME, mine: true, created_at: "2026-10-01T09:00:00+00:00" }),
];

const load = (): Row[] => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "null") ?? SEED;
  } catch {
    return SEED;
  }
};
const store = (rows: Row[]) => localStorage.setItem(KEY, JSON.stringify(rows));

const publicShape = (r: Row) => {
  const mine = r.author_id === ME;
  const { voters, reports, author_id: _a, auto_check: _c, open_reports: _o, status, moderator_note, ...rest } = r;
  void _a; void _c; void _o; void reports;
  return { ...rest, mine, upvotes: voters.length, upvoted: voters.includes(ME), ...(mine ? { status, moderator_note } : {}) };
};
const adminShape = (r: Row): AdminInterview => {
  const { voters, reports, ...rest } = r;
  return { ...rest, upvotes: voters.length, open_reports: reports.filter((x) => x.open).length };
};

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE = /(?<![\w.])\+?\d[\d\s().-]{8,}\d(?![\w.])/;
const LINK = /\b(?:https?:\/\/|www\.)\S+|linkedin\.com/i;
const plain = (s: string) => s.replace(/<[^>]*>/g, "").trim();

export function interviewRoutes(method: string, path: string, body: unknown, h: Helpers): Response | null {
  const url = new URL(path, "http://mock");
  const route = url.pathname;
  const rows = load();
  const find = (id: number) => rows.find((r) => r.id === id);

  // ---- members ----
  if (route === "/interviews" && method === "GET") {
    const q = url.searchParams;
    let list = rows.filter((r) => r.status === "approved");
    const has = (k: string) => (q.get(k) ?? "").trim().toLowerCase();
    if (has("company")) list = list.filter((r) => r.company.toLowerCase().includes(has("company")));
    if (has("role")) list = list.filter((r) => r.role.toLowerCase().includes(has("role")) || (has("role") === "sde" && /software/i.test(r.role)));
    if (q.get("difficulty")) list = list.filter((r) => r.difficulty === Number(q.get("difficulty")));
    if (has("outcome")) list = list.filter((r) => r.outcome === has("outcome"));
    if (has("level")) list = list.filter((r) => r.level === has("level"));
    if (has("q")) list = list.filter((r) => `${r.company} ${r.role} ${r.tips} ${r.rounds.map((x) => x.notes).join(" ")}`.toLowerCase().includes(has("q")));
    list = [...list].sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (q.get("sort") === "helpful") list.sort((a, b) => b.voters.length - a.voters.length);
    const page = Math.max(1, Number(q.get("page") ?? 1));
    return h.json({ items: list.slice((page - 1) * PAGE, page * PAGE).map(publicShape), total: list.length, page, page_size: PAGE });
  }
  if (route === "/interviews/mine" && method === "GET") return h.json(rows.filter((r) => r.author_id === ME).map(publicShape));
  if (route === "/interviews" && method === "POST") {
    const b = body as InterviewInput;
    const text = [b.company, b.role, b.tips, ...b.rounds.map((r) => r.notes)].join("\n");
    const bad = [EMAIL.test(text) && "Please remove email addresses.", PHONE.test(text) && "Please remove phone numbers.", LINK.test(text) && "Please remove links (to profiles, documents or websites)."].filter(Boolean);
    if (bad.length) return h.err(`${bad.join(" ")} Interview posts are public to other members and must not contain personal details.`, 422);
    if (!plain(b.company) || !plain(b.role)) return h.err("company and role are required", 422);
    const id = Math.max(0, ...rows.map((r) => r.id)) + 1;
    store([...rows, seed(id, { ...b, company: plain(b.company), role: plain(b.role), tips: plain(b.tips), status: "pending", author_id: ME, created_at: new Date().toISOString(), author: null, voters: [] })]);
    return h.json({ id, status: "pending", message: "Thanks! A moderator reviews every post before it is published." }, 201);
  }
  const one = route.match(/^\/interviews\/(\d+)(\/upvote|\/report)?$/);
  if (one) {
    const row = find(Number(one[1]));
    const visible = row && (row.status === "approved" || row.author_id === ME);
    if (!row || !visible) return h.err("not found", 404);
    if (!one[2] && method === "GET") return h.json(publicShape(row));
    if (!one[2] && method === "PUT") {
      if (row.author_id !== ME) return h.err("not found", 404);
      const b = body as InterviewInput;
      Object.assign(row, b, { status: "pending", moderator_note: "" });
      store(rows);
      return h.json({ id: row.id, status: "pending", message: "Saved. Because you changed it, a moderator will review it again." });
    }
    if (!one[2] && method === "DELETE") {
      if (row.author_id !== ME) return h.err("not found", 404);
      store(rows.filter((r) => r.id !== row.id));
      return h.noContent();
    }
    if (one[2] === "/upvote") {
      if (row.status !== "approved" || row.author_id === ME) return h.err("not found", 404);
      row.voters = method === "POST" ? [...new Set([...row.voters, ME])] : row.voters.filter((v) => v !== ME);
      store(rows);
      return h.json(publicShape(row));
    }
    if (one[2] === "/report" && method === "POST") {
      if (row.author_id === ME) return h.err("You cannot report your own post. You can edit or delete it instead.", 409);
      if (row.reports.some((r) => r.reporter === ME)) return h.err("You have already reported this post. A moderator will look at it.", 409);
      const b = body as { reason: string; detail: string };
      row.reports.push({ id: Date.now() % 1e9, reporter: ME, reason: b.reason, detail: plain(b.detail ?? ""), open: true });
      store(rows);
      return h.json({ message: "Thank you. A moderator will review this post." }, 201);
    }
  }

  // ---- admins (the real server answers 404 to everyone else) ----
  if (route.startsWith("/admin/")) {
    if (!h.admin) return h.err("not found", 404);
    if (route === "/admin/interviews" && method === "GET") {
      const status = url.searchParams.get("status") ?? "pending";
      const rank = { high: 0, medium: 1, low: 2 } as const;
      return h.json(rows.filter((r) => r.status === status).map(adminShape).sort((a, b) => rank[a.auto_check.risk] - rank[b.auto_check.risk]));
    }
    const act = route.match(/^\/admin\/interviews\/(\d+)\/(approve|reject|remove)$/);
    if (act && method === "POST") {
      const row = find(Number(act[1]));
      if (!row) return h.err("not found", 404);
      row.status = ({ approve: "approved", reject: "rejected", remove: "removed" } as const)[act[2] as "approve" | "reject" | "remove"];
      row.moderator_note = plain((body as { note?: string })?.note ?? "");
      if (act[2] === "approve") row.reports.forEach((r) => (r.open = false));
      store(rows);
      return h.json(adminShape(row));
    }
    if (route === "/admin/reports" && method === "GET") {
      return h.json(rows.flatMap((r) => r.reports.filter((x) => x.open).map((x) => ({ id: x.id, exp_id: r.id, reason: x.reason, detail: x.detail, created_at: r.created_at, company: r.company, role: r.role, exp_status: r.status }))));
    }
    const dis = route.match(/^\/admin\/reports\/(\d+)\/dismiss$/);
    if (dis && method === "POST") {
      for (const r of rows) for (const x of r.reports) if (x.id === Number(dis[1])) x.open = false;
      store(rows);
      return h.noContent();
    }
  }
  return null;
}

/** Sample aggregates for the admin dashboard in mock mode (only reachable with the admin switch). */
export function adminRoutes(method: string, path: string, h: Helpers): Response | null {
  const url = new URL(path, "http://mock");
  if (!h.admin) return url.pathname.startsWith("/admin/") ? h.err("not found", 404) : null;
  if (url.pathname === "/admin/metrics" && method === "GET") {
    const days = Math.min(365, Math.max(1, Number(url.searchParams.get("days") ?? 30)));
    const today = new Date("2026-10-20T00:00:00Z");
    const series = Array.from({ length: days }, (_, i) => {
      const d = new Date(today.getTime() - (days - 1 - i) * 86_400_000);
      const requests = 40 + ((i * 37) % 90);
      const errors = i % 7 === 0 ? 6 : i % 3;
      return { day: d.toISOString().slice(0, 10), requests, errors, tokens: requests * 2400, cost_usd: Math.round(requests * 0.0112 * 1e6) / 1e6 };
    });
    const sum = (k: "requests" | "errors" | "tokens" | "cost_usd") => series.reduce((n, s) => n + s[k], 0);
    const totals = { llm_requests: sum("requests"), llm_errors: sum("errors"), error_rate: sum("errors") / sum("requests"), tokens_in: Math.round(sum("tokens") * 0.8),
      tokens_out: Math.round(sum("tokens") * 0.2), tokens: sum("tokens"), cost_usd: Math.round(sum("cost_usd") * 100) / 100, avg_latency_ms: 2140.5 };
    const previous = { ...totals, llm_requests: Math.round(totals.llm_requests * 0.82), tokens: Math.round(totals.tokens * 0.85), cost_usd: Math.round(totals.cost_usd * 0.9 * 100) / 100, error_rate: totals.error_rate * 1.3 };
    const model = (name: string, share: number) => ({ name, requests: Math.round(totals.llm_requests * share), errors: Math.round(totals.llm_errors * share), error_rate: totals.error_rate, tokens: Math.round(totals.tokens * share), cost_usd: Math.round(totals.cost_usd * share * 100) / 100 });
    const stage = (name: string, share: number) => ({ ...model(name, share) });
    return h.json({
      range: { days, from: series[0].day, to: series[series.length - 1].day }, totals, previous,
      by_model: [model("claude-sonnet-5-5", 0.7), model("claude-haiku-5-5", 0.3)],
      by_stage: [stage("writer", 0.35), stage("critic", 0.3), stage("matcher", 0.25), stage("intake", 0.1)],
      series,
      runs: { total: 120, failed: 6, error_rate: 0.05, by_mode: [{ mode: "recommend", total: 60, failed: 2, completed: 58 }, { mode: "outreach", total: 50, failed: 3, completed: 47 }, { mode: "single_job", total: 10, failed: 1, completed: 9 }] },
      http: { requests: 5400, client_errors: 210, server_errors: 12, error_rate: 12 / 5400, series: series.map((s) => ({ day: s.day, requests: s.requests * 4 })) },
      alerts: { passes: 24, alerts_created: 31, emails_sent: 9, errors: 1 },
      interviews: { pending: 3, approved: 18, rejected: 2, removed: 1, open_reports: 1 },
      accounts: { total: 42 },
    });
  }
  if (url.pathname === "/admin/traces" && method === "GET") return h.json([{ run_id: "a1b2c3d4e5f6", modified: "2026-10-20T10:00:00+00:00", size_bytes: 4096 }]);
  const t = url.pathname.match(/^\/admin\/traces\/([A-Za-z0-9_-]{4,64})$/);
  if (t && method === "GET") {
    return h.json([
      { run_id: t[1], ts: 1_760_000_000, agent: "matcher", inputs: { model: "claude-haiku-5-5", system: "<str len=900 sha=1a2b3c4d>" }, outputs: { text: "<redacted>" }, latency_ms: 812.4, input_tokens: 640, output_tokens: 120, cost_usd: 0.0037, error: null },
      { run_id: t[1], ts: 1_760_000_003, agent: "writer", inputs: { model: "claude-sonnet-5-5" }, outputs: {}, latency_ms: 3120, input_tokens: 1800, output_tokens: 400, cost_usd: 0.0114, error: null },
    ]);
  }
  return null;
}
