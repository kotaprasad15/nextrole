"use client";

import { ChevronDown, KanbanSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SAVED_STATUSES } from "@/lib/api/schemas";
import { STATUS_LABEL } from "@/lib/saved/status";
import { useSavedJobs } from "@/lib/saved/use-saved-jobs";

/** Where this application stands. Appears once the job is saved; a real menu, so keyboard-operable. */
export function StatusControl({ jobId }: { jobId: string }) {
  const saved = useSavedJobs();
  const entry = saved.get(jobId);
  if (!entry) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary">
          <KanbanSquare className="size-4" aria-hidden /> Status: {STATUS_LABEL[entry.status]} <ChevronDown className="size-4" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {SAVED_STATUSES.filter((s) => s !== entry.status).map((s) => (
          <DropdownMenuItem key={s} onSelect={() => saved.setStatus(jobId, s)}>Mark as {STATUS_LABEL[s]}</DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
