import { beforeEach, describe, expect, it } from "vitest";
import type { JobCard, RunEvent } from "@/lib/api/schemas";
import { DEFAULT_FILTERS, activeFilterCount, filterJobs } from "./filters";
import { validatePaste } from "./paste";
import { buildRunSteps, runFailure } from "./run-steps";

const job = (o: Partial<JobCard>): JobCard => ({
  job_id: "j", title: "Backend Engineer", company: "Acme", location: "Berlin", remote: false, score: 70,
  rationale: "FastAPI match", strengths: [], gaps: [], apply_url: null, pasted: false, ...o,
});
const ctx = { drafts: new Set(["a"]), saved: new Set(["b"]) };

describe("filterJobs", () => {
  const jobs = [
    job({ job_id: "a", company: "Zeta", score: 90, remote: true }),
    job({ job_id: "b", company: "Acme", score: 60, title: "Data Analyst", location: "Remote (EU)" }),
    job({ job_id: "c", company: "Beta", score: 80 }),
  ];
  it("sorts by score then company by default", () => {
    expect(filterJobs(jobs, DEFAULT_FILTERS, ctx).map((j) => j.job_id)).toEqual(["a", "c", "b"]);
  });
  it("can sort by company", () => {
    expect(filterJobs(jobs, { ...DEFAULT_FILTERS, sort: "company" }, ctx).map((j) => j.company)).toEqual(["Acme", "Beta", "Zeta"]);
  });
  it("applies score, remote, draft and saved filters", () => {
    expect(filterJobs(jobs, { ...DEFAULT_FILTERS, minScore: 80 }, ctx)).toHaveLength(2);
    expect(filterJobs(jobs, { ...DEFAULT_FILTERS, remoteOnly: true }, ctx).map((j) => j.job_id)).toEqual(["a"]);
    expect(filterJobs(jobs, { ...DEFAULT_FILTERS, hasDraft: true }, ctx).map((j) => j.job_id)).toEqual(["a"]);
    expect(filterJobs(jobs, { ...DEFAULT_FILTERS, savedOnly: true }, ctx).map((j) => j.job_id)).toEqual(["b"]);
  });
  it("requires every search word to match somewhere", () => {
    expect(filterJobs(jobs, { ...DEFAULT_FILTERS, query: "data eu" }, ctx).map((j) => j.job_id)).toEqual(["b"]);
    expect(filterJobs(jobs, { ...DEFAULT_FILTERS, query: "data zeta" }, ctx)).toEqual([]);
  });
  it("counts active filters but not sort", () => {
    expect(activeFilterCount({ ...DEFAULT_FILTERS, sort: "company" })).toBe(0);
    expect(activeFilterCount({ ...DEFAULT_FILTERS, query: " x ", remoteOnly: true })).toBe(2);
  });
});

describe("validatePaste", () => {
  const long = "We are hiring a backend engineer to build APIs. ".repeat(3);
  it("needs text or a link", () => {
    expect(validatePaste({ url: "", text: "" }).text).toMatch(/paste/i);
  });
  it("accepts text alone, or a https link alone", () => {
    expect(validatePaste({ url: "", text: long })).toEqual({});
    expect(validatePaste({ url: "https://acme.com/jobs/1", text: "" })).toEqual({});
  });
  it("rejects non-https links and too-short text", () => {
    expect(validatePaste({ url: "http://acme.com", text: "" }).url).toMatch(/https/);
    expect(validatePaste({ url: "not a url", text: "" }).url).toBeTruthy();
    expect(validatePaste({ url: "", text: "too short" }).text).toMatch(/too short/);
  });
  it("refuses link-only LinkedIn/Indeed/Naukri but allows them with text", () => {
    expect(validatePaste({ url: "https://www.linkedin.com/jobs/view/1", text: "" }).text).toMatch(/LinkedIn/);
    expect(validatePaste({ url: "https://in.indeed.com/viewjob?jk=1", text: "" }).text).toBeTruthy();
    expect(validatePaste({ url: "https://www.linkedin.com/jobs/view/1", text: long })).toEqual({});
  });
});

const ev = (seq: number, type: RunEvent["type"], o: Partial<RunEvent> = {}): RunEvent => ({
  seq, ts: seq, type, step: "", detail: "", latency_ms: 0, tokens: 0, cost_usd: 0, data: {}, ...o,
});

describe("buildRunSteps", () => {
  const plan = ev(1, "plan", { data: { steps: ["research", "write", "critic"] } });
  it("starts every planned step as pending with 0 progress", () => {
    const { items, progress } = buildRunSteps([ev(0, "run_started"), plan]);
    expect(items.map((i) => i.status)).toEqual(["pending", "pending", "pending"]);
    expect(progress).toBe(0);
  });
  it("tracks running, done (with detail and latency) and progress", () => {
    const { items, progress } = buildRunSteps([
      plan,
      ev(2, "step_started", { step: "research" }),
      ev(3, "step_finished", { step: "research", detail: "6 facts", latency_ms: 1500 }),
      ev(4, "step_started", { step: "write", data: { attempt: 1 } }),
    ]);
    expect(items[0]).toMatchObject({ title: "Researching the company", status: "done", detail: "6 facts", meta: "1.5 s" });
    expect(items[1].status).toBe("running");
    expect(progress).toBe(33);
  });
  it("adds a row for a rewrite attempt right after the previous one", () => {
    const { items } = buildRunSteps([
      plan,
      ev(2, "step_finished", { step: "write", data: { attempt: 1 } }),
      ev(3, "step_finished", { step: "critic", data: { attempt: 1 } }),
      ev(4, "step_started", { step: "write", data: { attempt: 2 } }),
    ]);
    expect(items.map((i) => i.id)).toEqual(["research", "write", "critic", "write#2"]);
    expect(items[3].title).toBe("Writing the draft (attempt 2)");
  });
  it("marks failures and reports why", () => {
    const events = [
      plan,
      ev(2, "step_failed", { step: "research", detail: "Could not reach the page" }),
      ev(3, "run_finished", { data: { status: "failed", error: "x" } }),
    ];
    expect(buildRunSteps(events).items[0].status).toBe("failed");
    expect(runFailure(events)).toBe("Could not reach the page");
    expect(runFailure([plan, ev(5, "run_finished", { data: { status: "completed" } })])).toBeNull();
  });
});

describe("legacy browser-only saves", () => {
  beforeEach(() => localStorage.clear());
  it("reads old saved ids and tracker entries (tracker wins), ignoring corrupt data", async () => {
    const { readLegacySaves, removeLegacy } = await import("@/lib/local/legacy-saves");
    expect(readLegacySaves()).toEqual([]);
    localStorage.setItem("nextrole_saved_jobs", JSON.stringify({ v: 1, ids: ["a", "b"] }));
    localStorage.setItem("nextrole_tracker", JSON.stringify({ v: 1, jobs: [{ id: "b", status: "interview", note: "call Sam" }, { id: "c", status: "bogus" }, { nope: 1 }] }));
    expect(readLegacySaves()).toEqual([
      { job_id: "a", status: "saved", notes: "" },
      { job_id: "b", status: "interview", notes: "call Sam" },
      { job_id: "c", status: "saved", notes: "" },
    ]);
    removeLegacy(["a", "b"]);
    expect(readLegacySaves().map((i) => i.job_id)).toEqual(["c"]);
    removeLegacy(["c"]);
    expect(localStorage.getItem("nextrole_saved_jobs")).toBeNull();
    expect(localStorage.getItem("nextrole_tracker")).toBeNull();
    localStorage.setItem("nextrole_saved_jobs", "{not json");
    expect(readLegacySaves()).toEqual([]);
  });
});
