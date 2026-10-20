"use client";

import { Activity } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Segmented } from "@/components/ui/segmented";
import { useRuns } from "@/lib/api/queries";
import type { RunMode } from "@/lib/api/schemas";
import { MODE_LABEL, formatCost, formatDuration, runDurationMs } from "@/lib/activity/trace";
import { RunStatusBadge, formatRunTime } from "./run-status";

type Filter = "all" | RunMode;
const FILTERS: Filter[] = ["all", "recommend", "outreach", "single_job"];

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="!p-4">
      <dt className="text-caption text-muted">{label}</dt>
      <dd className="mt-1 font-display text-display-lg tabular-nums leading-none">{value}</dd>
      {hint && <dd className="mt-1.5 text-caption text-muted">{hint}</dd>}
    </Card>
  );
}

/** Every pipeline run: what ran, how it ended, and what it cost. Opens the step-by-step trace. */
export function ActivityList() {
  const runs = useRuns();
  const [filter, setFilter] = useState<Filter>("all");

  const data = runs.data;
  const stats = useMemo(() => {
    const list = data ?? [];
    const done = list.filter((r) => r.status !== "running");
    const ok = done.filter((r) => r.status === "completed").length;
    return {
      total: list.length,
      success: done.length ? `${Math.round((ok / done.length) * 100)}%` : "n/a",
      tokens: list.reduce((n, r) => n + r.tokens, 0),
      cost: list.reduce((n, r) => n + r.cost_usd, 0),
    };
  }, [data]);

  if (runs.isPending) {
    return <div role="status" aria-label="Loading activity" className="flex flex-col gap-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 rounded-card" />)}</div>;
  }
  if (runs.error) return <ErrorState title="Could not load your activity" message={runs.error.message} onRetry={() => runs.refetch()} />;
  if (data!.length === 0) {
    return (
      <EmptyState
        icon={<Activity />}
        title="No runs yet"
        description="Every search and every draft is a run. You will see each step the agents took here, with timing and cost."
        action={<Button asChild><Link href="/dashboard">Find matches</Link></Button>}
      />
    );
  }

  const count = (f: Filter) => (f === "all" ? data!.length : data!.filter((r) => r.mode === f).length);
  const rows = filter === "all" ? data! : data!.filter((r) => r.mode === filter);

  return (
    <div className="flex flex-col gap-8">
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Runs" value={String(stats.total)} />
        <Stat label="Finished successfully" value={stats.success} />
        <Stat label="Tokens used" value={stats.tokens.toLocaleString()} />
        <Stat label="Estimated cost" value={formatCost(stats.cost)} hint="Based on your configured prices" />
      </dl>

      <div className="flex flex-col gap-5">
        <Segmented
          label="Filter runs by type"
          value={filter}
          onValueChange={setFilter}
          options={FILTERS.map((f) => ({ value: f, label: <>{f === "all" ? "All" : MODE_LABEL[f]} <span className="tabular-nums text-muted">({count(f)})</span></> }))}
        />

        {rows.length === 0 ? (
          <p role="status" className="text-small text-muted">No runs of this type yet.</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {rows.map((r) => {
              const dur = runDurationMs(r);
              return (
                <li key={r.id}>
                  <Card interactive className="!p-5">
                    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-h3 font-semibold tracking-tight">
                            <Link href={`/activity/${encodeURIComponent(r.id)}`} className="after:absolute after:inset-0 after:content-['']">{MODE_LABEL[r.mode]}</Link>
                          </h2>
                          <RunStatusBadge status={r.status} />
                        </div>
                        <p className="mt-1 text-small text-muted">Started {formatRunTime(r.started_at)}</p>
                        {r.error && <p className="mt-1.5 line-clamp-2 max-w-2xl text-small text-danger-ink">{r.error}</p>}
                      </div>
                      <dl className="flex gap-6 text-small tabular-nums">
                        <div><dt className="text-caption text-muted">Duration</dt><dd>{dur === null ? "n/a" : formatDuration(dur)}</dd></div>
                        <div><dt className="text-caption text-muted">Tokens</dt><dd>{r.tokens.toLocaleString()}</dd></div>
                        <div><dt className="text-caption text-muted">Cost</dt><dd>{formatCost(r.cost_usd)}</dd></div>
                      </dl>
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
