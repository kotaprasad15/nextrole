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
