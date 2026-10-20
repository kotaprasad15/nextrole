import type { JobCard, Recommendations, Tier } from "@/lib/api/schemas";
import { TIERS } from "@/lib/tier";

/** Find a job (and which company-size tier it sits in) among the current recommendations. */
export function findJob(recs: Recommendations | undefined, jobId: string): { job: JobCard; tier: Tier } | null {
  if (!recs) return null;
  for (const tier of TIERS) {
    const job = recs[tier].find((j) => j.job_id === jobId);
    if (job) return { job, tier };
  }
  return null;
}
