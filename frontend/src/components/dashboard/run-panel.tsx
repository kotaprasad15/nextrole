"use client";

import { CheckCircle2, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Timeline } from "@/components/ui/timeline";
import type { RunEvent, RunMode } from "@/lib/api/schemas";
import type { StreamStatus } from "@/lib/api/sse";
import { buildRunSteps, runFailure } from "@/lib/dashboard/run-steps";

const TITLES: Record<RunMode, string> = {
  recommend: "Finding your matches",
  outreach: "Drafting your outreach",
  single_job: "Adding your job",
};

/**
 * Live feed of an agent run. The list is `aria-live="polite"` so progress is announced without
 * stealing focus; colour is never the only signal (each step also carries a text status).
 */
export function RunPanel({
  mode,
  events,
  status,
  onDismiss,
}: {
  mode: RunMode;
  events: RunEvent[];
  status: StreamStatus;
  onDismiss: () => void;
}) {
  const { items, progress } = buildRunSteps(events);
  const finished = events.find((e) => e.type === "run_finished");
  const failure = runFailure(events);
  const succeeded = finished && !failure;
  const connecting = !finished && items.length === 0;

  return (
    <Card className="border-primary/25">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-h3 font-semibold tracking-tight">
            {succeeded && <CheckCircle2 className="size-5 text-success-ink" aria-hidden />}
            {failure && <TriangleAlert className="size-5 text-danger-ink" aria-hidden />}
            {succeeded ? "All done" : failure ? "That did not finish" : TITLES[mode]}
          </h2>
          <p className="mt-1 text-small text-muted">
            {succeeded
              ? "Your results are updated below."
              : failure
                ? failure
                : status === "error"
                  ? "Lost the live connection. Progress will appear here again when it reconnects."
                  : "You can keep browsing while this runs."}
          </p>
        </div>
        {finished && (
          <Button variant="ghost" size="icon" onClick={onDismiss} aria-label="Dismiss run details">
            <X className="size-5" aria-hidden />
          </Button>
        )}
      </div>

      {!failure && <Progress className="mt-4" value={succeeded ? 100 : progress} label="Run progress" />}

      <div className="mt-5" aria-live="polite">
        {connecting ? <p className="text-small text-muted">Starting up...</p> : <Timeline items={items} />}
      </div>

      {finished && (
        <p className="mt-4 text-caption text-muted tabular-nums">
          {finished.tokens.toLocaleString()} tokens used{finished.cost_usd > 0 ? `, about $${finished.cost_usd.toFixed(3)}` : ""}.
        </p>
      )}
    </Card>
  );
}
