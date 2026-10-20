"use client";

import { Pause, Play } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { useReducedMotion } from "@/lib/motion/hooks";
import { TIER_META, type Tier } from "@/lib/tier";

type Chip = { label: string; tier?: Tier };

const CHIPS: Chip[] = [
  { label: "Startups", tier: "startup" },
  { label: "Backend Engineer" },
  { label: "Python" },
  { label: "Mid-size", tier: "mid" },
  { label: "Data Analyst" },
  { label: "PostgreSQL" },
  { label: "MNCs", tier: "mnc" },
  { label: "Product Manager" },
  { label: "FastAPI" },
  { label: "Startups", tier: "startup" },
  { label: "Frontend Engineer" },
  { label: "React" },
  { label: "Mid-size", tier: "mid" },
  { label: "ML Engineer" },
  { label: "Docker" },
  { label: "MNCs", tier: "mnc" },
];

function Track({ hidden }: { hidden?: boolean }) {
  return (
    <ul aria-hidden={hidden || undefined} className="flex shrink-0 items-center gap-3 pr-3">
      {CHIPS.map((c, i) => (
        <li
          key={i}
          className={cn(
            "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-1.5 text-small font-medium",
            c.tier ? `${TIER_META[c.tier].tint} ${TIER_META[c.tier].text}` : "glass text-ink",
          )}
        >
          {c.tier && <span aria-hidden className={cn("size-1.5 rounded-full", TIER_META[c.tier].swatch)} />}
          {c.label}
        </li>
      ))}
    </ul>
  );
}

/**
 * The band directly under the hero: tier-coloured chips (company types, roles, skills) scrolling
 * continuously. It pauses on hover and focus, and has a real Pause button (keyboard and touch users
 * cannot hover), since moving content over 5 seconds needs a way to stop it. The second copy of
 * the track is aria-hidden so screen readers get the list once. Reduced motion: a static, wrapped row.
 */
export function TierMarquee() {
  const reduced = useReducedMotion();
  const [paused, setPaused] = useState(false);

  return (
    <div
      role="group"
      aria-label="Company types, roles and skills NextRole works with"
      data-paused={paused}
      className="marquee relative flex h-[var(--marquee-h)] items-center overflow-hidden border-y border-border/70 bg-surface/60"
    >
      {reduced ? (
        <div className="marketing-container flex flex-wrap gap-2 py-2"><Track /></div>
      ) : (
        <>
          <div
            className="marquee-track flex w-max will-change-transform"
            style={{ WebkitMaskImage: "linear-gradient(90deg, transparent, #000 6%, #000 94%, transparent)", maskImage: "linear-gradient(90deg, transparent, #000 6%, #000 94%, transparent)" }}
          >
            <Track />
            <Track hidden />
          </div>
          <button
            type="button"
            onClick={() => setPaused((p) => !p)}
            aria-pressed={paused}
            aria-label={paused ? "Play the scrolling band" : "Pause the scrolling band"}
            data-cursor="link"
            className="glass absolute left-3 top-1/2 z-10 grid size-9 -translate-y-1/2 place-items-center rounded-full text-ink"
          >
            {paused ? <Play className="size-4" aria-hidden /> : <Pause className="size-4" aria-hidden />}
          </button>
        </>
      )}
    </div>
  );
}
