"use client";

import { Bookmark, ChevronDown, ExternalLink, KanbanSquare } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { TierBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { Textarea } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { useRecommendations } from "@/lib/api/queries";
import { toggleSavedJob, useSavedJobs } from "@/lib/local/saved-jobs";
import { MAX_NOTE, STATUSES, STATUS_LABEL, buildBoard, trackJob, untrackJob, moveTracked, setTrackedNote, useTracker, type BoardItem, type TrackerStatus } from "@/lib/local/tracker";

const HINT: Record<TrackerStatus, string> = {
  saved: "Jobs you want to look at again.",
  applied: "You have sent an application.",
  interview: "You are in a hiring process.",
  offer: "You have an offer.",
};

/** Move/remove actions shared by the board and the saved list. */
export function useBoardActions() {
  const saved = useSavedJobs();
  return {
    move(item: BoardItem, status: TrackerStatus) {
      if (item.tracked) moveTracked(item.id, status);
      else trackJob({ id: item.id, title: item.title, company: item.company, tier: item.tier, apply_url: item.apply_url }, status);
    },
    remove(item: BoardItem) {
      untrackJob(item.id);
      if (saved.isSaved(item.id)) toggleSavedJob(item.id);
    },
  };
}

function TrackerCard({ item, onMove, onRemove }: { item: BoardItem; onMove: (s: TrackerStatus) => void; onRemove: () => void }) {
  const [note, setNote] = useState(item.note);
  return (
    <Card tier={item.tier ?? undefined} className="!p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {item.tier && <TierBadge tier={item.tier} short />}
          <h4 className="mt-1.5 text-small font-semibold leading-snug">
            {item.live ? <Link href={`/jobs/${encodeURIComponent(item.id)}`} className="hover:underline">{item.title}</Link> : item.title}
          </h4>
          {item.company && <p className="text-caption text-muted">{item.company}</p>}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" aria-label={`Move or remove ${item.title}`}>
              Move <ChevronDown className="size-3.5" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {STATUSES.filter((s) => s !== item.status).map((s) => (
              <DropdownMenuItem key={s} onSelect={() => onMove(s)}>Move to {STATUS_LABEL[s]}</DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onRemove} className="text-danger-ink">Remove from tracker</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {item.apply_url && (
        <a href={item.apply_url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-caption font-medium text-primary hover:underline">
          Apply link <ExternalLink className="size-3" aria-hidden />
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      )}

      <details className="mt-2">
        <summary className="cursor-pointer text-caption font-medium text-muted hover:text-ink">{item.note ? "Notes" : "Add a note"}</summary>
        <Textarea
          aria-label={`Notes for ${item.title}`}
          className="mt-2 min-h-20 text-small"
          maxLength={MAX_NOTE}
          value={note}
          placeholder="Who you spoke to, next step, deadline..."
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => {
            if (note === item.note) return;
            // A note on a bookmark-only job tracks it (still in Saved) so the note has somewhere to live.
            if (item.tracked) setTrackedNote(item.id, note);
            else {
              trackJob({ id: item.id, title: item.title, company: item.company, tier: item.tier, apply_url: item.apply_url }, "saved");
              setTrackedNote(item.id, note);
            }
          }}
        />
      </details>
      {item.updatedAt && <p className="mt-2 text-caption text-muted">Updated {new Date(item.updatedAt).toLocaleDateString(undefined, { dateStyle: "medium" })}</p>}
    </Card>
  );
}

/**
 * Four-column pipeline. No drag and drop: every card has a Move menu (a real, keyboard-operable
 * menu), and moves are announced to screen readers. Lives in this browser only.
 */
export function TrackerBoard() {
  const recs = useRecommendations();
  const tracker = useTracker();
  const saved = useSavedJobs();
  const actions = useBoardActions();
  const [announce, setAnnounce] = useState("");

  const board = useMemo(() => buildBoard(tracker.jobs, saved.ids, recs.data), [tracker.jobs, saved.ids, recs.data]);
  const total = STATUSES.reduce((n, s) => n + board[s].length, 0);

  // Until the matches load, a bookmarked job cannot be told apart from one that left them.
  if (recs.isPending && saved.ids.size > 0) {
    return <div role="status" aria-label="Loading tracker" className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-40 rounded-card" />)}</div>;
  }
  if (total === 0) {
    return (
      <EmptyState
        icon={<KanbanSquare />}
        title="Nothing tracked yet"
        description="Save a job with the bookmark on any job card, or add it to the tracker from its page. Then move it along as you apply."
        action={<Button asChild><Link href="/dashboard">Browse matches</Link></Button>}
      />
    );
  }

  return (
    <div>
      <p className="sr-only" role="status" aria-live="polite">{announce}</p>
      <p className="mb-5 flex items-center gap-2 text-small text-muted"><Bookmark className="size-4" aria-hidden /> Saved on this device only. Clearing your browser data clears the tracker.</p>
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        {STATUSES.map((s) => (
          <section key={s} aria-labelledby={`col-${s}`} className="rounded-card bg-ink/[0.03] p-3">
            <h3 id={`col-${s}`} className="px-1 text-small font-semibold">
              {STATUS_LABEL[s]} <span className="tabular-nums font-normal text-muted">({board[s].length})</span>
            </h3>
            <p className="px-1 text-caption text-muted">{HINT[s]}</p>
            <ul className="mt-3 flex flex-col gap-3">
              {board[s].map((item) => (
                <li key={item.id}>
                  <TrackerCard
                    key={`${item.id}:${item.note}`}
                    item={item}
                    onMove={(to) => { actions.move(item, to); setAnnounce(`Moved ${item.title} to ${STATUS_LABEL[to]}`); }}
                    onRemove={() => { actions.remove(item); setAnnounce(`Removed ${item.title} from the tracker`); }}
                  />
                </li>
              ))}
              {board[s].length === 0 && <li className="rounded-control border border-dashed border-border-strong px-3 py-6 text-center text-caption text-muted">Empty</li>}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
