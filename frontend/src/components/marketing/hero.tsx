import { ArrowDown, ArrowRight, FileSearch, ShieldCheck, UserCheck } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { FeaturedJob } from "@/lib/api/schemas";
import { HeroBackdrop } from "./hero-backdrop";
import { HeroStack } from "./hero-stack";

const HEADLINE = ["Find", "the", "role.", "Write", "the", "email."];

const TRUST = [
  { icon: ShieldCheck, text: "Real apply links" },
  { icon: UserCheck, text: "You approve every email" },
  { icon: FileSearch, text: "Facts sourced" },
];

/**
 * Hero. It plus the marquee under it fill the first screen exactly (`.hero-fill`, svh-based), with
 * the content vertically centred in two balanced columns: copy on the left, a layered stack of glass
 * cards on the right. The headline reveal is CSS only (per-word delay), so it never flashes before JS
 * and collapses to its final state under reduced motion.
 */
export function Hero({ jobs }: { jobs: FeaturedJob[] }) {
  return (
    <section data-section="Intro" aria-labelledby="hero-title" className="hero-fill relative isolate flex items-center overflow-hidden">
      <HeroBackdrop />

      <div className="marketing-container grid items-center gap-10 py-8 lg:grid-cols-2 lg:gap-12">
        <div>
          <p className="text-small font-medium text-primary-hover">Job search and outreach, with you in charge</p>
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
          <p className="mt-6 max-w-xl text-body-lg text-ink/75">
            Upload your resume, see real openings sorted by company type, and get outreach drafts that only use facts you can check. You read, edit and send them. NextRole never sends anything for you.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button asChild size="lg" magnetic fx="glow">
              <Link href="/signup">Get started <ArrowRight className="fx-arrow size-5 transition-transform" aria-hidden /></Link>
            </Button>
            <Button asChild size="lg" variant="secondary" fx="outline">
              <a href="#how-it-works">See how it works <ArrowDown className="size-5" aria-hidden /></a>
            </Button>
          </div>
          <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-small text-ink/85">
            {TRUST.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-2">
                <Icon className="size-4 text-success-ink" aria-hidden />
                {text}
              </li>
            ))}
          </ul>
        </div>

        <HeroStack jobs={jobs} />
      </div>
    </section>
  );
}
