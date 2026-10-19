/**
 * Realistic sample data for mock mode. Companies are fictional on purpose: these are demo
 * fixtures, not real postings. Apply URLs are https (the app refuses anything else).
 */
import type { JobCard, Outreach, Profile, Recommendations, RunDetail, RunEvent } from "../schemas";

export const MOCK_EMAIL = "priya.nair@example.com";

export const PROFILE: Profile = {
  name: "Priya Nair",
  summary: "New grad software engineer with backend and database experience, looking for an API-heavy team.",
  skills: ["Python", "FastAPI", "PostgreSQL", "SQL", "Docker", "React", "REST APIs", "Git"],
  experience: [
    {
      company: "Finlytics",
      title: "Backend Engineering Intern",
      start: "2025-06",
      end: "2025-09",
      bullets: [
        "Built REST endpoints in FastAPI for an invoicing service",
        "Wrote PostgreSQL queries and migrations for reporting tables",
        "Added pytest coverage for payment webhooks",
      ],
    },
  ],
  projects: [
    { name: "Expense splitter", description: "Expense-sharing web app with auth and settlement logic", tech: ["FastAPI", "PostgreSQL", "React"] },
    { name: "URL shortener", description: "Rate-limited URL shortener deployed with Docker", tech: ["Python", "Redis", "Docker"] },
  ],
  education: [{ institution: "University of Leeds", degree: "BSc Computer Science", year: "2026" }],
  preferences: {
    roles: ["Software Engineer", "Backend Engineer"],
    locations: ["London", "Dublin"],
    remote_ok: true,
    experience_level: "Intern / New grad",
    extras: "Prefer small teams and a real mentoring culture.",
  },
};

function job(
  id: string, title: string, company: string, location: string, remote: boolean, score: number,
  rationale: string, strengths: string[], gaps: string[],
): JobCard {
  return {
    job_id: id, title, company, location, remote, score, rationale, strengths, gaps,
    apply_url: `https://jobs.example.com/${company.toLowerCase().replace(/[^a-z]+/g, "-")}/${id}`,
    pasted: false,
  };
}

export const RECOMMENDATIONS: Recommendations = {
  startup: [
    job("s1", "Software Engineer, Platform", "Lumen Labs", "Remote (EU)", true, 86,
      "You have shipped FastAPI services backed by PostgreSQL, which is exactly this team's stack.",
      ["FastAPI and PostgreSQL experience", "Wrote migrations in an internship", "Comfortable with Docker"],
      ["No Kubernetes exposure", "No on-call experience"]),
    job("s2", "Backend Engineer, APIs", "Parcelwise", "London", false, 79,
      "Your invoicing-service internship maps well to their order and billing APIs.",
      ["Built REST endpoints with tests", "SQL reporting work"], ["Limited event-driven systems experience"]),
    job("s3", "Full-stack Engineer", "Quillnote", "Remote (UK)", true, 68,
      "Solid React and FastAPI project work, though the role leans more on TypeScript than Python.",
      ["React and FastAPI project", "Shipped a deployed side project"], ["TypeScript is not on your profile", "No product analytics experience"]),
    job("s4", "Machine Learning Engineer", "Harbor AI", "Dublin", false, 54,
      "Strong Python, but this role expects model-serving experience you have not listed.",
      ["Python", "Data pipeline basics"], ["No PyTorch or model deployment", "No MLOps tooling"]),
  ],
  mid: [
    job("m1", "Backend Engineer, Data Platform", "Northwind Health", "London · Hybrid", false, 82,
      "Your PostgreSQL migrations and reporting queries line up with their data platform work.",
      ["PostgreSQL migrations", "Reporting queries", "pytest coverage"], ["No Spark or warehouse experience"]),
    job("m2", "Software Engineer, Payments", "Fieldstone", "Dublin", false, 74,
      "Payment-webhook tests from your internship are directly relevant; the role is more senior in scope.",
      ["Tested payment webhooks", "REST API design"], ["Asks for 2+ years in production payments"]),
    job("m3", "Platform Engineer", "Orbitly", "Remote (EU)", true, 61,
      "Docker experience helps, but the role centres on Terraform and Kubernetes.",
      ["Docker"], ["No Terraform", "No Kubernetes", "No cloud certification"]),
    job("m4", "Data Engineer", "Brightline", "London", false, 58,
      "SQL is a strength, but the team wants Airflow and Spark experience.",
      ["Strong SQL"], ["No Airflow", "No Spark"]),
  ],
  mnc: [
    job("g1", "Software Engineer II", "Meridian Systems", "Dublin", false, 77,
      "Right level and language, and your internship maps to their services team.",
      ["Python backend internship", "Clear testing habits"], ["Large-scale systems experience is limited"]),
    job("g2", "Graduate Software Engineer", "Helix Technologies", "London", false, 71,
      "A graduate programme that fits your level; the rotation includes backend and data teams.",
      ["New-grad level fit", "Relevant coursework"], ["Programme is competitive", "No Java"]),
    job("g3", "Backend Developer", "Vantage Group", "Remote (UK)", true, 63,
      "Good language match, but the stack is mostly Java and Spring.",
      ["REST API design"], ["No Java or Spring", "No enterprise integration work"]),
    job("g4", "Associate Engineer", "Atlas Global", "Dublin", false, 52,
      "Entry-level role in a different domain (embedded tooling) from your background.",
      ["Python scripting"], ["No embedded or C/C++ experience", "No hardware exposure"]),
  ],
};

export const ALL_JOBS: JobCard[] = [...RECOMMENDATIONS.startup, ...RECOMMENDATIONS.mid, ...RECOMMENDATIONS.mnc];

export function draftFor(jobId: string, status: Outreach["status"], id: number): Outreach {
  const j = ALL_JOBS.find((x) => x.job_id === jobId) ?? ALL_JOBS[0];
  return {
    id,
    job_id: j.job_id,
    job_title: j.title,
    company: j.company,
    channel: "email",
    subject: `FastAPI and PostgreSQL work for the ${j.title} role`,
    body:
      `Hi there,\n\nI saw the ${j.title} role at ${j.company}. At Finlytics I built REST endpoints in FastAPI for an invoicing service and wrote PostgreSQL migrations for the reporting tables, which is close to the API work in your posting.\n\n` +
      `I also built an expense-sharing app with FastAPI, PostgreSQL and React, so I have worked across the stack. I graduate from the University of Leeds in 2026.\n\n` +
      `Could you point me to the right person to talk to about this role, or would a short call be possible?\n\nPriya Nair`,
    recipient_email: status === "user_approved" ? "talent@example.com" : "",
    status,
    critic:
      status === "draft"
        ? null
        : {
            scores: { specificity: 82, grounding: 94, tone: 88, no_fluff: 91, length: 100 },
            overall: 90,
            unsupported_claims: [],
            violations: [],
            verdict: "pass",
            rewrite_instructions: "",
          },
    warnings: [],
    attempts: 2,
    facts_used: [
      { id: "F-P1", text: "Candidate name: Priya Nair", source: "profile", source_ref: null },
      { id: "F-P4", text: "At Finlytics: Built REST endpoints in FastAPI for an invoicing service", source: "profile", source_ref: null },
      { id: "F-P5", text: "At Finlytics: Wrote PostgreSQL queries and migrations for reporting tables", source: "profile", source_ref: null },
      { id: "F-J1", text: `Role: ${j.title} at ${j.company}`, source: "job", source_ref: j.apply_url },
      { id: "F-J4", text: "Job posting says: You will design and operate the APIs that power our customer dashboard.", source: "job", source_ref: j.apply_url },
    ],
    approved_at: status === "user_approved" ? "2026-10-18T14:22:00Z" : null,
    feedback: null,
  };
}

function ev(seq: number, type: RunEvent["type"], step: string, detail: string, ms: number, tokens: number, data: RunEvent["data"] = {}): RunEvent {
  return { seq, ts: 1760800000 + seq * 3, type, step, detail, latency_ms: ms, tokens, cost_usd: tokens * 0.0000045, data };
}

function pastRun(id: string, mode: RunDetail["mode"], status: RunDetail["status"], started: string, steps: [string, string, number][], tokens: number, error: string | null = null): RunDetail {
  const events: RunEvent[] = [ev(0, "run_started", "", "", 0, 0, { mode }), ev(1, "plan", "", "", 0, 0, { steps: steps.map((s) => s[0]) })];
  let seq = 2;
  let t = 0;
  steps.forEach(([step, detail, ms], i) => {
    t += Math.round((tokens / steps.length) * (i + 1) > 0 ? tokens / steps.length : 0);
    events.push(ev(seq++, "step_started", step, "", 0, Math.round(t - tokens / steps.length)));
    events.push(ev(seq++, error && i === steps.length - 1 ? "step_failed" : "step_finished", step, detail, ms, Math.round(t)));
  });
  events.push(ev(seq, "run_finished", "", status, 0, tokens, { status, result: {}, error }));
  return {
    id, mode, status, job_id: null, tokens, cost_usd: tokens * 0.0000045, error, started_at: started,
    finished_at: started, result: {}, events,
  };
}

export const PAST_RUNS: RunDetail[] = [
  pastRun("a1b2c3d4e5f6", "recommend", "completed", "2026-10-19 18:30:10", [
    ["discover", "1,284 openings from 40 boards", 30900], ["tier", "37 companies classified", 2800],
    ["select", "40 candidates picked from 1,284 openings", 650], ["match", "scored 40 of 40 candidates", 12100], ["save", "saved 40 recommendations", 40],
  ], 33755),
  pastRun("b2c3d4e5f6a1", "outreach", "completed", "2026-10-19 19:02:44", [
    ["research", "6 sourced facts about Lumen Labs", 5200], ["facts", "26 facts available to the writer", 12], ["write", "draft attempt 1 (118 words)", 7400],
    ["critic", "score 90/100, passed", 5100], ["save", "draft saved (critic_passed)", 30],
  ], 11204),
  pastRun("c3d4e5f6a1b2", "single_job", "failed", "2026-10-20 09:15:02", [["ingest", "NextRole doesn't read LinkedIn, Indeed or Naukri pages. Paste the posting text instead (you can keep the link too).", 1]], 0,
    "NextRole doesn't read LinkedIn, Indeed or Naukri pages. Paste the posting text instead (you can keep the link too)."),
];
