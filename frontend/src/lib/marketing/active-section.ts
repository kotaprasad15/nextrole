"use client";

import { useSyncExternalStore } from "react";
import { HOME_SECTIONS } from "./constants";

/**
 * Which homepage section is currently in view. One writer (`ScrollRing`) and any number of readers
 * (the ring's label, the header's sliding pill). Module-level so a scroll tick never goes through
 * React state of a parent; readers re-render only when the section CHANGES.
 */
let current: string = HOME_SECTIONS.intro;
const listeners = new Set<() => void>();

export function setActiveSection(label: string) {
  if (label === current) return;
  current = label;
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

export const useActiveSection = () => useSyncExternalStore(subscribe, () => current, () => HOME_SECTIONS.intro);
