"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Saved jobs live in this browser only (the backend has no endpoint for them). Versioned so the
 * shape can change later; every storage access is guarded because storage can be blocked or full.
 */
const KEY = "nextrole_saved_jobs";
const EMPTY: ReadonlySet<string> = new Set();

let cache: { raw: string | null; ids: ReadonlySet<string> } = { raw: null, ids: EMPTY };
const listeners = new Set<() => void>();

function read(): ReadonlySet<string> {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return cache.ids;
  }
  if (raw === cache.raw) return cache.ids; // stable reference: useSyncExternalStore needs it
  let ids: ReadonlySet<string> = EMPTY;
  try {
    const parsed = JSON.parse(raw ?? "null") as { v?: number; ids?: unknown } | null;
    if (parsed?.v === 1 && Array.isArray(parsed.ids)) ids = new Set(parsed.ids.filter((x): x is string => typeof x === "string"));
  } catch {
    /* corrupt value: treat as empty */
  }
  cache = { raw, ids };
  return ids;
}

function write(ids: ReadonlySet<string>) {
  const raw = JSON.stringify({ v: 1, ids: [...ids] });
  try {
    localStorage.setItem(KEY, raw);
  } catch {
    // Storage unavailable: keep the choice for this session only.
  }
  cache = { raw, ids };
  listeners.forEach((l) => l());
}

export function toggleSavedJob(id: string) {
  const next = new Set(read());
  if (!next.delete(id)) next.add(id);
  write(next);
}

export const clearSavedJobs = () => write(EMPTY);

function subscribe(l: () => void) {
  listeners.add(l);
  window.addEventListener("storage", l);
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", l);
  };
}

/** Server snapshot is always empty, so server and first client render match. */
export function useSavedJobs() {
  const ids = useSyncExternalStore(subscribe, read, () => EMPTY);
  const toggle = useCallback((id: string) => toggleSavedJob(id), []);
  return { ids, isSaved: (id: string) => ids.has(id), toggle };
}
