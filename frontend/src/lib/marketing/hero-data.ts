import { cacheLife } from "next/cache";
import { z } from "zod";
import { IS_MOCK } from "@/lib/api/config";
import { FeaturedJobSchema, type FeaturedJob } from "@/lib/api/schemas";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://127.0.0.1:8000";

/**
 * Real postings for the homepage hero, from the backend's public `GET /public/featured-jobs`
 * (jobs already fetched from Greenhouse / Lever / Ashby, https apply links verbatim). Cached for
 * hours; the page never depends on the backend being up: any failure (including at BUILD time)
 * returns `[]`, which the hero renders as a clearly generic card, and is cached only briefly so
 * real data appears as soon as the backend is reachable. Mock mode never calls the backend.
 */
export async function getFeaturedJobs(): Promise<FeaturedJob[]> {
  "use cache";
  if (IS_MOCK) {
    cacheLife("minutes");
    return [];
  }
  try {
    const res = await fetch(`${BACKEND_URL}/public/featured-jobs`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) throw new Error(`featured-jobs ${res.status}`);
    const jobs = z.array(FeaturedJobSchema).parse(await res.json());
    if (jobs.length) cacheLife("hours");
    else cacheLife({ stale: 30, revalidate: 120, expire: 600 });
    return jobs.slice(0, 3);
  } catch {
    cacheLife({ stale: 30, revalidate: 60, expire: 300 });
    return [];
  }
}
