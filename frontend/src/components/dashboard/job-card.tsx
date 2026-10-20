"use client";

import { Bookmark, ExternalLink, MapPin, PenLine } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { ScoreRing } from "@/components/ui/score-ring";
import type { JobCard as Job, OutreachStatus, Tier } from "@/lib/api/schemas";
import { cn } from "@/lib/cn";
import { Tilt } from "@/lib/motion/tilt";
import { TIER_META } from "@/lib/tier";

const DRAFT_LABEL: Record<OutreachStatus, string> = {
  draft: "Draft needs review",
  critic_passed: "Draft ready",
  user_approved: "Draft approved",
};

interface Props {
  job: Job;
  tier: Tier;
  draftStatus?: OutreachStatus;
  saved: boolean;
  onToggleSave: (id: string) => void;
}

/**
 * One scored opening. The title links to the job page; Apply opens the REAL source link (copied
 * from the job board API, never generated) in a new tab; the outreach button goes to the draft
 * editor. Saving is a per-browser bookmark.
 */
export function JobCard({ job, tier, draftStatus, saved, onToggleSave }: Props) {
  const id = encodeURIComponent(job.job_id);
  return (
    // "view" cursor over the card (links and buttons inside still show the link cursor); the tier glow
    // sits BEHIND the opaque card, so only its halo shows, and only opacity animates.
    <div data-cursor="view" className="group relative isolate h-full">
      <span
        aria-hidden
        style={{ background: TIER_META[tier].ring }}
        className="pointer-events-none absolute inset-x-4 -bottom-1 top-6 -z-10 rounded-card opacity-0 blur-xl transition-opacity duration-300 group-hover:opacity-35"
      />
      <Tilt className="h-full">
        <Card tier={tier} interactive className="flex h-full flex-col">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="truncate text-small font-medium text-muted">{job.company}</p>
              <h2 className="mt-0.5 text-h3 font-semibold leading-snug tracking-tight">
                <Link href={`/jobs/${id}`} data-cursor="view" className="rounded-sm after:absolute after:inset-0 after:content-[''] focus-visible:after:rounded-card">
                  {job.title}
                </Link>
              </h2>
              <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-small text-muted">
                <span className="inline-flex items-center gap-1">
                  <MapPin className="size-3.5" aria-hidden />
                  {job.location || "Location not listed"}
                </span>
                {job.remote && <Badge tone="neutral">Remote</Badge>}
                {job.pasted && <Badge tone="neutral">Pasted by you</Badge>}
              </p>
            </div>
            <ScoreRing value={job.score} tone={tier} size={60} stroke={6} label={`Match score for ${job.title} at ${job.company}`} />
          </div>

          <p className="mt-4 text-small leading-relaxed text-ink/85">{job.rationale}</p>

          {(job.strengths.length > 0 || job.gaps.length > 0) && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {job.strengths.slice(0, 2).map((s) => (
                <Chip key={s} tone="good">{s}</Chip>
              ))}
              {job.gaps.length > 0 && <Chip tone="gap">{job.gaps.length === 1 ? "1 gap" : `${job.gaps.length} gaps`}</Chip>}
            </div>
          )}

          <div className="relative z-10 mt-auto flex flex-wrap items-center gap-2 pt-5">
            <Button asChild size="sm" variant={draftStatus ? "secondary" : "primary"}>
              <Link href={`/jobs/${id}/outreach`}>
                <PenLine className="size-4" aria-hidden />
                {draftStatus ? "Open draft" : "Draft outreach"}
              </Link>
            </Button>
            {job.apply_url && (
              <Button asChild size="sm" variant="secondary">
                <a href={job.apply_url} target="_blank" rel="noopener noreferrer">
                  Apply
                  <ExternalLink className="size-4" aria-hidden />
                  <span className="sr-only">(opens the company&apos;s page in a new tab)</span>
                </a>
              </Button>
            )}
            <button
              type="button"
              onClick={() => onToggleSave(job.job_id)}
              aria-pressed={saved}
              aria-label={saved ? `Remove ${job.title} from saved jobs` : `Save ${job.title}`}
              data-cursor="link"
              className={cn(
                "ml-auto grid size-9 place-items-center rounded-control transition-colors hover:bg-ink/5",
                saved ? "text-primary" : "text-muted hover:text-ink",
              )}
            >
              <Bookmark className={cn("size-[18px]", saved && "fill-current")} aria-hidden />
            </button>
          </div>
          {draftStatus && <p className="mt-2 text-caption text-muted">{DRAFT_LABEL[draftStatus]}</p>}
        </Card>
      </Tilt>
    </div>
  );
}
