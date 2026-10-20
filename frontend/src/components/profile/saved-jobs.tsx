"use client";

import { Bookmark, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { Badge, TierBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useRecommendations } from "@/lib/api/queries";
import { toggleSavedJob, useSavedJobs } from "@/lib/local/saved-jobs";
import { STATUSES, STATUS_LABEL, buildBoard, trackJob, useTracker } from "@/lib/local/tracker";

/** Bookmarked jobs, with a one-click way to start tracking an application. Saved on this device only. */
export function SavedJobs() {
  const recs = useRecommendations();
  const tracker = useTracker();
  const saved = useSavedJobs();

  const items = useMemo(() => {
    const board = buildBoard(tracker.jobs, saved.ids, recs.data);
    return STATUSES.flatMap((s) => board[s]).filter((i) => saved.ids.has(i.id));
  }, [tracker.jobs, saved.ids, recs.data]);

  if (recs.isPending && saved.ids.size > 0) {
    return <div role="status" aria-label="Loading saved jobs" className="flex flex-col gap-4">{[0, 1].map((i) => <Skeleton key={i} className="h-24 rounded-card" />)}</div>;
  }
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<Bookmark />}
        title="No saved jobs"
        description="Use the bookmark on a job card to keep it here. Saved jobs live on this device only."
        action={<Button asChild><Link href="/dashboard">Browse matches</Link></Button>}
      />
    );
  }

  return (
    <ul className="flex flex-col gap-4">
      {items.map((it) => (
        <li key={it.id}>
          <Card tier={it.tier ?? undefined} className="flex flex-wrap items-center justify-between gap-4 !p-5">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                {it.tier && <TierBadge tier={it.tier} short />}
                {it.tracked && <Badge tone="primary">{STATUS_LABEL[it.status]}</Badge>}
              </div>
              <h3 className="mt-2 text-h3 font-semibold tracking-tight">
                {it.live ? <Link href={`/jobs/${encodeURIComponent(it.id)}`} className="hover:underline">{it.title}</Link> : it.title}
              </h3>
              {it.company && <p className="text-small text-muted">{it.company}</p>}
              {!it.live && <p className="mt-1 text-caption text-muted">This job is no longer in your current matches.</p>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {it.apply_url && (
                <Button asChild size="sm" variant="secondary">
                  <a href={it.apply_url} target="_blank" rel="noopener noreferrer">Apply <ExternalLink className="size-4" aria-hidden /><span className="sr-only"> (opens in a new tab)</span></a>
                </Button>
              )}
              {!it.tracked && (
                <Button size="sm" onClick={() => trackJob({ id: it.id, title: it.title, company: it.company, tier: it.tier, apply_url: it.apply_url }, "applied")}>
                  I applied
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => toggleSavedJob(it.id)} aria-label={`Remove ${it.title} from saved jobs`}>Remove</Button>
            </div>
          </Card>
        </li>
      ))}
    </ul>
  );
}
