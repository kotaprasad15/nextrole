import type { RunEvent, RunMode } from "@/lib/api/schemas";
import { stepLabel } from "@/lib/dashboard/run-steps";

export const MODE_LABEL: Record<RunMode, string> = {
  recommend: "Find matches",
  outreach: "Write outreach",
  single_job: "Pasted job",
};

export type StepStatus = "done" | "failed" | "running" | "pending";

export interface TraceStep {
  key: string;
  step: string;
  label: string;
  attempt: number;
  status: StepStatus;
  /** Milliseconds from the start of the run. */
  startMs: number;
  durationMs: number;
  detail: string;
  /** Tokens and cost spent by THIS step (events carry run-cumulative totals). */
  tokens: number;
  costUsd: number;
}

export interface Trace {
  steps: TraceStep[];
  totalMs: number;
  tokens: number;
  costUsd: number;
  outcome: "running" | "completed" | "failed";
}

const attemptOf = (e: RunEvent) => Number((e.data as { attempt?: number }).attempt ?? 1) || 1;

/**
 * Turn a run's event stream into a waterfall: one row per step (and per rewrite attempt) with
 * when it started, how long it took and what it spent. Works for partial streams (live runs and
 * replay), where unfinished steps are "running" and not-yet-reached planned steps are "pending".
 */
export function buildTrace(events: RunEvent[]): Trace {
  const t0 = events[0]?.ts ?? 0;
  const finishedEvent = events.find((e) => e.type === "run_finished");
  const rows: (TraceStep & { startTs: number })[] = [];
  const find = (key: string) => rows.findIndex((r) => r.key === key);

  const planned = (events.find((e) => e.type === "plan")?.data.steps as string[] | undefined) ?? [];
  if (!finishedEvent) for (const s of planned) rows.push(blank(s, 1, `${s}`, t0));

  let lastKey = "";
  let prevTokens = 0;
  let prevCost = 0;
  for (const e of events) {
    if (e.type !== "step_started" && e.type !== "step_finished" && e.type !== "step_failed") continue;
    const attempt = attemptOf(e);
    const key = attempt > 1 ? `${e.step}#${attempt}` : e.step;
    let i = find(key);
    if (i === -1) {
      const at = lastKey && find(lastKey) !== -1 ? find(lastKey) + 1 : rows.length;
      rows.splice(at, 0, blank(e.step, attempt, key, t0));
      i = at;
    }
    const row = rows[i];
    lastKey = key;
    if (e.type === "step_started") {
      row.status = "running";
      row.startTs = e.ts;
      row.startMs = (e.ts - t0) * 1000;
    } else {
      const ok = e.type === "step_finished";
      row.status = ok ? "done" : "failed";
      row.detail = e.detail;
      row.durationMs = e.latency_ms || Math.max(0, (e.ts - row.startTs) * 1000);
      if (row.startTs === t0 && row.startMs === 0 && e.ts > t0) row.startMs = Math.max(0, (e.ts - t0) * 1000 - row.durationMs);
      row.tokens = Math.max(0, e.tokens - prevTokens);
      row.costUsd = Math.max(0, e.cost_usd - prevCost);
      prevTokens = e.tokens;
      prevCost = e.cost_usd;
    }
  }

  const last = events[events.length - 1];
  for (const r of rows) if (r.status === "running" && last) r.durationMs = Math.max(0, (last.ts - r.startTs) * 1000);

  const visible = rows.filter((r) => r.status !== "pending" || !finishedEvent);
  const endOfSteps = Math.max(0, ...visible.filter((r) => r.status !== "pending").map((r) => r.startMs + r.durationMs));
  const totalMs = finishedEvent ? Math.max((finishedEvent.ts - t0) * 1000, endOfSteps) : Math.max(endOfSteps, last ? (last.ts - t0) * 1000 : 0);
  const outcome = !finishedEvent ? "running" : (finishedEvent.data as { status?: string }).status === "failed" ? "failed" : "completed";

  return {
    steps: visible.map((r) => ({ key: r.key, step: r.step, label: r.attempt > 1 ? `${stepLabel(r.step)} (attempt ${r.attempt})` : stepLabel(r.step), attempt: r.attempt, status: r.status, startMs: r.startMs, durationMs: r.durationMs, detail: r.detail, tokens: r.tokens, costUsd: r.costUsd })),
    totalMs,
    tokens: Math.max(prevTokens, finishedEvent?.tokens ?? 0),
    costUsd: Math.max(prevCost, finishedEvent?.cost_usd ?? 0),
    outcome,
  };
}

function blank(step: string, attempt: number, key: string, t0: number): TraceStep & { startTs: number } {
  return { key, step, label: "", attempt, status: "pending", startMs: 0, durationMs: 0, detail: "", tokens: 0, costUsd: 0, startTs: t0 };
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  const m = Math.floor(s / 60);
  return `${m} min ${Math.round(s - m * 60)} s`;
}

export function formatCost(usd: number): string {
  if (usd === 0) return "$0";
  return usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`;
}

/** How long a run took, from its events if available, else from the stored timestamps (UTC). */
export function runDurationMs(run: { started_at: string; finished_at: string | null }): number | null {
  if (!run.finished_at) return null;
  const parse = (s: string) => Date.parse(`${s.replace(" ", "T")}Z`);
  const d = parse(run.finished_at) - parse(run.started_at);
  return Number.isFinite(d) && d >= 0 ? d : null;
}
