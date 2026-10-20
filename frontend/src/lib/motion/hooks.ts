"use client";

import { useSyncExternalStore } from "react";
import { useDisplayPrefs } from "@/lib/local/display-prefs";

function subscribeMedia(query: string) {
  return (onChange: () => void) => {
    const mq = window.matchMedia(query);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  };
}

function useMedia(query: string, serverValue = false) {
  return useSyncExternalStore(
    subscribeMedia(query),
    () => window.matchMedia(query).matches,
    () => serverValue,
  );
}

/**
 * True on devices with a precise pointer and hover (mouse / trackpad).
 * Custom cursor, tilt and magnetic effects only run here; touch devices get tap feedback.
 * Defaults to false on the server so no hover effect is ever rendered then hydrated away.
 */
export function useFinePointer() {
  return useMedia("(hover: hover) and (pointer: fine)", false);
}

/**
 * True when the user asks for reduced motion: the OS setting, or the "always reduce" choice in
 * Settings (which can only add calm, never remove the OS preference).
 * Hydration-safe: the server snapshot is always `false`, and the client re-renders with the real
 * value after hydration. (Framer's own hook differs between server and first client render,
 * which caused a hydration mismatch, so we use matchMedia directly.)
 */
export function useReducedMotion() {
  const media = useMedia("(prefers-reduced-motion: reduce)", false);
  const { prefs } = useDisplayPrefs();
  return media || prefs.motion === "reduced";
}

/** The OS-level reduced-motion setting alone (Settings uses it to explain what applies). */
export const useSystemReducedMotion = () => useMedia("(prefers-reduced-motion: reduce)", false);

/** The custom cursor: fine pointer, motion allowed, and not switched off in Settings. */
export function useCustomCursor() {
  const rich = useRichMotion();
  const { prefs } = useDisplayPrefs();
  return rich && prefs.cursor;
}

/** Combined gate for decorative pointer-driven motion. */
export function useRichMotion() {
  const fine = useFinePointer();
  const reduced = useReducedMotion();
  return fine && !reduced;
}
