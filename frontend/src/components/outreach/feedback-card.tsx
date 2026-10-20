"use client";

import { useMutation } from "@tanstack/react-query";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/field";
import { toast } from "@/components/ui/toast";
import { ApiError } from "@/lib/api/client";
import { api } from "@/lib/api/endpoints";
import type { Outreach } from "@/lib/api/schemas";
import { cn } from "@/lib/cn";

/**
 * Optional feedback. It is stored per account and shapes the STYLE of future drafts only (never
 * the facts), so the copy says exactly that.
 */
export function FeedbackCard({ draft, onSaved }: { draft: Outreach; onSaved: (d: Outreach) => void }) {
  const [rating, setRating] = useState<1 | -1 | null>((draft.feedback?.rating as 1 | -1 | undefined) ?? null);
  const [note, setNote] = useState(draft.feedback?.note ?? "");
  const save = useMutation({
    mutationFn: () => api.outreachFeedback(draft.id, rating as 1 | -1, note.trim()),
    onSuccess: (d) => {
      onSaved(d);
      toast("Thanks, noted", { variant: "success" });
    },
  });

  const choice = (value: 1 | -1, label: string, icon: React.ReactNode) => (
    <button
      type="button"
      aria-pressed={rating === value}
      onClick={() => setRating(value)}
      data-cursor="link"
      className={cn(
        "inline-flex h-10 items-center gap-2 rounded-full border px-4 text-small font-medium transition-colors",
        rating === value ? "border-primary bg-primary-tint text-primary" : "border-border-strong bg-surface hover:border-ink/40",
      )}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <Card>
      <CardTitle>How was this draft?</CardTitle>
      <CardDescription className="mt-1">Your note only changes the style of future drafts, never the facts they use.</CardDescription>
      <div className="mt-4 flex gap-2" role="group" aria-label="Rate this draft">
        {choice(1, "Good", <ThumbsUp className="size-4" aria-hidden />)}
        {choice(-1, "Needs work", <ThumbsDown className="size-4" aria-hidden />)}
      </div>
      <Textarea
        aria-label="Feedback note"
        className="mt-3 min-h-20"
        maxLength={500}
        placeholder="e.g. Shorter, and less formal."
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      {save.error && (
        <p role="alert" className="mt-2 text-caption font-medium text-danger">
          {save.error instanceof ApiError ? save.error.message : "Could not save feedback."}
        </p>
      )}
      <Button size="sm" variant="secondary" className="mt-3" disabled={rating === null || save.isPending} onClick={() => save.mutate()}>
        {draft.feedback ? "Update feedback" : "Send feedback"}
      </Button>
    </Card>
  );
}
