"use client";

import { useSyncExternalStore } from "react";

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
 * True when the user asks for reduced motion (OS setting).
 * Hydration-safe: the server snapshot is always `false`, and the client re-renders with the real
 * value after hydration. (Framer's own hook differs between server and first client render,
 * which caused a hydration mismatch, so we use matchMedia directly.)
 */
export function useReducedMotion() {
  return useMedia("(prefers-reduced-motion: reduce)", false);
}

/** Combined gate for decorative pointer-driven motion. */
export function useRichMotion() {
  const fine = useFinePointer();
  const reduced = useReducedMotion();
  return fine && !reduced;
}
