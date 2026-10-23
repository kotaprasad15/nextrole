"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Flag, Loader2, ShieldCheck, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Field, Textarea } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { ApiError } from "@/lib/api/client";
import { api } from "@/lib/api/endpoints";
import { keys, useModerationQueue, useModerationReports } from "@/lib/api/queries";
import type { AdminInterview } from "@/lib/api/schemas";
import { DIFFICULTY_LABEL, LEVELS, OUTCOMES, REPORT_REASONS, ROUND_TYPES, labelOf } from "@/lib/interviews";

type View = "pending" | "reports" | "approved";
const RISK_TONE = { high: "danger", medium: "warning", low: "success" } as const;

/**
 * `/admin/moderation`: the review queue for interview experiences. Nothing is published until an admin
 * approves it here. Access is enforced by the SERVER (role read from the database on every request, 404
 * for everyone else); this page only shows what the server returns, and says "not found" if it refuses.
 */
export function ModerationPage() {
  const [view, setView] = useState<View>("pending");
  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title="Moderation"
        description="Every interview post waits here until you approve it. Riskiest first."
        actions={<Button asChild variant="secondary"><Link href="/admin">Usage and cost</Link></Button>}
      />
      <div className="mb-6">
        <Segmented<View> label="Queue" value={view} onValueChange={setView} options={[{ value: "pending", label: "To review" }, { value: "reports", label: "Reports" }, { value: "approved", label: "Published" }]} />
      </div>
      {view === "reports" ? <Reports /> : <Queue status={view} />}
    </>
  );
}

function NotFound() {
  return <EmptyState icon={<ShieldCheck />} title="Not found" description="This page does not exist." />;
}

function Queue({ status }: { status: "pending" | "approved" }) {
  const q = useModerationQueue(status);
  if (q.isPending) return <Skeleton className="h-60 rounded-card" />;
  if (q.error) return q.error instanceof ApiError && q.error.status === 404 ? <NotFound /> : <ErrorState title="Could not load the queue" message={q.error.message} onRetry={() => q.refetch()} />;
  if (q.data.length === 0) return <EmptyState icon={<Check />} title={status === "pending" ? "Nothing to review" : "Nothing published yet"} description={status === "pending" ? "New posts and posts that were reported appear here." : undefined} />;
  return <ul className="flex flex-col gap-4" aria-label={status === "pending" ? "Posts to review" : "Published posts"}>{q.data.map((e) => <li key={e.id}><ReviewCard exp={e} /></li>)}</ul>;
}

function ReviewCard({ exp }: { exp: AdminInterview }) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const act = useMutation({
    mutationFn: (action: "approve" | "reject" | "remove") => api.moderate(exp.id, action, note),
    onSuccess: (_r, action) => {
      qc.invalidateQueries({ queryKey: keys.moderation });
      qc.invalidateQueries({ queryKey: keys.interviews });
      toast(action === "approve" ? "Published" : action === "reject" ? "Rejected" : "Removed", { variant: "success" });
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : "Could not save the decision.", { variant: "error" }),
  });
  const auto = exp.auto_check;
  return (
    <Card className="flex flex-col gap-3 !p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-h3 font-semibold tracking-tight">{exp.company}</h2>
          <p className="text-small text-muted">{exp.role} · {labelOf(LEVELS, exp.level)} · {exp.interviewed_on} · {labelOf(OUTCOMES, exp.outcome)} · difficulty {exp.difficulty}/5</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={RISK_TONE[auto.risk]}>Risk: {auto.risk}</Badge>
          {exp.open_reports > 0 && <Badge tone="danger"><Flag className="size-3.5" aria-hidden /> {exp.open_reports} report{exp.open_reports === 1 ? "" : "s"}</Badge>}
          {auto.llm_status === "unavailable" && <Badge tone="outline">AI check unavailable</Badge>}
        </div>
      </div>

      {(auto.flags.length > 0 || auto.llm?.reasons.length) ? (
        <ul className="flex flex-col gap-1 rounded-control bg-warning-tint px-3.5 py-2.5 text-small text-warning-ink" aria-label="Automated findings">
          {auto.flags.map((f) => <li key={f.code}><span className="font-medium">{f.code.replaceAll("_", " ")}:</span> {f.detail}</li>)}
          {auto.llm?.reasons.map((r, i) => <li key={`l${i}`}><span className="font-medium">AI check:</span> {r}</li>)}
        </ul>
      ) : (
        <p className="text-small text-muted">No automated findings.</p>
      )}

      <ol className="flex flex-col gap-2 text-small" aria-label="Rounds">
        {exp.rounds.map((r, i) => (
          <li key={i} className="rounded-control bg-ink/5 px-3.5 py-2"><span className="font-medium">{labelOf(ROUND_TYPES, r.type)}</span> <span className="text-muted">({DIFFICULTY_LABEL[r.difficulty]})</span>{r.notes && <p className="mt-1 whitespace-pre-line text-muted">{r.notes}</p>}</li>
        ))}
      </ol>
      {exp.tips && <p className="whitespace-pre-line text-small"><span className="font-medium">Tips: </span>{exp.tips}</p>}

      <Field label="Note to the author (shown if you reject or remove)">
        <Textarea className="min-h-16" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} aria-label={`Note about the post on ${exp.company}`} />
      </Field>
      <div className="flex flex-wrap justify-end gap-2">
        {exp.status !== "approved" && <Button size="sm" onClick={() => act.mutate("approve")} disabled={act.isPending}>{act.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />} <Check className="size-4" aria-hidden /> Approve</Button>}
        {exp.status === "pending" && <Button size="sm" variant="secondary" onClick={() => act.mutate("reject")} disabled={act.isPending}><X className="size-4" aria-hidden /> Reject</Button>}
        {exp.status === "approved" && <Button size="sm" variant="danger" onClick={() => act.mutate("remove")} disabled={act.isPending}>Remove</Button>}
      </div>
    </Card>
  );
}

function Reports() {
  const qc = useQueryClient();
  const reports = useModerationReports();
  const dismiss = useMutation({
    mutationFn: (id: number) => api.dismissReport(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.moderation }),
  });
  if (reports.isPending) return <Skeleton className="h-40 rounded-card" />;
  if (reports.error) return reports.error instanceof ApiError && reports.error.status === 404 ? <NotFound /> : <ErrorState title="Could not load reports" message={reports.error.message} onRetry={() => reports.refetch()} />;
  if (reports.data.length === 0) return <EmptyState icon={<Flag />} title="No open reports" />;
  return (
    <ul className="flex flex-col gap-3" aria-label="Open reports">
      {reports.data.map((r) => (
        <li key={r.id}>
          <Card className="flex flex-wrap items-center justify-between gap-3 !p-4">
            <div>
              <p className="font-medium">{r.company}: {r.role}</p>
              <p className="text-small text-muted">{labelOf(REPORT_REASONS, r.reason)}{r.detail ? ` · ${r.detail}` : ""}</p>
            </div>
            <Button size="sm" variant="secondary" onClick={() => dismiss.mutate(r.id)} aria-label={`Dismiss the report about ${r.company}`}>Dismiss</Button>
          </Card>
        </li>
      ))}
    </ul>
  );
}
