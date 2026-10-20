"use client";

import { useEffect } from "react";
import { useDisplayPrefs } from "@/lib/local/display-prefs";

/** Mirrors "always reduce motion" onto <html data-motion>, which the global CSS rule keys on. */
export function DisplayPrefsEffect() {
  const { prefs } = useDisplayPrefs();
  useEffect(() => {
    const root = document.documentElement;
    if (prefs.motion === "reduced") root.dataset.motion = "reduced";
    else delete root.dataset.motion;
  }, [prefs.motion]);
  return null;
}
