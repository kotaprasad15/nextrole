"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore, type FormEvent } from "react";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { ApiError } from "@/lib/api/client";
import { api } from "@/lib/api/endpoints";
import { keys, useMyInterviews } from "@/lib/api/queries";
import type { InterviewInput } from "@/lib/api/schemas";
import { DIFFICULTY_LABEL, LEVELS, OUTCOMES, ROUND_TYPES, experienceFormSchema } from "@/lib/interviews";
import { ConfidentialityNotice } from "./confidentiality-notice";

const BLANK: InterviewInput = {
  company: "", role: "", level: "", interviewed_on: "", difficulty: 0, outcome: "", tips: "", anonymous: true,
  rounds: [{ type: "coding", difficulty: 3, notes: "" }],
};
const MAX_ROUNDS = 10;
type Errors = Record<string, string>;

const subscribe = () => () => {};
const editIdFromUrl = () => Number(new URLSearchParams(window.location.search).get("edit")) || null;

/** `/interviews/new` (and `?edit=ID`): the structured submission form. */
export function ExperienceForm() {
  // The address bar is only known in the browser: null on the server render and the first client render.
  const editId = useSyncExternalStore(subscribe, editIdFromUrl, () => null);
  const mine = useMyInterviews();
  if (editId && mine.isPending) return <Skeleton className="h-96 rounded-card" />;
  const existing = editId ? mine.data?.find((e) => e.id === editId) : undefined;
  const initial: InterviewInput = existing
    ? { company: existing.company, role: existing.role, level: existing.level, interviewed_on: existing.interviewed_on, difficulty: existing.difficulty,
        outcome: existing.outcome, tips: existing.tips, anonymous: existing.author === null, rounds: existing.rounds }
    : BLANK;
  return <FormBody key={existing?.id ?? "new"} initial={initial} editId={existing?.id ?? null} />;
}

function FormBody({ initial, editId }: { initial: InterviewInput; editId: number | null }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [v, setV] = useState<InterviewInput>(initial);
  const [errors, setErrors] = useState<Errors>({});
  const [acknowledged, setAcknowledged] = useState(false);
  const [formError, setFormError] = useState<string>();
  const set = (patch: Partial<InterviewInput>) => setV((p) => ({ ...p, ...patch }));
  const setRound = (i: number, patch: Partial<InterviewInput["rounds"][number]>) => set({ rounds: v.rounds.map((r, j) => (j === i ? { ...r, ...patch } : r)) });

  const save = useMutation({
    mutationFn: () => (editId ? api.editInterview(editId, v) : api.submitInterview(v)),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: keys.interviews });
      toast(editId ? "Saved" : "Submitted for review", { description: r.message, variant: "success" });
      router.push("/interviews");
    },
    onError: (e) => setFormError(e instanceof ApiError ? e.message : "Could not submit. Please try again."),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setFormError(undefined);
    const parsed = experienceFormSchema.safeParse(v);
    const next: Errors = {};
    if (!parsed.success) for (const issue of parsed.error.issues) next[String(issue.path[0])] ??= issue.message;
    if (!acknowledged) next.ack = "Please confirm you have not included confidential or personal information.";
    setErrors(next);
    if (Object.keys(next).length) return;
    save.mutate();
  };

  return (
    <>
      <PageHeader eyebrow="Interviews" title={editId ? "Edit your experience" : "Share your interview experience"} description="Help the next candidate: how the process went, what kinds of questions came up, and what you would do differently." />
      <div className="mb-6 max-w-3xl"><ConfidentialityNotice /></div>
      <form onSubmit={submit} noValidate className="flex max-w-3xl flex-col gap-6">
        <Card className="grid gap-5 sm:grid-cols-2">
          <Field label="Company" error={errors.company}><Input value={v.company} onChange={(e) => set({ company: e.target.value })} maxLength={80} autoComplete="off" /></Field>
          <Field label="Role" error={errors.role}><Input value={v.role} onChange={(e) => set({ role: e.target.value })} maxLength={80} placeholder="e.g. SDE or Backend Engineer" autoComplete="off" /></Field>
          <Field label="Level" error={errors.level}>
            <Select value={v.level} onChange={(e) => set({ level: e.target.value })}><option value="">Choose...</option>{LEVELS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
          </Field>
          <Field label="When was the interview?" error={errors.interviewed_on} hint="Month and year.">
            <Input type="month" value={v.interviewed_on} max={new Date().toISOString().slice(0, 7)} onChange={(e) => set({ interviewed_on: e.target.value })} />
          </Field>
          <Field label="Overall difficulty" error={errors.difficulty}>
            <Select value={String(v.difficulty)} onChange={(e) => set({ difficulty: Number(e.target.value) })}>
              <option value="0">Choose...</option>{[1, 2, 3, 4, 5].map((d) => <option key={d} value={d}>{d}: {DIFFICULTY_LABEL[d]}</option>)}
            </Select>
          </Field>
          <Field label="Outcome" error={errors.outcome}>
            <Select value={v.outcome} onChange={(e) => set({ outcome: e.target.value })}><option value="">Choose...</option>{OUTCOMES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
          </Field>
        </Card>

        <section aria-labelledby="rounds-title" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="rounds-title" className="text-h2 font-semibold tracking-tight">The rounds</h2>
              <p className="mt-1 text-small text-muted">Describe the kind of questions, not the exact ones.</p>
            </div>
            <Button type="button" variant="secondary" size="sm" disabled={v.rounds.length >= MAX_ROUNDS} onClick={() => set({ rounds: [...v.rounds, { type: "coding", difficulty: 3, notes: "" }] })}>
              <Plus className="size-4" aria-hidden /> Add a round
            </Button>
          </div>
          {v.rounds.map((r, i) => (
            <Card key={i} className="grid gap-4 sm:grid-cols-2">
              <Field label={`Round ${i + 1} type`}>
                <Select value={r.type} onChange={(e) => setRound(i, { type: e.target.value })}>{ROUND_TYPES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
              </Field>
              <Field label={`Round ${i + 1} difficulty`}>
                <Select value={String(r.difficulty)} onChange={(e) => setRound(i, { difficulty: Number(e.target.value) })}>{[1, 2, 3, 4, 5].map((d) => <option key={d} value={d}>{d}: {DIFFICULTY_LABEL[d]}</option>)}</Select>
              </Field>
              <Field label={`Round ${i + 1} notes`} className="sm:col-span-2" error={errors.rounds} hint={`${r.notes.length}/600`}>
                <Textarea className="min-h-20" maxLength={600} value={r.notes} onChange={(e) => setRound(i, { notes: e.target.value })} placeholder="e.g. Two medium problems about graphs and arrays, 45 minutes." />
              </Field>
              {v.rounds.length > 1 && (
                <div className="sm:col-span-2"><Button type="button" variant="ghost" size="sm" className="text-danger-ink" onClick={() => set({ rounds: v.rounds.filter((_, j) => j !== i) })} aria-label={`Remove round ${i + 1}`}><Trash2 className="size-4" aria-hidden /> Remove round</Button></div>
              )}
            </Card>
          ))}
        </section>

        <Card className="flex flex-col gap-5">
          <Field label="Tips for the next candidate" error={errors.tips} hint={`${v.tips.length}/1500`}>
            <Textarea className="min-h-28" maxLength={1500} value={v.tips} onChange={(e) => set({ tips: e.target.value })} />
          </Field>
          <Switch checked={v.anonymous} onCheckedChange={(anonymous) => set({ anonymous })} label="Share anonymously" description="When off, your first name from your profile is shown. Your email is never shown either way." />
        </Card>

        <div className="flex flex-col gap-2">
          <label className="flex items-start gap-2.5 text-small">
            <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} aria-invalid={Boolean(errors.ack)} aria-describedby={errors.ack ? "ack-error" : undefined} className="mt-0.5 size-4 accent-primary" />
            I have not included confidential or proprietary information, exact questions or answers, or anyone&apos;s personal details.
          </label>
          {errors.ack && <p id="ack-error" role="alert" className="text-caption font-medium text-danger-ink">{errors.ack}</p>}
        </div>

        {formError && <p role="alert" className="rounded-control bg-danger-tint px-3.5 py-3 text-small font-medium text-danger-ink">{formError}</p>}
        <div className="flex flex-wrap gap-3">
          <Button type="submit" size="lg" disabled={save.isPending}>{save.isPending && <Loader2 className="size-5 animate-spin" aria-hidden />} {editId ? "Save and resubmit" : "Submit for review"}</Button>
          <Button asChild variant="ghost" size="lg"><Link href="/interviews">Cancel</Link></Button>
        </div>
      </form>
    </>
  );
}
