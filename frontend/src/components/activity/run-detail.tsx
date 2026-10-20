"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, SearchX } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api/client";
import { keys, useRun } from "@/lib/api/queries";
import { useRunEvents } from "@/lib/api/sse";
import { MODE_LABEL, buildTrace, formatCost, formatDuration } from "@/lib/activity/trace";
import { eventsUpTo } from "@/lib/activity/replay";
import { runFailure } from "@/lib/dashboard/run-steps";
import { ReplayControls } from "./replay-controls";
import { RunStatusBadge, formatRunTime } from "./run-status";
import { useReplay } from "./use-replay";
import { Waterfall } from "./waterfall";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="!p-4">
      <dt className="text-caption text-muted">{label}</dt>
      <dd className="mt-1 font-display text-display-lg tabular-nums leading-none">{value}</dd>
    </Card>
  );
}

/**
 * One run in detail: summary numbers, a waterfall with a lane per step (timing, tokens, cost),
 * and, once finished, a replay that re-reveals the steps at their real pace. A run still going
 * is followed live over SSE. Events are plain facts (step names, short details, numbers); no
 * prompts or resume text are ever recorded, so nothing sensitive is shown here.
 */
export function RunDetail({ runId }: { runId: string }) {
  const qc = useQueryClient();
  const run = useRun(runId);
  const running = run.data?.status === "running";
  const live = useRunEvents(running ? runId : null);

  const stored = run.data?.events;
  const events = useMemo(() => (running && live.events.length >= (stored?.length ?? 0) ? live.events : (stored ?? [])), [running, live.events, stored]);
  const replay = useReplay(events);

  const settled = useRef(false);
  useEffect(() => {
    if (!running || !live.finished || settled.current) return;
    settled.current = true;
    void qc.invalidateQueries({ queryKey: keys.run(runId) });
    void qc.invalidateQueries({ queryKey: keys.runs });
  }, [running, live.finished, qc, runId]);

  const back = (
    <Link href="/activity" className="mb-5 inline-flex items-center gap-1.5 text-small font-medium text-muted hover:text-ink">
      <ArrowLeft className="size-4" aria-hidden /> All activity
    </Link>
  );

  if (run.isPending) {
    return <div role="status" aria-label="Loading run">{back}<Skeleton className="mb-6 h-12 w-72" /><Skeleton className="h-80 rounded-card" /></div>;
  }
  if (run.error instanceof ApiError && run.error.status === 404) {
    return (
      <div>
        {back}
        <EmptyState icon={<SearchX />} title="Run not found" description="It may have been removed, or the link is wrong." action={<Button asChild><Link href="/activity">See all activity</Link></Button>} />
      </div>
    );
  }
  if (run.error) return <ErrorState title="Could not load this run" message={run.error.message} onRetry={() => run.refetch()} />;

  const r = run.data;
  const full = buildTrace(events);
  const shownEvents = replay.replaying || replay.playing ? eventsUpTo(events, replay.shown) : events;
  const trace = buildTrace(shownEvents);
  const failure = r.error ?? runFailure(events);
  const active = trace.steps.find((s) => s.status === "running")?.key;
  const doneSteps = trace.steps.filter((s) => s.status === "done").length;

  return (
    <div>
      {back}
      <header className="mb-8">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-small font-medium text-primary">Run</p>
          <RunStatusBadge status={r.status} />
        </div>
        <h1 className="mt-2 font-display text-display text-balance">{MODE_LABEL[r.mode]}</h1>
        <p className="mt-2 text-body text-muted">
          Started {formatRunTime(r.started_at)}
          {r.job_id && r.mode === "outreach" && (
            <> · <Link href={`/jobs/${encodeURIComponent(r.job_id)}/outreach`} className="link-underline text-primary">Open the draft</Link></>
          )}
        </p>
      </header>

      {r.status === "failed" && failure && (
        <div role="alert" className="mb-6 rounded-card border border-danger/25 bg-danger-tint/50 p-4 text-small">
          <p className="font-semibold text-danger-ink">This run did not finish</p>
          <p className="mt-1 text-ink/85">{failure}</p>
        </div>
      )}

      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Duration" value={formatDuration(full.totalMs)} />
        <Stat label="Steps done" value={`${doneSteps}/${trace.steps.length}`} />
        <Stat label="Tokens" value={trace.tokens.toLocaleString()} />
        <Stat label="Estimated cost" value={formatCost(trace.costUsd)} />
      </dl>

      <Card className="mt-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>What the agents did</CardTitle>
            <CardDescription className="mt-1">One lane per step, on a shared time scale. Rewrites get their own lane.</CardDescription>
          </div>
          {running && <p role="status" className="text-small font-medium text-primary">Live: updating as it runs</p>}
        </div>
        {!running && events.length > 0 && <div className="mt-5"><ReplayControls replay={replay} /></div>}
        <div className="mt-6" aria-live={running ? "polite" : "off"}>
          <Waterfall trace={trace} scaleMs={full.totalMs} activeKey={active} />
        </div>
      </Card>
    </div>
  );
}
