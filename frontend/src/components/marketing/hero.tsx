import { ArrowDown, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { TierBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScoreRing } from "@/components/ui/score-ring";

const HEADLINE = ["Find", "the", "role.", "Write", "the", "email."];

/**
 * Hero. The headline reveal is CSS only (per-word delay), so it never flashes before JS runs and
 * collapses to the final state under reduced motion. Cards are labelled sample data.
 */
export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="relative isolate overflow-hidden">
      {/* Soft colour mesh: three tier-coloured blobs, very light, drifting slowly. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -left-32 -top-24 size-[28rem] animate-[blob-drift_18s_ease-in-out_infinite] rounded-full bg-startup/15 blur-3xl" />
        <div className="absolute left-1/3 top-1/2 size-[26rem] animate-[blob-drift_22s_ease-in-out_infinite_reverse] rounded-full bg-mid/15 blur-3xl" />
        <div className="absolute -right-24 -top-10 size-[28rem] animate-[blob-drift_20s_ease-in-out_infinite] rounded-full bg-mnc/15 blur-3xl" />
      </div>

      <div className="page-container grid items-center gap-12 py-16 lg:min-h-[calc(100vh-4rem)] lg:grid-cols-[1.1fr_0.9fr] lg:py-20">
        <div>
          <p className="text-small font-medium text-primary">Job search and outreach, with you in charge</p>
          <h1 id="hero-title" className="mt-4 font-display text-display-xl text-balance">
            {HEADLINE.map((w, i) => (
              <span
                key={i}
                className={i >= 3 ? "inline-block italic text-primary [animation:word-rise_700ms_cubic-bezier(0.22,1,0.36,1)_both]" : "inline-block [animation:word-rise_700ms_cubic-bezier(0.22,1,0.36,1)_both]"}
                style={{ animationDelay: `${i * 90}ms` }}
              >
                {w}
                {i < HEADLINE.length - 1 ? " " : ""}
              </span>
            ))}
          </h1>
          <p className="mt-6 max-w-xl text-body-lg text-muted">
            Upload your resume, see real openings sorted by company type, and get outreach drafts that only use facts you can check. You read, edit and send them. NextRole never sends anything for you.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button asChild size="lg" magnetic>
              <Link href="/signup">Get started</Link>
            </Button>
            <Button asChild size="lg" variant="secondary">
              <a href="#how-it-works">See how it works <ArrowDown className="size-5" aria-hidden /></a>
            </Button>
          </div>
        </div>

        <div aria-hidden className="relative mx-auto w-full max-w-md">
          <div className="animate-[float-slow_7s_ease-in-out_infinite] rounded-card border border-border bg-surface p-5 shadow-3">
            <div className="flex items-start justify-between gap-4">
              <div>
                <TierBadge tier="startup" short />
                <p className="mt-2 font-semibold">Software Engineer, Platform</p>
                <p className="text-small text-muted">Lumen Labs · Remote (EU)</p>
              </div>
              <ScoreRing value={86} tone="startup" size={64} label="Sample match score" caption="match" />
            </div>
            <p className="mt-3 text-small text-ink/80">Your FastAPI and PostgreSQL work matches their API-first stack.</p>
          </div>
          <div className="ml-auto mt-4 flex w-[85%] animate-[float-slow_9s_ease-in-out_infinite_reverse] items-center gap-3 rounded-card border border-border bg-surface p-4 shadow-2">
            <CheckCircle2 className="size-6 shrink-0 text-success-ink" />
            <div>
              <p className="text-small font-semibold">Draft ready for your review</p>
              <p className="text-caption text-muted">Reviewer 92/100 · 6 sourced facts</p>
            </div>
          </div>
          <p className="mt-3 text-center text-caption text-muted">Sample data, for illustration.</p>
        </div>
      </div>
    </section>
  );
}
