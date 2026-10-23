"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { toast } from "@/components/ui/toast";
import { ApiError } from "@/lib/api/client";
import { api } from "@/lib/api/endpoints";
import { keys, useSavedList } from "@/lib/api/queries";
import type { SavedJob, SavedStatus } from "@/lib/api/schemas";

const failure = (err: unknown) =>
  toast(err instanceof ApiError ? err.message : "Could not update your saved jobs. Please try again.", { variant: "error" });

/**
 * Saved jobs live on the server (snapshot, status, notes). This hook gives pages the same small API
 * the old browser-only store had (`ids`, `isSaved`, `toggle`) plus the status operations. The server
 * decides what is saved and builds the snapshot from its own record of the job.
 */
export function useSavedJobs() {
  const qc = useQueryClient();
  const list = useSavedList({});
  const invalidate = () => qc.invalidateQueries({ queryKey: keys.saved });

  const byJob = useMemo(() => new Map<string, SavedJob>((list.data ?? []).map((s) => [s.job_id, s])), [list.data]);
  const ids = useMemo<ReadonlySet<string>>(() => new Set(byJob.keys()), [byJob]);

  const save = useMutation({
    mutationFn: ({ jobId, status }: { jobId: string; status?: SavedStatus }) => api.saveJob(jobId, status),
    onSuccess: invalidate,
    onError: failure,
  });
  const unsave = useMutation({ mutationFn: (id: number) => api.unsaveJob(id), onSuccess: invalidate, onError: failure });
  const update = useMutation({
    mutationFn: ({ id, ...body }: { id: number; status?: SavedStatus; notes?: string }) => api.updateSavedJob(id, body),
    onSuccess: invalidate,
    onError: failure,
  });

  return {
    list,
    ids,
    get: (jobId: string) => byJob.get(jobId),
    isSaved: (jobId: string) => byJob.has(jobId),
    toggle: (jobId: string) => {
      const entry = byJob.get(jobId);
      if (entry) unsave.mutate(entry.id);
      else save.mutate({ jobId });
    },
    /** Save (if needed) and set the status in one go. */
    setStatus: (jobId: string, status: SavedStatus) => {
      const entry = byJob.get(jobId);
      if (entry) update.mutate({ id: entry.id, status });
      else save.mutate({ jobId, status });
    },
    save,
    unsave,
    update,
  };
}
