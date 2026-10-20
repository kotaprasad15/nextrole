"use client";

import { Check, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";

const STAGES = ["Reading your resume", "Finding your skills and experience", "Building your profile"];

/**
 * Shown while the resume is parsed (the slow step, around 20 s with a real model). The stages
 * advance on a timer purely to show progress; the real call is a single request, so the last
 * stage simply waits until it returns. `role="status"` announces the current stage.
 */
export function ParsingPanel() {
  const [stage, setStage] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setStage((s) => Math.min(s + 1, STAGES.length - 1)), 2200);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="rounded-card border border-border bg-surface p-6 shadow-1" role="status" aria-live="polite">
      <p className="font-display text-h2">Working on your profile</p>
      <p className="mt-1 text-small text-muted">This usually takes a few seconds. Please keep this page open.</p>
      <ol className="mt-5 flex flex-col gap-3">
        {STAGES.map((label, i) => (
          <li key={label} className={cn("flex items-center gap-3 text-body", i > stage && "text-muted")}>
            <span className="grid size-6 place-items-center">
              {i < stage ? (
                <Check className="size-5 text-success-ink" aria-hidden />
              ) : i === stage ? (
                <Loader2 className="size-5 animate-spin text-primary" aria-hidden />
              ) : (
                <span className="size-2 rounded-full bg-border-strong" aria-hidden />
              )}
            </span>
            {label}
            <span className="sr-only">{i < stage ? " (done)" : i === stage ? " (in progress)" : ""}</span>
          </li>
        ))}
      </ol>
      <div className="mt-6 flex flex-col gap-2.5" aria-hidden>
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
      </div>
    </div>
  );
}
