"use client";

import { useEffect, useState } from "react";
import { replayDelay, type ReplaySpeed } from "@/lib/activity/replay";
import type { RunEvent } from "@/lib/api/schemas";

/**
 * Replay a finished run: reveal its events one by one at (clamped) real pace. `count === null`
 * means "show the whole run", which stays correct if the event list grows. The user starts it,
 * so it never autoplays (and never animates for people who did not ask for it).
 */
export function useReplay(events: RunEvent[]) {
  const total = events.length;
  const [count, setCount] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<ReplaySpeed>(1);
  const shown = count ?? total;

  useEffect(() => {
    if (!playing) return;
    if (shown >= total) {
      const t = setTimeout(() => setPlaying(false), 0);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setCount(shown + 1), replayDelay(events, shown, speed));
    return () => clearTimeout(t);
  }, [playing, shown, total, events, speed]);

  return {
    shown,
    total,
    playing,
    speed,
    /** True while the user is stepping through (not showing the full run). */
    replaying: count !== null && count < total,
    play() {
      if (shown >= total) setCount(1);
      setPlaying(true);
    },
    pause: () => setPlaying(false),
    restart() {
      setCount(1);
      setPlaying(true);
    },
    seek(n: number) {
      setPlaying(false);
      setCount(Math.max(0, Math.min(n, total)));
    },
    showAll() {
      setPlaying(false);
      setCount(null);
    },
    setSpeed,
  };
}

export type Replay = ReturnType<typeof useReplay>;
