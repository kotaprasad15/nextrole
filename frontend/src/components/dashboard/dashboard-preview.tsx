"use client";

import { useQuery } from "@tanstack/react-query";
import { Briefcase } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { TierBadge } from "@/components/ui/badge";
import { api } from "@/lib/api/endpoints";
import { keys } from "@/lib/api/queries";
import { TIERS } from "@/lib/tier";

/**
 * Temporary: proves the data layer end to end (typed client, schema validation, query cache,
 * loading / error / empty states). Replaced by the real dashboard in milestone 4.
 */
export function DashboardPreview() {
  const { data, isPending, error, refetch } = useQuery({ queryKey: keys.recommendations, queryFn: api.recommendations });

  if (isPending) {
    return (
      <div role="status" aria-label="Loading matches" className="grid gap-5 md:grid-cols-3">
        {TIERS.map((t) => (
          <Skeleton key={t} className="h-40 rounded-card" />
        ))}
      </div>
    );
  }
  if (error) {
    return <ErrorState title="Could not load your matches" message={error.message} onRetry={() => refetch()} />;
  }
  const total = TIERS.reduce((n, t) => n + data[t].length, 0);
  if (total === 0) {
    return <EmptyState icon={<Briefcase />} title="No matches yet" description="Run a search and we will score openings against your profile." />;
  }
  return (
    <div className="grid gap-5 md:grid-cols-3">
      {TIERS.map((t) => (
        <Card key={t} tier={t}>
          <TierBadge tier={t} />
          <p className="mt-3 font-display text-display-lg">{data[t].length}</p>
          <p className="text-small text-muted">matches, best score {Math.max(...data[t].map((j) => j.score))}</p>
        </Card>
      ))}
    </div>
  );
}
