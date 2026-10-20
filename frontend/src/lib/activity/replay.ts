import type { RunEvent } from "@/lib/api/schemas";

export const REPLAY_SPEEDS = [1, 2, 4] as const;
export type ReplaySpeed = (typeof REPLAY_SPEEDS)[number];

/**
 * How long to wait before revealing events[index] when replaying a finished run. Real gaps are
 * kept in proportion but clamped (a 30 s step should not make the replay sit still for 30 s).
 */
export function replayDelay(events: RunEvent[], index: number, speed: ReplaySpeed = 1, minMs = 160, maxMs = 1400): number {
  if (index <= 0 || index >= events.length) return 0;
  const gap = (events[index].ts - events[index - 1].ts) * 1000;
  return Math.round(Math.min(maxMs, Math.max(minMs, gap)) / speed);
}

/** Events visible after `count` have been revealed. */
export const eventsUpTo = (events: RunEvent[], count: number) => events.slice(0, Math.max(0, Math.min(count, events.length)));
