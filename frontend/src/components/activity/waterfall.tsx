import { cn } from "@/lib/cn";
import { formatCost, formatDuration, type StepStatus, type Trace } from "@/lib/activity/trace";

const BAR: Record<StepStatus, string> = {
  done: "bg-primary",
  failed: "bg-danger",
  running: "bg-primary/60 animate-pulse",
  pending: "border border-dashed border-border-strong",
};
const STATUS_TEXT: Record<StepStatus, string> = { done: "done", failed: "failed", running: "running", pending: "waiting" };

/**
 * Waterfall of a run: one lane per step, positioned by when it started and sized by how long it
 * took, all on the SAME time scale (`scaleMs`, the whole run's length, so replay does not rescale).
 * Each lane also states its status, duration and spend in text; the bars are decoration.
 */
export function Waterfall({ trace, scaleMs, activeKey }: { trace: Trace; scaleMs: number; activeKey?: string }) {
  const scale = Math.max(scaleMs, 1);
  const pct = (ms: number) => `${Math.min(100, Math.max(0, (ms / scale) * 100))}%`;

  if (trace.steps.length === 0) return <p className="text-small text-muted">No steps recorded.</p>;

  return (
    <div>
      <ol className="flex flex-col gap-4">
        {trace.steps.map((s) => (
          <li key={s.key} aria-current={activeKey === s.key ? "step" : undefined} className={cn("rounded-control p-2 -m-2 transition-colors", activeKey === s.key && "bg-primary-tint/60")}>
            <div className="grid gap-x-4 gap-y-1.5 md:grid-cols-[13rem_minmax(0,1fr)_9rem] md:items-center">
              <div className="min-w-0">
                <p className="text-small font-semibold">
                  {s.label}
                  <span className="sr-only"> ({STATUS_TEXT[s.status]})</span>
                </p>
                {s.detail && <p className={cn("mt-0.5 text-caption", s.status === "failed" ? "text-danger-ink" : "text-muted")}>{s.detail}</p>}
              </div>
              <div aria-hidden className="relative h-3 rounded-full bg-ink/[0.05]">
                {s.status !== "pending" && (
                  <span
                    className={cn("absolute top-0 h-3 rounded-full", BAR[s.status])}
                    style={{ left: pct(s.startMs), width: `max(${pct(s.durationMs)}, 6px)` }}
                  />
                )}
              </div>
              <p className="text-caption tabular-nums text-muted md:text-right">
                {s.status === "pending" ? "waiting" : s.status === "running" ? "running..." : formatDuration(s.durationMs)}
                {s.status === "done" && (s.tokens > 0 || s.costUsd > 0) && (
                  <span className="block">{s.tokens.toLocaleString()} tok · {formatCost(s.costUsd)}</span>
                )}
              </p>
            </div>
          </li>
        ))}
      </ol>
      <div aria-hidden className="mt-4 flex justify-between border-t border-border pt-2 text-caption tabular-nums text-muted md:ml-[13.25rem] md:mr-[9.25rem]">
        <span>0 s</span>
        <span>{formatDuration(scale / 2)}</span>
        <span>{formatDuration(scale)}</span>
      </div>
    </div>
  );
}
