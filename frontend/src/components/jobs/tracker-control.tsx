"use client";

import { ChevronDown, KanbanSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { STATUSES, STATUS_LABEL, snapshotOf, useTracker } from "@/lib/local/tracker";
import type { JobCard, Tier } from "@/lib/api/schemas";

/** Add a job to the (local) application tracker, or move it along. A real menu: keyboard-operable. */
export function TrackerControl({ job, tier }: { job: JobCard; tier: Tier }) {
  const tracker = useTracker();
  const tracked = tracker.get(job.job_id);

  if (!tracked) {
    return (
      <Button variant="ghost" onClick={() => tracker.track(snapshotOf(job, tier), "saved")}>
        <KanbanSquare className="size-4" aria-hidden /> Add to tracker
      </Button>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary">
          <KanbanSquare className="size-4" aria-hidden /> Tracker: {STATUS_LABEL[tracked.status]} <ChevronDown className="size-4" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {STATUSES.filter((s) => s !== tracked.status).map((s) => (
          <DropdownMenuItem key={s} onSelect={() => tracker.move(job.job_id, s)}>Move to {STATUS_LABEL[s]}</DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => tracker.untrack(job.job_id)} className="text-danger-ink">Remove from tracker</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
