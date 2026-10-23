"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Flag, Loader2, Pencil, ThumbsUp, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { toast } from "@/components/ui/toast";
import { ApiError } from "@/lib/api/client";
import { api } from "@/lib/api/endpoints";
import { keys } from "@/lib/api/queries";
import type { Interview } from "@/lib/api/schemas";
import { DIFFICULTY_LABEL, LEVELS, OUTCOMES, REPORT_REASONS, ROUND_TYPES, labelOf } from "@/lib/interviews";

const STATUS_TONE = { pending: "warning", approved: "success", rejected: "danger", removed: "danger" } as const;
const STATUS_TEXT = { pending: "Waiting for review", approved: "Published", rejected: "Not published", removed: "Removed" } as const;
const OUTCOME_TONE: Record<string, "success" | "danger" | "neutral"> = { offer: "success", rejected: "danger" };

function monthLabel(ym: string) {
  const d = new Date(`${ym}-01T00:00:00`);
  return Number.isNaN(d.getTime()) ? ym : d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

/**
 * One interview experience. Everything shown is plain text from the server (never rendered as HTML).
 * Other people's posts can be upvoted and reported; your own show their review status and can be edited
 * or deleted.
 */
export function ExperienceCard({ exp }: { exp: Interview }) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: keys.interviews });
  const [reporting, setReporting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const vote = useMutation({
    mutationFn: () => api.upvoteInterview(exp.id, !exp.upvoted),
    onSuccess: invalidate,
    onError: (e) => toast(e instanceof ApiError ? e.message : "Could not save your vote.", { variant: "error" }),
  });
  const remove = useMutation({
    mutationFn: () => api.deleteInterview(exp.id),
    onSuccess: () => { invalidate(); toast("Your post was deleted", { variant: "info" }); },
    onError: () => toast("Could not delete the post. Please try again.", { variant: "error" }),
  });

  return (
    <Card className="flex flex-col gap-4 !p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-h3 font-semibold tracking-tight">{exp.company}</h2>
          <p className="text-small text-muted">{exp.role} · {labelOf(LEVELS, exp.level)} · {monthLabel(exp.interviewed_on)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {exp.mine && exp.status && <Badge tone={STATUS_TONE[exp.status]}>{STATUS_TEXT[exp.status]}</Badge>}
          <Badge tone={OUTCOME_TONE[exp.outcome] ?? "neutral"}>{labelOf(OUTCOMES, exp.outcome)}</Badge>
          <Badge tone="outline">Difficulty: {DIFFICULTY_LABEL[exp.difficulty]} ({exp.difficulty}/5)</Badge>
        </div>
      </div>

      {exp.mine && exp.moderator_note && (
        <p role="note" className="rounded-control bg-warning-tint px-3.5 py-2.5 text-small text-warning-ink"><span className="font-medium">Moderator note: </span>{exp.moderator_note}</p>
      )}

      <ol className="flex flex-col gap-2.5" aria-label={`Rounds at ${exp.company}`}>
        {exp.rounds.map((r, i) => (
          <li key={i} className="rounded-control bg-ink/5 px-3.5 py-2.5 text-small">
            <span className="font-medium">Round {i + 1}: {labelOf(ROUND_TYPES, r.type)}</span>
            <span className="text-muted"> · {DIFFICULTY_LABEL[r.difficulty]} ({r.difficulty}/5)</span>
            {r.notes && <p className="mt-1 whitespace-pre-line text-muted">{r.notes}</p>}
          </li>
        ))}
      </ol>

      {exp.tips && (
        <section aria-label="Tips">
          <h3 className="text-small font-semibold">Tips</h3>
          <p className="mt-1 whitespace-pre-line text-small text-muted">{exp.tips}</p>
        </section>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
        <p className="text-caption text-muted">{exp.author ? `Shared by ${exp.author}` : "Shared anonymously"}</p>
        <div className="flex flex-wrap items-center gap-2">
          {exp.mine ? (
            <>
              <Button asChild size="sm" variant="secondary"><Link href={`/interviews/new?edit=${exp.id}`}><Pencil className="size-4" aria-hidden /> Edit</Link></Button>
              {confirmDelete ? (
                <>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>Keep it</Button>
                  <Button size="sm" variant="danger" disabled={remove.isPending} onClick={() => remove.mutate()}>
                    {remove.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />} Delete for good
                  </Button>
                </>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)} aria-label={`Delete your post about ${exp.company}`}><Trash2 className="size-4" aria-hidden /> Delete</Button>
              )}
              <span className="text-caption text-muted">{exp.upvotes} found this helpful</span>
            </>
          ) : (
            <>
              <Button size="sm" variant={exp.upvoted ? "primary" : "secondary"} aria-pressed={exp.upvoted} disabled={vote.isPending} onClick={() => vote.mutate()}>
                <ThumbsUp className="size-4" aria-hidden /> Helpful <span className="tabular-nums">({exp.upvotes})</span>
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setReporting(true)} aria-label={`Report the post about ${exp.company}`}><Flag className="size-4" aria-hidden /> Report</Button>
            </>
          )}
        </div>
      </div>

      <ReportDialog open={reporting} onOpenChange={setReporting} exp={exp} />
    </Card>
  );
}

function ReportDialog({ open, onOpenChange, exp }: { open: boolean; onOpenChange: (o: boolean) => void; exp: Interview }) {
  const [reason, setReason] = useState<string>(REPORT_REASONS[0].value);
  const [detail, setDetail] = useState("");
  const send = useMutation({
    mutationFn: () => api.reportInterview(exp.id, reason, detail),
    onSuccess: (r) => { toast(r.message, { variant: "success" }); setDetail(""); onOpenChange(false); },
  });
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Report this post"
      description="A moderator will look at it. Reports are anonymous to the author."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => send.mutate()} disabled={send.isPending}>{send.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />} Send report</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="What is wrong?">
          <Select value={reason} onChange={(e) => setReason(e.target.value)}>{REPORT_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</Select>
        </Field>
        <Field label="Anything else we should know? (optional)" hint={`${detail.length}/300. Do not repeat personal details here.`}>
          <Textarea className="min-h-20" maxLength={300} value={detail} onChange={(e) => setDetail(e.target.value)} />
        </Field>
        {send.error && <p role="alert" className="rounded-control bg-danger-tint px-3.5 py-3 text-small font-medium text-danger-ink">{send.error instanceof ApiError ? send.error.message : "Could not send the report. Please try again."}</p>}
      </div>
    </Modal>
  );
}
