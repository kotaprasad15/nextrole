"use client";

import { ArrowUpRight, CheckCircle2, ShieldCheck } from "lucide-react";
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { TierBadge } from "@/components/ui/badge";
import type { FeaturedJob, Tier } from "@/lib/api/schemas";
import { useRichMotion } from "@/lib/motion/hooks";
import { Tilt } from "@/lib/motion/tilt";
import { TIERS, TIER_META } from "@/lib/tier";

const SOURCE = { greenhouse: "Greenhouse", lever: "Lever", ashby: "Ashby" } as Record<string, string>;
const sourceName = (s: string) => SOURCE[s] ?? s;

function Card({ className, depth, children }: { className: string; depth: number; children: ReactNode }) {
  // Outer layer: position and parallax depth (driven by --px/--py). Inner: tilt + glare + glass.
  return (
    <div
      className={`lg:absolute ${className}`}
      style={{ transform: `translate3d(calc(var(--px, 0) * ${depth}px), calc(var(--py, 0) * ${depth}px), 0)`, transition: "transform 500ms ease-out" } as CSSProperties}
    >
      <Tilt glare lift={6} className="rounded-card">
        <div className="glass rounded-card p-4 sm:p-5">{children}</div>
      </Tilt>
    </div>
  );
}

function JobCard({ job }: { job?: FeaturedJob }) {
  if (!job) {
    // Nothing real to show: a clearly generic card. No company, no score, no invented numbers.
    return (
      <div role="group" aria-label="Your matches will appear here" className="rounded-control border border-dashed border-border-strong p-4">
        <div className="h-3 w-2/5 rounded-full bg-ink/10" aria-hidden />
        <div className="mt-3 h-4 w-4/5 rounded-full bg-ink/10" aria-hidden />
        <div className="mt-2 h-3 w-3/5 rounded-full bg-ink/10" aria-hidden />
        <p className="mt-4 text-small font-medium">Your matches appear here</p>
        <p className="text-caption text-muted">Create an account to see real openings, scored for you.</p>
      </div>
    );
  }
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {job.tier && <TierBadge tier={job.tier} short />}
        <span className="text-caption text-muted">Open role · via {sourceName(job.source)}</span>
      </div>
      <p className="mt-2.5 text-body font-semibold leading-snug">{job.title}</p>
      <p className="text-small text-muted">
        {job.company}
        {job.location ? ` · ${job.location}` : ""}
        {job.remote && !/remote/i.test(job.location) ? " · Remote" : ""}
      </p>
      <a
        href={job.apply_url}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-3 inline-flex items-center gap-1 text-small font-semibold text-primary hover:underline"
      >
        See the real posting
        <ArrowUpRight className="size-4" aria-hidden />
        <span className="sr-only"> (opens the company&apos;s page in a new tab)</span>
      </a>
    </>
  );
}

/**
 * Layered stack of glass cards in the hero. The job card is a REAL posting when the backend has one
 * (title, company, location, tier if known, source, the real link), otherwise a generic placeholder.
 * The other cards explain the product and contain no numbers: a visitor has no profile, so a match
 * score, draft or ATS score for them would be invented. Pointer parallax (fine pointers only)
 * moves each layer by its depth through two CSS variables.
 */
export function HeroStack({ jobs }: { jobs: FeaturedJob[] }) {
  const stack = useRef<HTMLDivElement>(null);
  const rich = useRichMotion();

  useEffect(() => {
    if (!rich || !stack.current) return;
    const el = stack.current;
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const r = el.getBoundingClientRect();
        el.style.setProperty("--px", Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width - 0.5) * 2)).toFixed(3));
        el.style.setProperty("--py", Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height - 0.5) * 2)).toFixed(3));
      });
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
    };
  }, [rich]);

  // One real job per tier where we have them, to fill the tier list honestly.
  const byTier = new Map<Tier, FeaturedJob>();
  for (const j of jobs) if (j.tier && !byTier.has(j.tier)) byTier.set(j.tier, j);

  return (
    <div ref={stack} className="relative grid gap-4 lg:block lg:h-[clamp(26rem,66svh,40rem)]">
      <Card className="lg:left-0 lg:top-[2%] lg:z-10 lg:w-[66%]" depth={14}>
        <JobCard job={jobs[0]} />
      </Card>

      <Card className="lg:right-0 lg:top-[27%] lg:z-20 lg:w-[62%]" depth={28}>
        <div className="flex items-center gap-2.5">
          <CheckCircle2 className="size-6 shrink-0 text-success-ink" aria-hidden />
          <p className="text-body font-semibold">Drafts you review</p>
        </div>
        <ul className="mt-2.5 space-y-1.5 text-small text-ink/85">
          <li>Written only from facts you can check</li>
          <li>A reviewer flags claims it cannot back up</li>
          <li>You edit, approve and send it yourself</li>
        </ul>
      </Card>

      <Card className="hidden lg:block lg:bottom-0 lg:left-[3%] lg:z-10 lg:w-[58%]" depth={8}>
        <p className="text-small font-semibold">Sorted by company type</p>
        <ul className="mt-2.5 space-y-2">
          {TIERS.map((t) => {
            const j = byTier.get(t);
            return (
              <li key={t} className="flex items-center gap-2.5">
                <TierBadge tier={t} short className="shrink-0" />
                <span className="truncate text-small text-ink/85">{j ? `${j.title}, ${j.company}` : TIER_META[t].blurb}</span>
              </li>
            );
          })}
        </ul>
      </Card>

      <Card className="hidden lg:block lg:bottom-[4%] lg:right-[2%] lg:z-30 lg:w-[34%]" depth={-12}>
        <div className="flex items-center gap-3">
          <svg viewBox="0 0 48 48" className="size-11 shrink-0" aria-hidden>
            <circle cx="24" cy="24" r="19" fill="none" stroke="var(--color-border-strong)" strokeWidth="5" strokeDasharray="4 5" />
          </svg>
          <div>
            <p className="flex items-center gap-1 text-small font-semibold">
              <ShieldCheck className="size-4 text-success-ink" aria-hidden /> ATS check
            </p>
            <p className="text-caption text-muted">Runs in your browser</p>
          </div>
        </div>
      </Card>
    </div>
  );
}
