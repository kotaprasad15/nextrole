"use client";

import { useSyncExternalStore } from "react";

/**
 * Draft version history, kept in this browser only (the backend stores just the latest draft).
 * A snapshot is recorded whenever the draft we load differs from the newest one saved here:
 * "generated" when the Critic has reviewed it, "edited" when the user changed it (the server
 * clears the review on every edit). Versioned shape, guarded storage, capped per job.
 */
export interface DraftVersion {
  id: string;
  at: string;
  subject: string;
  body: string;
  source: "generated" | "edited";
  /** Critic overall score at the time, if reviewed. */
  score: number | null;
}

const KEY = "nextrole_draft_versions";
export const MAX_VERSIONS = 20;
const NONE: readonly DraftVersion[] = [];

type Store = Record<string, DraftVersion[]>;
let cache: { raw: string | null; data: Store } = { raw: null, data: {} };
const listeners = new Set<() => void>();

function load(): Store {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return cache.data;
  }
  if (raw === cache.raw) return cache.data;
  let data: Store = {};
  try {
    const parsed = JSON.parse(raw ?? "null") as { v?: number; byJob?: Store } | null;
    if (parsed?.v === 1 && parsed.byJob && typeof parsed.byJob === "object") data = parsed.byJob;
  } catch {
    /* corrupt: start over */
  }
  cache = { raw, data };
  return data;
}

function save(data: Store) {
  const raw = JSON.stringify({ v: 1, byJob: data });
  try {
    localStorage.setItem(KEY, raw);
  } catch {
    /* storage unavailable: history lasts for this session only */
  }
  cache = { raw, data };
  listeners.forEach((l) => l());
}

/** Newest first. */
export function versionsFor(jobId: string): readonly DraftVersion[] {
  return load()[jobId] ?? NONE;
}

/** Add a snapshot unless it matches the newest one. Returns true if added. */
export function recordVersion(jobId: string, v: Pick<DraftVersion, "subject" | "body" | "source" | "score">): boolean {
  const list = versionsFor(jobId);
  if (list[0] && list[0].subject === v.subject && list[0].body === v.body) return false;
  const entry: DraftVersion = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, at: new Date().toISOString(), ...v };
  save({ ...load(), [jobId]: [entry, ...list].slice(0, MAX_VERSIONS) });
  return true;
}

export function clearVersions(jobId: string) {
  const { [jobId]: _dropped, ...rest } = load();
  void _dropped;
  save(rest);
}

export const clearAllVersions = () => save({});

function subscribe(l: () => void) {
  listeners.add(l);
  window.addEventListener("storage", l);
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", l);
  };
}

export function useDraftVersions(jobId: string): readonly DraftVersion[] {
  return useSyncExternalStore(subscribe, () => versionsFor(jobId), () => NONE);
}
