"use client";

import { ArrowLeft, SearchX } from "lucide-react";
import Link from "next/link";
import { RunPanel } from "@/components/dashboard/run-panel";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { TierBadge } from "@/components/ui/badge";
import { ApiError } from "@/lib/api/client";
import { useDraft, useRecommendations } from "@/lib/api/queries";
import { findJob } from "@/lib/jobs";
import { DraftEditor } from "./draft-editor";
import { GenerateForm } from "./generate-form";
import { useOutreachRun } from "./use-outreach-run";

/** `/jobs/[id]/outreach`: generate a draft if there is none, otherwise edit and approve it. */
export function OutreachPage({ jobId }: { jobId: string }) {
  const recs = useRecommendations();
  const draft = useDraft(jobId);
  const run = useOutreachRun(jobId);
  const found = findJob(recs.data, jobId);
  const noDraft = draft.error instanceof ApiError && draft.error.status === 404;

  const back = (
    <Link href="/dashboard" className="mb-5 inline-flex items-center gap-1.5 text-small font-medium text-muted hover:text-ink">
      <ArrowLeft className="size-4" aria-hidden /> Back to matches
    </Link>
  );

  if (recs.isPending || (draft.isPending && !noDraft)) {
    return (
      <div role="status" aria-label="Loading draft">
        {back}
        <Skeleton className="mb-6 h-12 w-80" />
        <Skeleton className="h-96 rounded-card" />
      </div>
    );
  }
  if (recs.error) return <ErrorState title="Could not load this job" message={recs.error.message} onRetry={() => recs.refetch()} />;
  if (!found && !draft.data) {
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

  const title = found?.job.title ?? draft.data?.job_title ?? "Job";
  const company = found?.job.company ?? draft.data?.company ?? "";

  return (
    <div>
      {back}
      <header className="mb-8">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-small font-medium text-primary">Outreach draft</p>
          {found && <TierBadge tier={found.tier} />}
        </div>
        <h1 className="mt-2 font-display text-display text-balance">{title}</h1>
        <p className="mt-2 text-body-lg text-muted">
          {company}
          {found && (
            <>
              {" · "}
              <Link href={`/jobs/${encodeURIComponent(jobId)}`} className="link-underline text-primary">View job details</Link>
            </>
          )}
        </p>
      </header>

      <div className="flex flex-col gap-6">
        {run.active && <RunPanel mode="outreach" events={run.events} status={run.status} onDismiss={run.dismiss} />}
        {draft.error && !noDraft ? (
          <ErrorState title="Could not load the draft" message={draft.error.message} onRetry={() => draft.refetch()} />
        ) : run.busy ? null : draft.data ? (
          <DraftEditor draft={draft.data} run={run} jobId={jobId} />
        ) : (
          <GenerateForm run={run} company={company} />
        )}
      </div>
    </div>
  );
}
