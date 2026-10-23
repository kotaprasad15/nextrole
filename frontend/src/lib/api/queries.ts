"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./endpoints";

/** Query keys in one place so invalidation is consistent. */
export const keys = {
  me: ["me"] as const,
  profile: ["profile"] as const,
  recommendations: ["recommendations"] as const,
  outreach: ["outreach"] as const,
  outreachByJob: (jobId: string) => ["outreach", "job", jobId] as const,
  saved: ["saved"] as const,
  companies: ["companies"] as const,
  roleTaxonomy: ["roles", "taxonomy"] as const,
  runs: ["runs"] as const,
  run: (id: string) => ["runs", id] as const,
};

/** Current user. A 401 here means "signed out": the shell redirects to /login. */
export function useMe() {
  return useQuery({ queryKey: keys.me, queryFn: api.me, staleTime: 5 * 60_000 });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.logout,
    onSettled: () => qc.clear(),
  });
}

export function useRecommendations() {
  return useQuery({ queryKey: keys.recommendations, queryFn: api.recommendations });
}

/** One row per draft (id, job, status): enough to badge job cards without loading every draft. */
export function useOutreachList() {
  return useQuery({ queryKey: keys.outreach, queryFn: api.outreachList });
}

/** Run history. Polls every few seconds only while some run is still going. */
export function useRuns() {
  return useQuery({
    queryKey: keys.runs,
    queryFn: api.runs,
    refetchInterval: (q) => (q.state.data?.some((r) => r.status === "running") ? 3000 : false),
  });
}

/** One run with its stored events. Polls while running (the live view also streams over SSE). */
export function useRun(runId: string) {
  return useQuery({
    queryKey: keys.run(runId),
    queryFn: () => api.run(runId),
    refetchInterval: (q) => (q.state.data?.status === "running" ? 3000 : false),
  });
}

/** The draft for one job. A 404 means "no draft yet" (not an error the user needs to see). */
export function useDraft(jobId: string) {
  return useQuery({ queryKey: keys.outreachByJob(jobId), queryFn: () => api.outreachByJob(jobId) });
}

/** The caller's saved jobs (filters are applied server-side; `{}` = all, used for the bookmark state). */
export function useSavedList(params: Parameters<typeof api.savedJobs>[0] = {}) {
  return useQuery({ queryKey: [...keys.saved, params], queryFn: () => api.savedJobs(params) });
}

export function useCompanies() {
  return useQuery({ queryKey: keys.companies, queryFn: api.companies });
}

/** The role synonym list used for suggestions (static on the server, so cache it for the session). */
export function useRoleTaxonomy() {
  return useQuery({ queryKey: keys.roleTaxonomy, queryFn: api.roleTaxonomy, staleTime: Infinity });
}
