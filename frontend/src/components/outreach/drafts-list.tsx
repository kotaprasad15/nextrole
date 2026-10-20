"use client";

import { FileText } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Segmented } from "@/components/ui/segmented";
import { TierBadge } from "@/components/ui/badge";
import { useOutreachList, useRecommendations } from "@/lib/api/queries";
import type { OutreachStatus } from "@/lib/api/schemas";
import { findJob } from "@/lib/jobs";
import { DraftStatusBadge } from "./status-badge";

type Filter = "all" | OutreachStatus;
const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "draft", label: "Needs review" },
  { value: "critic_passed", label: "Reviewer passed" },
  { value: "user_approved", label: "Approved" },
];

/**
 * Every draft in one place. The drafts endpoint returns id, job and status only, so titles and
 * companies come from the current matches; a draft whose job has left the matches still opens.
 */
export function DraftsList() {
  const list = useOutreachList();
  const recs = useRecommendations();
  const [filter, setFilter] = useState<Filter>("all");

  const rows = useMemo(
    () => (list.data ?? []).map((d) => ({ ...d, found: findJob(recs.data, d.job_id) })).filter((d) => filter === "all" || d.status === filter),
    [list.data, recs.data, filter],
  );
  const count = (f: Filter) => (f === "all" ? list.data?.length ?? 0 : (list.data ?? []).filter((d) => d.status === f).length);

  if (list.isPending || recs.isPending) {
    return (
      <div role="status" aria-label="Loading drafts" className="flex flex-col gap-4">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 rounded-card" />)}
      </div>
    );
  }
  if (list.error) return <ErrorState title="Could not load your drafts" message={list.error.message} onRetry={() => list.refetch()} />;
  if (list.data.length === 0) {
    return (
      <EmptyState
        icon={<FileText />}
        title="No drafts yet"
        description="Pick a job from your matches and choose Draft outreach. Drafts are never sent for you."
        action={<Button asChild><Link href="/dashboard">Go to matches</Link></Button>}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Segmented
        label="Filter drafts by status"
        value={filter}
        onValueChange={setFilter}
        options={FILTERS.map((f) => ({ value: f.value, label: <>{f.label} <span className="tabular-nums text-muted">({count(f.value)})</span></> }))}
      />

      {rows.length === 0 ? (
        <p className="text-small text-muted" role="status">No drafts with this status.</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {rows.map((d) => (
            <li key={d.id}>
              <Card interactive tier={d.found?.tier} className="flex flex-wrap items-center justify-between gap-4 !p-5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {d.found && <TierBadge tier={d.found.tier} short />}
                    <DraftStatusBadge status={d.status} />
                  </div>
                  <h2 className="mt-2 truncate text-h3 font-semibold tracking-tight">
                    <Link href={`/jobs/${encodeURIComponent(d.job_id)}/outreach`} className="after:absolute after:inset-0 after:content-['']">
                      {d.found?.job.title ?? "Job no longer in your matches"}
                    </Link>
                  </h2>
                  {d.found && <p className="text-small text-muted">{d.found.job.company}</p>}
                </div>
                <span className="relative text-small font-medium text-primary">Open draft</span>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
