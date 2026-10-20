import { beforeEach, describe, expect, it } from "vitest";
import type { JobCard, Recommendations } from "@/lib/api/schemas";
import { cleanProfile, errorTab, isDirty, validateProfile } from "@/lib/profile-form";
import type { Profile } from "@/lib/api/schemas";
import { buildBoard, moveTracked, setTrackedNote, snapshotOf, trackJob, untrackJob, type TrackedJob } from "./tracker";

const KEY = "nextrole_tracker";
const stored = (): TrackedJob[] => JSON.parse(localStorage.getItem(KEY)!).jobs;
const card = (id: string, o: Partial<JobCard> = {}): JobCard => ({
  job_id: id, title: `Job ${id}`, company: "Acme", location: "", remote: false, score: 70, rationale: "", strengths: [], gaps: [],
  apply_url: "https://acme.com/apply", pasted: false, ...o,
});

describe("tracker store", () => {
  beforeEach(() => localStorage.clear());

  it("tracks a job with a snapshot, in the saved column by default", () => {
    trackJob(snapshotOf(card("a"), "startup"));
    expect(stored()).toHaveLength(1);
    expect(stored()[0]).toMatchObject({ id: "a", title: "Job a", company: "Acme", tier: "startup", status: "saved", note: "" });
  });
  it("moves a job between statuses, and re-tracking an existing job moves it", () => {
    trackJob(snapshotOf(card("a"), "mid"));
    moveTracked("a", "applied");
    expect(stored()[0].status).toBe("applied");
    trackJob(snapshotOf(card("a"), "mid"), "interview");
    expect(stored()).toHaveLength(1);
    expect(stored()[0].status).toBe("interview");
  });
  it("saves notes (capped) and removes jobs", () => {
    trackJob(snapshotOf(card("a"), null));
    setTrackedNote("a", "x".repeat(900));
    expect(stored()[0].note).toHaveLength(500);
    untrackJob("a");
    expect(stored()).toEqual([]);
  });
  it("drops malformed entries and unsafe links when loading", () => {
    localStorage.setItem(KEY, JSON.stringify({ v: 1, jobs: [
      { id: "ok", title: "T", company: "C", status: "offer", apply_url: "javascript:alert(1)" },
      { id: "bad-status", title: "T", company: "C", status: "nope" },
      "garbage",
    ] }));
    trackJob(snapshotOf(card("b"), null));
    const ids = stored().map((j) => j.id);
    expect(ids).toEqual(["b", "ok"]);
    expect(stored().find((j) => j.id === "ok")!.apply_url).toBeNull();
  });
  it("survives corrupt storage", () => {
    localStorage.setItem(KEY, "{nope");
    expect(() => trackJob(snapshotOf(card("a"), null))).not.toThrow();
  });
});

describe("buildBoard", () => {
  const recs: Recommendations = { startup: [card("s1", { score: 90 })], mid: [card("m1")], mnc: [] };
  const tracked: TrackedJob[] = [
    { id: "m1", title: "Job m1", company: "Acme", tier: "mid", apply_url: null, status: "applied", note: "n", addedAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-02T00:00:00Z" },
    { id: "gone", title: "Old job", company: "Zed", tier: null, apply_url: null, status: "offer", note: "", addedAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-02T00:00:00Z" },
  ];
  it("puts bookmarked but untracked jobs in Saved, and tracked jobs in their column", () => {
    const b = buildBoard(tracked, new Set(["s1", "m1"]), recs);
    expect(b.saved.map((i) => [i.id, i.tracked, i.tier])).toEqual([["s1", false, "startup"]]);
    expect(b.applied.map((i) => i.id)).toEqual(["m1"]); // a tracked job is not duplicated by its bookmark
    expect(b.offer[0]).toMatchObject({ id: "gone", live: false, title: "Old job" });
    expect(b.interview).toEqual([]);
  });
  it("labels a bookmarked job that has left the matches", () => {
    const b = buildBoard([], new Set(["zzz"]), recs);
    expect(b.saved[0]).toMatchObject({ id: "zzz", live: false, title: "Job no longer in your matches" });
  });
  it("orders newest activity first", () => {
    const t = (id: string, at: string): TrackedJob => ({ ...tracked[0], id, title: id, status: "applied", updatedAt: at });
    expect(buildBoard([t("old", "2026-01-01T00:00:00Z"), t("new", "2026-02-01T00:00:00Z")], new Set(), recs).applied.map((i) => i.id)).toEqual(["new", "old"]);
  });
});

const profile = (o: Partial<Profile> = {}): Profile => ({
  name: "Priya", summary: "", skills: [], experience: [], projects: [], education: [],
  preferences: { roles: ["SWE"], locations: [], remote_ok: true, experience_level: "Mid", extras: "" }, ...o,
});

describe("profile form rules", () => {
  it("requires a name, and company+title on each experience", () => {
    const errs = validateProfile(profile({ name: " ", experience: [{ company: "", title: "", start: "", end: "", bullets: [] }] }));
    expect(errs.name).toBeTruthy();
    expect(errs["experience.0.company"]).toBeTruthy();
    expect(errs["experience.0.title"]).toBeTruthy();
    expect(validateProfile(profile())).toEqual({});
  });
  it("needs a role, and a location unless remote is allowed", () => {
    const base = profile().preferences;
    expect(validateProfile(profile({ preferences: { ...base, roles: [] } })).roles).toBeTruthy();
    expect(validateProfile(profile({ preferences: { ...base, remote_ok: false } })).locations).toBeTruthy();
  });
  it("points at the tab that holds the error", () => {
    expect(errorTab({ name: "x" })).toBe("profile");
    expect(errorTab({ roles: "x" })).toBe("preferences");
    expect(errorTab({})).toBeNull();
  });
  it("cleans blanks and detects changes", () => {
    const p = profile({ skills: [" Python ", ""], experience: [{ company: " A ", title: "T", start: "", end: "", bullets: ["", " did x "] }] });
    const c = cleanProfile(p);
    expect(c.skills).toEqual(["Python"]);
    expect(c.experience[0]).toMatchObject({ company: "A", bullets: ["did x"] });
    expect(isDirty(p, p)).toBe(false);
    expect(isDirty({ ...p, name: "Other" }, p)).toBe(true);
  });
});
