import type { TimelineItem, TimelineStatus } from "@/components/ui/timeline";
import type { RunEvent } from "@/lib/api/schemas";

/** Plain-language names for the orchestrator's step ids. Unknown ids fall back to the raw id. */
export const STEP_LABELS: Record<string, string> = {
  discover: "Finding openings",
  tier: "Sorting companies by size",
  select: "Picking the best candidates",
  match: "Scoring against your profile",
  save: "Saving results",
  ingest: "Reading the posting",
  pin: "Adding to your dashboard",
  research: "Researching the company",
  facts: "Collecting facts you can cite",
  write: "Writing the draft",
  critic: "Reviewing the draft",
};

export const stepLabel = (step: string) => STEP_LABELS[step] ?? step;

interface Row {
  key: string;
  step: string;
  attempt: number;
  status: TimelineStatus;
  detail?: string;
  latency_ms?: number;
}

export function formatLatency(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/**
 * Fold the event stream into one row per step (and per rewrite attempt). Rows start as the
 * planned steps (pending); events then move them to running, done or failed. A repeated
 * write/critic attempt gets its own row, inserted after the one before it.
 */
export function buildRunSteps(events: RunEvent[]): { items: TimelineItem[]; progress: number } {
  const rows: Row[] = [];
  const find = (key: string) => rows.findIndex((r) => r.key === key);
  const plan = events.find((e) => e.type === "plan");
  for (const s of (plan?.data.steps as string[] | undefined) ?? []) rows.push({ key: s, step: s, attempt: 1, status: "pending" });

  let lastKey = "";
  for (const e of events) {
    if (e.type !== "step_started" && e.type !== "step_finished" && e.type !== "step_failed") continue;
    const attempt = Number((e.data as { attempt?: number }).attempt ?? 1) || 1;
    const key = attempt > 1 ? `${e.step}#${attempt}` : e.step;
    let i = find(key);
    if (i === -1) {
      const at = lastKey ? find(lastKey) + 1 : rows.length;
      rows.splice(at, 0, { key, step: e.step, attempt, status: "pending" });
      i = at;
    }
    const row = rows[i];
    lastKey = key;
    if (e.type === "step_started") row.status = "running";
    else {
      row.status = e.type === "step_finished" ? "done" : "failed";
      row.detail = e.detail || undefined;
      row.latency_ms = e.latency_ms || undefined;
    }
  }

  const items: TimelineItem[] = rows.map((r) => ({
    id: r.key,
    title: r.attempt > 1 ? `${stepLabel(r.step)} (attempt ${r.attempt})` : stepLabel(r.step),
    status: r.status,
    detail: r.detail,
    meta: r.latency_ms ? formatLatency(r.latency_ms) : undefined,
  }));
  const done = rows.filter((r) => r.status === "done").length;
  return { items, progress: rows.length ? Math.round((done / rows.length) * 100) : 0 };
}

/** Why a run failed, in the user's words: the failed step's detail, else the finish event's error. */
export function runFailure(events: RunEvent[]): string | null {
  const finished = events.find((e) => e.type === "run_finished");
  if (!finished || (finished.data as { status?: string }).status !== "failed") return null;
  const failed = events.find((e) => e.type === "step_failed");
  return failed?.detail || ((finished.data as { error?: string | null }).error ?? "The run did not finish.");
}
