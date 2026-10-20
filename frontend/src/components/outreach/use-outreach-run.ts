"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "@/components/ui/toast";
import { ApiError } from "@/lib/api/client";
import { api } from "@/lib/api/endpoints";
import { keys } from "@/lib/api/queries";
import { useRunEvents } from "@/lib/api/sse";
import { runFailure } from "@/lib/dashboard/run-steps";

/**
 * Start the outreach pipeline for one job and follow it live. When the run ends, the draft and
 * the drafts list are refetched once. `error` holds a start failure (e.g. a run already active).
 */
export function useOutreachRun(jobId: string) {
  const qc = useQueryClient();
  const [runId, setRunId] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const stream = useRunEvents(runId);
  const settled = useRef<string | null>(null);

  const start = useMutation({
    mutationFn: (v: { channel: "email" | "message"; recipient_name?: string }) => api.startRun({ mode: "outreach", job_id: jobId, ...v }),
    onSuccess: (res) => {
      setRunId(res.run_id);
      setDismissed(false);
    },
  });

  useEffect(() => {
    if (!stream.finished || !runId || settled.current === runId) return;
    settled.current = runId;
    void qc.invalidateQueries({ queryKey: keys.outreachByJob(jobId) });
    void qc.invalidateQueries({ queryKey: keys.outreach });
    void qc.invalidateQueries({ queryKey: keys.runs });
    const failure = runFailure(stream.events);
    if (failure) toast("The draft did not finish", { variant: "error", description: failure });
    else toast("Your draft is ready", { variant: "success" });
  }, [stream.finished, stream.events, runId, jobId, qc]);

  const active = runId !== null && !dismissed;
  return {
    start: start.mutate,
    starting: start.isPending,
    error: start.error ? (start.error instanceof ApiError ? start.error.message : "Could not start. Please try again.") : undefined,
    active,
    busy: active && !stream.finished,
    events: stream.events,
    status: stream.status,
    dismiss: () => setDismissed(true),
  };
}

export type OutreachRun = ReturnType<typeof useOutreachRun>;
