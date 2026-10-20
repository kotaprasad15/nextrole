"use client";

import { ArrowLeft, Bookmark, ExternalLink, MapPin, PenLine, SearchX } from "lucide-react";
import Link from "next/link";
import { FactsList } from "@/components/outreach/facts-list";
import { DraftStatusBadge } from "@/components/outreach/status-badge";
import { Badge, TierBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { ScoreRing } from "@/components/ui/score-ring";
import { Skeleton } from "@/components/ui/skeleton";
import { useDraft, useRecommendations } from "@/lib/api/queries";
import { cn } from "@/lib/cn";
import { findJob } from "@/lib/jobs";
import { useSavedJobs } from "@/lib/local/saved-jobs";
import { TIER_META } from "@/lib/tier";
import { TrackerControl } from "./tracker-control";

/**
 * One opening in depth. The API has no single-job endpoint and does not expose job descriptions,
 * so this page is built from the scored match plus, when a draft exists, the facts that draft
 * was written from (posting facts and company research). Without a draft it says so plainly.
 */
export function JobDetail({ jobId }: { jobId: string }) {
  const recs = useRecommendations();
  const draft = useDraft(jobId);
  const saved = useSavedJobs();
  const found = findJob(recs.data, jobId);

  const back = (
    <Link href="/dashboard" className="mb-5 inline-flex items-center gap-1.5 text-small font-medium text-muted hover:text-ink">
      <ArrowLeft className="size-4" aria-hidden /> Back to matches
    </Link>
  );

  if (recs.isPending) {
    return (
      <div role="status" aria-label="Loading job">
        {back}
        <Skeleton className="h-40 rounded-card" />
        <div className="mt-6 grid gap-6 md:grid-cols-2"><Skeleton className="h-48 rounded-card" /><Skeleton className="h-48 rounded-card" /></div>
      </div>
    );
  }
  if (recs.error) return <ErrorState title="Could not load this job" message={recs.error.message} onRetry={() => recs.refetch()} />;
  if (!found) {
    return (
      <div>
        {back}
        <EmptyState
          icon={<SearchX />}
          title="That job is no longer in your matches"
          description="Matches change when you search again. Go back to the dashboard to pick another."
          action={<Button asChild><Link href="/dashboard">Back to matches</Link></Button>}
        />
      </div>
    );
  }

  const { job, tier } = found;
  const meta = TIER_META[tier];
  const isSaved = saved.isSaved(job.job_id);
  const facts = draft.data?.facts_used ?? [];
  const posting = facts.filter((f) => f.source === "job");
  const research = facts.filter((f) => f.source === "research");
  const id = encodeURIComponent(job.job_id);

  return (
    <div>
      {back}
      <Card tier={tier} className="p-6 md:p-8">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="min-w-0 max-w-2xl">
            <div className="flex flex-wrap items-center gap-2">
              <TierBadge tier={tier} />
              {job.remote && <Badge tone="neutral">Remote</Badge>}
              {job.pasted && <Badge tone="neutral">Pasted by you</Badge>}
              {draft.data && <DraftStatusBadge status={draft.data.status} />}
            </div>
            <h1 className="mt-3 font-display text-display text-balance">{job.title}</h1>
            <p className="mt-2 text-body-lg text-muted">{job.company}</p>
            <p className="mt-1 flex items-center gap-1.5 text-small text-muted"><MapPin className="size-4" aria-hidden /> {job.location || "Location not listed"}</p>
          </div>
          <ScoreRing value={job.score} tone={tier} size={104} stroke={9} label={`Match score for ${job.title} at ${job.company}`} caption="match" />
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button asChild>
            <Link href={`/jobs/${id}/outreach`}><PenLine className="size-4" aria-hidden /> {draft.data ? "Open your draft" : "Write outreach"}</Link>
          </Button>
          {job.apply_url ? (
            <Button asChild variant="secondary">
              <a href={job.apply_url} target="_blank" rel="noopener noreferrer">
                Apply on the company site<ExternalLink className="size-4" aria-hidden />
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </Button>
          ) : (
            <span className="text-small text-muted">No apply link was provided for this job.</span>
          )}
          <Button variant="ghost" aria-pressed={isSaved} onClick={() => saved.toggle(job.job_id)}>
            <Bookmark className={cn("size-4", isSaved && "fill-current text-primary")} aria-hidden /> {isSaved ? "Saved" : "Save"}
          </Button>
          <TrackerControl job={job} tier={tier} />
        </div>
      </Card>

      <section aria-labelledby="why" className="mt-8">
        <h2 id="why" className="text-h2 font-semibold tracking-tight">Why it fits</h2>
        {/* Tier colour via the token's CSS variable (class names built at runtime would not be generated). */}
        <p style={{ borderLeftColor: meta.ring }} className="mt-3 max-w-3xl rounded-card border-l-4 bg-surface p-5 text-body-lg leading-relaxed shadow-1">{job.rationale}</p>
      </section>

      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <Card>
          <CardTitle>Your strengths here</CardTitle>
          <CardDescription className="mt-1">Where your profile lines up with the posting.</CardDescription>
          {job.strengths.length ? (
            <ul className="mt-4 flex flex-col gap-2.5">
              {job.strengths.map((s) => (
                <li key={s} className="flex gap-2.5 text-small"><span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-success" />{s}</li>
              ))}
            </ul>
          ) : <p className="mt-4 text-small text-muted">No specific strengths were recorded.</p>}
        </Card>
        <Card>
          <CardTitle>Gaps to be ready for</CardTitle>
          <CardDescription className="mt-1">Things the posting asks for that your profile does not show.</CardDescription>
          {job.gaps.length ? (
            <ul className="mt-4 flex flex-col gap-2.5">
              {job.gaps.map((g) => (
                <li key={g} className="flex gap-2.5 text-small"><span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-warning" />{g}</li>
              ))}
            </ul>
          ) : <p className="mt-4 text-small text-muted">No clear gaps. Nice.</p>}
        </Card>
      </div>

      <section aria-labelledby="research" className="mt-8">
        <h2 id="research" className="text-h2 font-semibold tracking-tight">About the role and company</h2>
        {draft.isPending ? (
          <Skeleton className="mt-4 h-32 rounded-card" />
        ) : facts.length === 0 ? (
          <EmptyState
            className="mt-4"
            title="Write a draft to see company research"
            description="We do not store job descriptions. When you write outreach, we collect facts from the posting and public sources about the company, and show them here and in the draft."
            action={<Button asChild variant="secondary"><Link href={`/jobs/${id}/outreach`}>Write outreach</Link></Button>}
          />
        ) : (
          <Card className="mt-4">
            <p className="mb-4 text-small text-muted">
              {posting.length + research.length} facts gathered for your draft ({research.length} from public sources). These are the only facts the draft is allowed to use.
            </p>
            <FactsList facts={facts.filter((f) => f.source !== "profile")} />
          </Card>
        )}
      </section>
    </div>
  );
}
