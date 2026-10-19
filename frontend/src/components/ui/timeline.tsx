import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type TimelineStatus = "done" | "running" | "failed" | "pending";

export interface TimelineItem {
  id: string;
  title: string;
  detail?: ReactNode;
  status: TimelineStatus;
  /** Right-aligned meta, e.g. "2.4s" or "1,204 tokens". */
  meta?: ReactNode;
}

const DOT: Record<TimelineStatus, string> = {
  done: "bg-success",
  running: "bg-primary animate-pulse",
  failed: "bg-danger",
  pending: "bg-border-strong",
};

const LABEL: Record<TimelineStatus, string> = {
  done: "completed",
  running: "in progress",
  failed: "failed",
  pending: "waiting",
};

/** Vertical step list used for live and past agent runs. Status is conveyed by text too. */
export function Timeline({ items, className }: { items: TimelineItem[]; className?: string }) {
  return (
    <ol className={cn("flex flex-col", className)}>
      {items.map((it, i) => (
        <li key={it.id} className="relative flex gap-4 pb-5 last:pb-0">
          {i < items.length - 1 && (
            <span aria-hidden className="absolute left-[5px] top-4 h-[calc(100%-0.5rem)] w-px bg-border" />
          )}
          <span aria-hidden className={cn("relative mt-1.5 size-[11px] shrink-0 rounded-full", DOT[it.status])} />
          <div className="flex min-w-0 flex-1 items-baseline justify-between gap-4">
            <div className="min-w-0">
              <p className="text-small font-semibold">
                {it.title}
                <span className="sr-only"> ({LABEL[it.status]})</span>
              </p>
              {it.detail && <p className={cn("mt-0.5 text-small", it.status === "failed" ? "text-danger" : "text-muted")}>{it.detail}</p>}
            </div>
            {it.meta && <span className="shrink-0 text-caption tabular-nums text-muted">{it.meta}</span>}
          </div>
        </li>
      ))}
    </ol>
  );
}
