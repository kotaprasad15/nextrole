"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Display preferences, per browser (Settings page). `motion: "reduced"` can only make the app
 * calmer than the OS setting, never override a user who already asked for reduced motion.
 */
export interface DisplayPrefs {
  /** Show the custom cursor (only ever on fine pointers with motion allowed). */
  cursor: boolean;
  motion: "system" | "reduced";
}

export const DEFAULT_PREFS: DisplayPrefs = { cursor: true, motion: "system" };
const KEY = "nextrole_display";

let cache: { raw: string | null; prefs: DisplayPrefs } = { raw: null, prefs: DEFAULT_PREFS };
const listeners = new Set<() => void>();

function parse(raw: string | null): DisplayPrefs {
  try {
    const p = JSON.parse(raw ?? "null") as { v?: number; cursor?: unknown; motion?: unknown } | null;
    if (p?.v === 1) return { cursor: typeof p.cursor === "boolean" ? p.cursor : DEFAULT_PREFS.cursor, motion: p.motion === "reduced" ? "reduced" : "system" };
  } catch {
    /* corrupt: defaults */
  }
  return DEFAULT_PREFS;
}

function read(): DisplayPrefs {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return cache.prefs;
  }
  if (raw === cache.raw) return cache.prefs; // stable reference for useSyncExternalStore
  cache = { raw, prefs: parse(raw) };
  return cache.prefs;
}

export function setDisplayPrefs(patch: Partial<DisplayPrefs>) {
  const prefs = { ...read(), ...patch };
  const raw = JSON.stringify({ v: 1, ...prefs });
  try {
    localStorage.setItem(KEY, raw);
  } catch {
    /* storage unavailable: applies for this session only */
  }
  cache = { raw, prefs };
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  window.addEventListener("storage", l);
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", l);
  };
}

/** Server and first client render always see the defaults, so hydration matches. */
export function useDisplayPrefs() {
  const prefs = useSyncExternalStore(subscribe, read, () => DEFAULT_PREFS);
  const set = useCallback((patch: Partial<DisplayPrefs>) => setDisplayPrefs(patch), []);
  return { prefs, set };
}
