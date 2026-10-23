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
  interviews: ["interviews"] as const,
  moderation: ["moderation"] as const,
  admin: ["admin"] as const,
  alerts: ["alerts"] as const,
  alertSummary: ["alerts", "summary"] as const,
  alertSettings: ["alerts", "settings"] as const,
  saved: ["saved"] as const,
  companies: ["companies"] as const,
  roleTaxonomy: ["roles", "taxonomy"] as const,
  runs: ["runs"] as const,
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

/** The caller's running run, if any (no history is exposed). Polls only while one is running. */
export function useActiveRun() {
  return useQuery({
    queryKey: [...keys.runs, "active"],
    queryFn: api.activeRun,
    refetchInterval: (q) => (q.state.data?.run_id ? 3000 : false),
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

export function useAlerts() {
  return useQuery({ queryKey: [...keys.alerts, "list"], queryFn: () => api.alerts() });
}

/** Unread count for the nav bell. Refreshed every minute while the app is open. */
export function useAlertSummary() {
  return useQuery({ queryKey: keys.alertSummary, queryFn: api.alertsSummary, refetchInterval: 60_000, staleTime: 30_000 });
}

export function useAlertSettings() {
  return useQuery({ queryKey: keys.alertSettings, queryFn: api.alertSettings });
}

export function useInterviews(params: Parameters<typeof api.interviews>[0]) {
  return useQuery({ queryKey: [...keys.interviews, "browse", params], queryFn: () => api.interviews(params) });
}

export function useMyInterviews() {
  return useQuery({ queryKey: [...keys.interviews, "mine"], queryFn: api.myInterviews });
}

export function useModerationQueue(status: string) {
  return useQuery({ queryKey: [...keys.moderation, "queue", status], queryFn: () => api.moderationQueue(status), retry: false });
}

export function useModerationReports() {
  return useQuery({ queryKey: [...keys.moderation, "reports"], queryFn: api.moderationReports, retry: false });
}

export function useAdminMetrics(days: number) {
  return useQuery({ queryKey: [...keys.admin, "metrics", days], queryFn: () => api.adminMetrics(days), retry: false, refetchInterval: 60_000 });
}

export function useAdminTraces() {
  return useQuery({ queryKey: [...keys.admin, "traces"], queryFn: api.adminTraces, retry: false });
}

export function useAdminTrace(runId: string | null) {
  return useQuery({ queryKey: [...keys.admin, "trace", runId], queryFn: () => api.adminTrace(runId!), enabled: runId !== null, retry: false });
}
