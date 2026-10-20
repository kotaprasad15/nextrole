import { Badge } from "@/components/ui/badge";
import type { RunSummary } from "@/lib/api/schemas";

const TONE = { running: "primary", completed: "success", failed: "danger" } as const;
const LABEL = { running: "Running", completed: "Completed", failed: "Failed" } as const;

/** Run status as text plus colour; a running run also pulses (opacity only). */
export function RunStatusBadge({ status }: { status: RunSummary["status"] }) {
  return (
    <Badge tone={TONE[status]}>
      {status === "running" && <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-primary" />}
      {LABEL[status]}
    </Badge>
  );
}

/** Stored run times are UTC "YYYY-MM-DD HH:MM:SS"; show them in the viewer's time zone. */
export function formatRunTime(s: string): string {
  const d = new Date(`${s.replace(" ", "T")}Z`);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
