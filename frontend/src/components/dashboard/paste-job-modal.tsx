"use client";

import { Loader2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { validatePaste } from "@/lib/dashboard/paste";
import type { FieldErrors } from "@/lib/validation";

/**
 * Add a job that is not on the boards we watch. Text wins over the link (text is never fetched);
 * a link alone is fetched by the server with its safety checks, except LinkedIn, Indeed and
 * Naukri, which we do not read. Rules mirror the backend so users see problems before a round trip.
 */
export function PasteJobModal({
  open,
  onOpenChange,
  onSubmit,
  pending,
  serverError,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (v: { url: string; text: string }) => void;
  pending: boolean;
  serverError?: string;
}) {
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [errors, setErrors] = useState<FieldErrors<"url" | "text">>({});

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const errs = validatePaste({ url, text });
    setErrors(errs);
    if (Object.keys(errs).length === 0) onSubmit({ url: url.trim(), text: text.trim() });
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Paste a job posting"
      description="We score it against your profile and draft outreach for it. Paste the text for the best result."
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Field label="Posting text" error={errors.text} hint="Copy the whole description from the job page.">
          <Textarea className="min-h-40" value={text} onChange={(e) => setText(e.target.value)} placeholder="About the role, responsibilities, requirements..." />
        </Field>
        <Field label="Link to the posting (optional)" error={errors.url} hint="Used as the Apply link. If you paste no text, we will read this page.">
          <Input type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://company.com/careers/backend-engineer" />
        </Field>
        {serverError && <p role="alert" className="rounded-control bg-danger-tint px-3.5 py-3 text-small font-medium text-danger-ink">{serverError}</p>}
        <div className="mt-2 flex justify-end gap-3">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" disabled={pending}>
            {pending ? <><Loader2 className="size-4 animate-spin" aria-hidden /> Starting...</> : "Score and draft"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
