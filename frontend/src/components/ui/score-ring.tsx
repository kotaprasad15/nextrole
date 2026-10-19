"use client";

import { animate, motion, useInView, useMotionValue, useTransform } from "framer-motion";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/cn";
import { useReducedMotion } from "@/lib/motion/hooks";
import { ease } from "@/lib/motion/tokens";
import { TIER_META, type Tier } from "@/lib/tier";

type Tone = "auto" | "primary" | Tier;

/** Ring stroke colours are fills (not text), so the light brand shades are fine here. */
function strokeFor(tone: Tone, value: number) {
  if (tone === "primary") return "var(--color-primary)";
  if (tone === "startup" || tone === "mid" || tone === "mnc") return TIER_META[tone].ring;
  if (value >= 75) return "var(--color-success)";
  if (value >= 50) return "var(--color-warning)";
  return "var(--color-danger)";
}

/**
 * Circular score (0 to 100). It renders at 0 on server and client (so hydration always
 * matches), then animates to `value` once it scrolls into view and again whenever `value`
 * changes. With reduced motion it jumps straight to the final value. The accessible name
 * always states the real score, regardless of animation state.
 */
export function ScoreRing({
  value,
  size = 72,
  stroke = 7,
  tone = "auto",
  label = "score",
  caption,
  className,
}: {
  value: number;
  size?: number;
  stroke?: number;
  tone?: Tone;
  label?: string;
  caption?: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.4 });
  const reduced = useReducedMotion();
  const v = Math.max(0, Math.min(100, value));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const progress = useMotionValue(0);
  const offset = useTransform(progress, (p) => c * (1 - p / 100));
  const shown = useTransform(progress, (p) => Math.round(p));

  useEffect(() => {
    if (reduced) {
      progress.set(v);
      return;
    }
    if (!inView) return;
    const controls = animate(progress, v, { duration: 0.9, ease: ease.out });
    return () => controls.stop();
  }, [v, reduced, inView, progress]);

  return (
    <div
      ref={ref}
      role="img"
      aria-label={`${label}: ${Math.round(v)} out of 100`}
      className={cn("relative inline-grid shrink-0 place-items-center", className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-border)" strokeWidth={stroke} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={strokeFor(tone, v)}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          style={{ strokeDashoffset: offset }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center" aria-hidden>
        <div className="leading-none">
          <motion.span className="font-semibold tabular-nums" style={{ fontSize: size * 0.3 }}>
            {shown}
          </motion.span>
          {caption && <span className="mt-0.5 block text-caption text-muted">{caption}</span>}
        </div>
      </div>
    </div>
  );
}
