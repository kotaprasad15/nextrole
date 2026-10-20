import type { JobCard } from "@/lib/api/schemas";

export interface Filters {
  query: string;
  minScore: number;
  remoteOnly: boolean;
  hasDraft: boolean;
  savedOnly: boolean;
  sort: "score" | "company";
}

export const DEFAULT_FILTERS: Filters = { query: "", minScore: 0, remoteOnly: false, hasDraft: false, savedOnly: false, sort: "score" };

export const MIN_SCORE_OPTIONS = [0, 50, 60, 70, 80];

/** How many filters differ from the defaults (sort is a view option, not a filter). */
export function activeFilterCount(f: Filters): number {
  return [f.query.trim() !== "", f.minScore > 0, f.remoteOnly, f.hasDraft, f.savedOnly].filter(Boolean).length;
}

export interface FilterContext {
  /** job_ids that have an outreach draft. */
  drafts: ReadonlySet<string>;
  /** job_ids the user saved (client-side). */
  saved: ReadonlySet<string>;
}

/** Client-side filtering and sorting. Every search word must appear somewhere on the card. */
export function filterJobs(jobs: JobCard[], f: Filters, ctx: FilterContext): JobCard[] {
  const terms = f.query.toLowerCase().split(/\s+/).filter(Boolean);
  const out = jobs.filter((j) => {
    if (j.score < f.minScore) return false;
    if (f.remoteOnly && !j.remote) return false;
    if (f.hasDraft && !ctx.drafts.has(j.job_id)) return false;
    if (f.savedOnly && !ctx.saved.has(j.job_id)) return false;
    if (terms.length) {
      const hay = `${j.title} ${j.company} ${j.location} ${j.rationale}`.toLowerCase();
      if (!terms.every((t) => hay.includes(t))) return false;
    }
    return true;
  });
  return out.sort((a, b) =>
    f.sort === "company" ? a.company.localeCompare(b.company) || b.score - a.score : b.score - a.score || a.company.localeCompare(b.company),
  );
}
