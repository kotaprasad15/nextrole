"use client";

import { Loader2, Sparkles } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import type { OutreachRun } from "./use-outreach-run";

/** First step when a job has no draft: pick a format, optionally a first name, and generate. */
export function GenerateForm({ run, company }: { run: OutreachRun; company: string }) {
  const [channel, setChannel] = useState<"email" | "message">("email");
  const [name, setName] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    run.start({ channel, recipient_name: name.trim() || undefined });
  };

  return (
    <Card className="max-w-xl">
      <h2 className="text-h3 font-semibold tracking-tight">Write a draft for {company}</h2>
      <p className="mt-2 text-small text-muted">
        We research the company from public sources, write a draft using only facts from your profile, the posting and that research, and have a reviewer check it. Nothing is ever sent for you.
      </p>
      <form onSubmit={submit} className="mt-5 flex flex-col gap-4">
        <Field label="Format">
          <Select value={channel} onChange={(e) => setChannel(e.target.value as typeof channel)}>
            <option value="email">Email</option>
            <option value="message">Short message (for example a LinkedIn note)</option>
          </Select>
        </Field>
        <Field label="Recipient's first name (optional)" hint="Only used for the greeting. You add the email address later.">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane" maxLength={60} autoComplete="off" />
        </Field>
        {run.error && <p role="alert" className="rounded-control bg-danger-tint px-3.5 py-3 text-small font-medium text-danger-ink">{run.error}</p>}
        <Button type="submit" disabled={run.starting || run.busy} className="self-start">
          {run.starting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
          Write my draft
        </Button>
      </form>
    </Card>
  );
}
