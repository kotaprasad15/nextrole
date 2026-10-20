"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Loader2, Mail, RefreshCw, Save, Trash2, Undo2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { toast } from "@/components/ui/toast";
import { ApiError } from "@/lib/api/client";
import { api } from "@/lib/api/endpoints";
import { keys } from "@/lib/api/queries";
import type { Outreach } from "@/lib/api/schemas";
import { recordVersion } from "@/lib/local/draft-versions";
import { copyText, gmailComposeUrl, mailtoUrl, unverified, wordCount } from "@/lib/outreach";
import { EMAIL_RE } from "@/lib/validation";
import { CriticPanel } from "./critic-panel";
import { FactsList } from "./facts-list";
import { FeedbackCard } from "./feedback-card";
import { DraftStatusBadge } from "./status-badge";
import type { OutreachRun } from "./use-outreach-run";
import { VersionHistory } from "./version-history";

const msg = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

/**
 * Edit, review and approve one draft. Nothing here sends anything: approval only unlocks the
 * "open in your mail app" links, which are built in the browser from the address the user typed.
 * Editing clears the reviewer's check and any approval on the server, and the UI says so.
 */
export function DraftEditor({ draft, run, jobId }: { draft: Outreach; run: OutreachRun; jobId: string }) {
  const qc = useQueryClient();
  const sig = `${draft.id}|${draft.subject}|${draft.body}|${draft.recipient_email}`;
  const [seen, setSeen] = useState(sig);
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [to, setTo] = useState(draft.recipient_email);
  const [toError, setToError] = useState<string>();
  const [confirm, setConfirm] = useState<"approve" | "regenerate" | "delete" | null>(null);
  // The server's draft changed (saved, regenerated): reset the fields to it. Derived state, so
  // it is adjusted during render rather than in an effect.
  if (seen !== sig) {
    setSeen(sig);
    setSubject(draft.subject);
    setBody(draft.body);
    setTo(draft.recipient_email);
  }

  const isEmail = draft.channel === "email";
  const dirty = subject !== draft.subject || body !== draft.body || to !== draft.recipient_email;
  const approved = draft.status === "user_approved";

  // Record this version in the local history (a no-op when it matches the newest one).
  useEffect(() => {
    recordVersion(jobId, { subject: draft.subject, body: draft.body, source: draft.critic ? "generated" : "edited", score: draft.critic?.overall ?? null });
  }, [jobId, draft.subject, draft.body, draft.critic]);

  // Warn before leaving with unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const put = (d: Outreach) => {
    qc.setQueryData(keys.outreachByJob(jobId), d);
    void qc.invalidateQueries({ queryKey: keys.outreach });
  };

  const validTo = () => {
    if (to.trim() && !EMAIL_RE.test(to.trim())) {
      setToError("Enter a valid email address, or leave it empty.");
      return false;
    }
    setToError(undefined);
    return true;
  };

  const save = useMutation({
    mutationFn: () => api.editOutreach(draft.id, { subject, body, recipient_email: to.trim() }),
    onSuccess: (d) => {
      put(d);
      toast("Saved", { variant: "success" });
    },
  });
  const approve = useMutation({
    mutationFn: async () => {
      if (dirty) await api.editOutreach(draft.id, { subject, body, recipient_email: to.trim() });
      return api.approveOutreach(draft.id);
    },
    onSuccess: (d) => {
      put(d);
      setConfirm(null);
      toast("Marked ready to send", { description: "Nothing has been sent. Open it in your mail app when you are ready.", variant: "success" });
    },
  });
  const remove = useMutation({
    mutationFn: () => api.deleteOutreach(draft.id),
    onSuccess: () => {
      qc.removeQueries({ queryKey: keys.outreachByJob(jobId) });
      void qc.invalidateQueries({ queryKey: keys.outreach });
      setConfirm(null);
      toast("Draft deleted");
    },
  });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(copyText(draft.channel, subject, body));
      toast("Copied to clipboard", { variant: "success" });
    } catch {
      toast("Could not copy automatically", { description: "Select the text and press Ctrl or Cmd + C.", variant: "warning" });
    }
  };

  const onApprove = () => {
    if (!validTo()) return;
    if (unverified(draft) || dirty) setConfirm("approve");
    else approve.mutate();
  };

  const mailto = approved && !dirty && isEmail ? mailtoUrl(draft.recipient_email, draft.subject, draft.body) : null;
  const error = save.error ? msg(save.error, "Could not save.") : approve.error ? msg(approve.error, "Could not approve.") : remove.error ? msg(remove.error, "Could not delete.") : undefined;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
      <div className="flex flex-col gap-6">
        <Card>
          <div className="mb-5 flex flex-wrap items-center gap-3">
            <DraftStatusBadge status={draft.status} />
            {dirty && <span className="text-small font-medium text-warning-ink">Unsaved changes</span>}
          </div>

          {draft.warnings.length > 0 && (
            <div role="note" className="mb-5 rounded-control bg-warning-tint p-3.5 text-small text-ink/90">
              <p className="font-semibold text-warning-ink">Check these before you use this draft</p>
              <ul className="mt-1.5 list-disc pl-5">{draft.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
            </div>
          )}

          <div className="flex flex-col gap-5">
            {isEmail && (
              <Field label="Recipient email (optional)" error={toError} hint="From their careers or contact page. Only used to fill the To field in your mail app.">
                <Input type="email" inputMode="email" value={to} onChange={(e) => { setTo(e.target.value); setToError(undefined); }} onBlur={validTo} placeholder="name@company.com" autoComplete="off" />
              </Field>
            )}
            {isEmail && (
              <Field label="Subject">
                <Input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} />
              </Field>
            )}
            <Field label={isEmail ? "Message" : "Short message"} hint={`${wordCount(body)} words`}>
              <Textarea className="min-h-72 text-body-lg" value={body} onChange={(e) => setBody(e.target.value)} />
            </Field>
          </div>

          {(draft.critic || approved) && dirty && (
            <p className="mt-4 text-small text-muted">Saving clears the reviewer&apos;s check{approved ? " and your approval" : ""}, because the text changed.</p>
          )}
          {error && <p role="alert" className="mt-4 rounded-control bg-danger-tint px-3.5 py-3 text-small font-medium text-danger-ink">{error}</p>}

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Button variant="secondary" disabled={!dirty || save.isPending} onClick={() => validTo() && save.mutate()}>
              {save.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Save className="size-4" aria-hidden />} Save edits
            </Button>
            {dirty && (
              <Button variant="ghost" onClick={() => { setSubject(draft.subject); setBody(draft.body); setTo(draft.recipient_email); setToError(undefined); }}>
                <Undo2 className="size-4" aria-hidden /> Discard edits
              </Button>
            )}
            <Button variant="secondary" onClick={copy}><Copy className="size-4" aria-hidden /> Copy</Button>
            {approved && !dirty ? (
              <span className="inline-flex items-center gap-1.5 text-small font-medium text-success-ink"><Check className="size-4" aria-hidden /> Approved</span>
            ) : (
              <Button onClick={onApprove} disabled={approve.isPending} magnetic>
                {approve.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />} Approve as ready to send
              </Button>
            )}
          </div>

          <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 border-t border-border pt-4 text-small">
            <button type="button" className="inline-flex items-center gap-1.5 font-medium text-muted hover:text-ink" onClick={() => setConfirm("regenerate")} disabled={run.busy}>
              <RefreshCw className="size-4" aria-hidden /> Write a new draft
            </button>
            <button type="button" className="inline-flex items-center gap-1.5 font-medium text-danger-ink hover:underline" onClick={() => setConfirm("delete")}>
              <Trash2 className="size-4" aria-hidden /> Delete draft
            </button>
          </div>
        </Card>

        {approved && !dirty && (
          <Card className="border-success/30 bg-success-tint/50">
            <CardTitle className="flex items-center gap-2"><Mail className="size-5 text-success-ink" aria-hidden /> Ready to send</CardTitle>
            {isEmail ? (
              <>
                <p className="mt-2 text-small text-ink/85">
                  NextRole never sends anything. Open the draft in your own mail app, read it once more, and press send yourself.
                </p>
                {mailto ? (
                  <div className="mt-4 flex flex-wrap gap-3">
                    <Button asChild><a href={mailto}>Open in my email app</a></Button>
                    <Button asChild variant="secondary">
                      <a href={gmailComposeUrl(draft.recipient_email, draft.subject, draft.body)} target="_blank" rel="noopener noreferrer">
                        Open a Gmail draft<span className="sr-only"> (opens in a new tab)</span>
                      </a>
                    </Button>
                  </div>
                ) : (
                  <p className="mt-3 text-small font-medium text-ink">Add the recipient&apos;s email above and save to get the email links.</p>
                )}
              </>
            ) : (
              <p className="mt-2 text-small text-ink/85">Copy the message and send it yourself.</p>
            )}
          </Card>
        )}
      </div>

      <aside aria-label="Draft review" className="flex flex-col gap-6">
        <CriticPanel critic={draft.critic} attempts={draft.attempts} />
        <Card>
          <CardTitle>Facts this draft uses</CardTitle>
          <p className="mb-4 mt-1 text-small text-muted">Every claim in the message must come from one of these.</p>
          <FactsList facts={draft.facts_used} />
        </Card>
        <VersionHistory
          jobId={jobId}
          current={{ subject, body }}
          onRestore={(v) => { setSubject(v.subject); setBody(v.body); toast("Version restored in the editor", { description: "Save it to keep it." }); }}
        />
        <FeedbackCard key={draft.id} draft={draft} onSaved={put} />
      </aside>

      <Modal
        open={confirm === "approve"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Approve this draft?"
        description={
          unverified(draft) && !dirty
            ? "The reviewer has not verified this draft. Approve it only after you have read it and checked every claim yourself."
            : "Your edits will be saved and the reviewer has not checked them. Approve only after reading the draft yourself."
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>Keep editing</Button>
            <Button onClick={() => approve.mutate()} disabled={approve.isPending}>
              {approve.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />} I have read it, approve
            </Button>
          </>
        }
      />
      <Modal
        open={confirm === "regenerate"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Write a new draft?"
        description="This replaces the current draft, your edits and any approval. The old text stays in your version history."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
            <Button onClick={() => { setConfirm(null); run.start({ channel: draft.channel }); }}>Write a new draft</Button>
          </>
        }
      />
      <Modal
        open={confirm === "delete"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Delete this draft?"
        description="The draft is deleted from your account. Your local version history for this job is kept."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => remove.mutate()} disabled={remove.isPending}>
              {remove.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />} Delete draft
            </Button>
          </>
        }
      />
    </div>
  );
}
