"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { JobCard, Recommendations, Tier } from "@/lib/api/schemas";
import { TIERS } from "@/lib/tier";

/**
 * Application tracker, kept in this browser only (the backend has no endpoint for it). Each entry
 * stores a SNAPSHOT of the job (title, company, tier, apply link) so it still makes sense after
 * the job leaves the recommendations. Versioned shape; every storage access is guarded.
 */
export const STATUSES = ["saved", "applied", "interview", "offer"] as const;
export type TrackerStatus = (typeof STATUSES)[number];

export const STATUS_LABEL: Record<TrackerStatus, string> = {
  saved: "Saved",
  applied: "Applied",
  interview: "Interview",
  offer: "Offer",
};

export interface TrackedJob {
  id: string;
  title: string;
  company: string;
  tier: Tier | null;
  apply_url: string | null;
  status: TrackerStatus;
  note: string;
  addedAt: string;
  updatedAt: string;
}

const KEY = "nextrole_tracker";
export const MAX_NOTE = 500;
const NONE: readonly TrackedJob[] = [];

let cache: { raw: string | null; jobs: readonly TrackedJob[] } = { raw: null, jobs: NONE };
const listeners = new Set<() => void>();

const isStatus = (s: unknown): s is TrackerStatus => (STATUSES as readonly unknown[]).includes(s);
const isTier = (t: unknown): t is Tier => (TIERS as readonly unknown[]).includes(t);

function valid(x: unknown): TrackedJob | null {
  const j = x as Partial<TrackedJob> | null;
  if (!j || typeof j.id !== "string" || typeof j.title !== "string" || typeof j.company !== "string" || !isStatus(j.status)) return null;
  return {
    id: j.id, title: j.title, company: j.company,
    tier: isTier(j.tier) ? j.tier : null,
    apply_url: typeof j.apply_url === "string" && j.apply_url.startsWith("https://") ? j.apply_url : null,
    status: j.status,
    note: typeof j.note === "string" ? j.note.slice(0, MAX_NOTE) : "",
    addedAt: typeof j.addedAt === "string" ? j.addedAt : new Date(0).toISOString(),
    updatedAt: typeof j.updatedAt === "string" ? j.updatedAt : new Date(0).toISOString(),
  };
}

function read(): readonly TrackedJob[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return cache.jobs;
  }
  if (raw === cache.raw) return cache.jobs;
  let jobs: TrackedJob[] = [];
  try {
    const parsed = JSON.parse(raw ?? "null") as { v?: number; jobs?: unknown } | null;
    if (parsed?.v === 1 && Array.isArray(parsed.jobs)) jobs = parsed.jobs.map(valid).filter((j): j is TrackedJob => j !== null);
  } catch {
    /* corrupt value: start empty */
  }
  cache = { raw, jobs };
  return jobs;
}

function write(jobs: readonly TrackedJob[]) {
  const raw = JSON.stringify({ v: 1, jobs });
  try {
    localStorage.setItem(KEY, raw);
  } catch {
    /* storage unavailable: kept for this session only */
  }
  cache = { raw, jobs };
  listeners.forEach((l) => l());
}

export type JobSnapshot = Pick<TrackedJob, "id" | "title" | "company" | "tier" | "apply_url">;

export const snapshotOf = (job: JobCard, tier: Tier | null): JobSnapshot => ({
  id: job.job_id, title: job.title, company: job.company, tier, apply_url: job.apply_url,
});

/** Add a job, or move it if it is already tracked. */
export function trackJob(snap: JobSnapshot, status: TrackerStatus = "saved") {
  const now = new Date().toISOString();
  const jobs = read();
  const existing = jobs.find((j) => j.id === snap.id);
  if (existing) return moveTracked(snap.id, status);
  write([{ ...snap, status, note: "", addedAt: now, updatedAt: now }, ...jobs]);
}

export function moveTracked(id: string, status: TrackerStatus) {
  const now = new Date().toISOString();
  write(read().map((j) => (j.id === id && j.status !== status ? { ...j, status, updatedAt: now } : j)));
}

export function setTrackedNote(id: string, note: string) {
  write(read().map((j) => (j.id === id ? { ...j, note: note.slice(0, MAX_NOTE) } : j)));
}

export function untrackJob(id: string) {
  write(read().filter((j) => j.id !== id));
}

export const clearTracker = () => write(NONE);

function subscribe(l: () => void) {
  listeners.add(l);
  window.addEventListener("storage", l);
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", l);
  };
}

export function useTracker() {
  const jobs = useSyncExternalStore(subscribe, read, () => NONE);
  const track = useCallback((s: JobSnapshot, st?: TrackerStatus) => trackJob(s, st), []);
  return { jobs, track, move: moveTracked, setNote: setTrackedNote, untrack: untrackJob, get: (id: string) => jobs.find((j) => j.id === id) };
}

export interface BoardItem extends JobSnapshot {
  status: TrackerStatus;
  note: string;
  /** False for a bookmarked job that has not been added to the tracker yet (shows in Saved). */
  tracked: boolean;
  updatedAt: string | null;
  /** The job is still among the current recommendations (so its detail page exists). */
  live: boolean;
}

/**
 * The board: every tracked job, plus bookmarked jobs that are not tracked yet (they sit in
 * "Saved"). Newest activity first within a column.
 */
export function buildBoard(tracked: readonly TrackedJob[], savedIds: ReadonlySet<string>, recs: Recommendations | undefined): Record<TrackerStatus, BoardItem[]> {
  const live = new Map<string, { job: JobCard; tier: Tier }>();
  for (const tier of TIERS) for (const job of recs?.[tier] ?? []) live.set(job.job_id, { job, tier });

  const items: BoardItem[] = tracked.map((t) => ({ ...t, tracked: true, updatedAt: t.updatedAt, live: live.has(t.id) }));
  const have = new Set(tracked.map((t) => t.id));
  for (const id of savedIds) {
    if (have.has(id)) continue;
    const l = live.get(id);
    items.push({
      id, title: l?.job.title ?? "Job no longer in your matches", company: l?.job.company ?? "", tier: l?.tier ?? null,
      apply_url: l?.job.apply_url ?? null, status: "saved", note: "", tracked: false, updatedAt: null, live: !!l,
    });
  }
  const board = Object.fromEntries(STATUSES.map((s) => [s, [] as BoardItem[]])) as Record<TrackerStatus, BoardItem[]>;
  for (const it of items) board[it.status].push(it);
  for (const s of STATUSES) board[s].sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "") || a.title.localeCompare(b.title));
  return board;
}
