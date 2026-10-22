"use client";

import { useEffect, useRef } from "react";
import { BLOBS, BLOB_PATHS, ORBS } from "@/lib/marketing/backdrop";
import { useReducedMotion, useRichMotion } from "@/lib/motion/hooks";

const CHIPS = [
  // Placed in the gutter and on the right half only, so no chip ever sits on top of the headline or copy.
  { label: "Python", tone: "text-ink", pos: "left-[47%] top-[9%]", dy: -70, delay: "0s" },
  { label: "Startups", tone: "text-startup-ink", pos: "right-[30%] top-[4%]", dy: -40, delay: "1.2s" },
  { label: "FastAPI", tone: "text-ink", pos: "right-[3%] top-[12%]", dy: -90, delay: "2.1s" },
  { label: "Mid-size", tone: "text-mid-ink", pos: "left-[48%] bottom-[14%]", dy: -50, delay: "0.6s" },
  { label: "PostgreSQL", tone: "text-ink", pos: "right-[2%] bottom-[2%]", dy: -80, delay: "1.7s" },
  { label: "MNCs", tone: "text-mnc-ink", pos: "left-[57%] bottom-[2%]", dy: -30, delay: "2.6s" },
] as const;

/**
 * Hero background: drifting colour orbs that lean toward the cursor, morphing organic blobs, a faint
 * shimmering dot grid, and floating glass chips that drift at different depths on scroll.
 * Purely decorative (aria-hidden, no pointer events). Everything animates transform or opacity,
 * except the SVG blob outlines, which are two small paths morphing via SMIL, paused when the hero
 * is off screen. Alphas live in lib/marketing/backdrop.ts and are checked against AA contrast.
 * Reduced motion: all of it is static (the SMIL animations are simply not rendered).
 */
export function HeroBackdrop() {
  const root = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const reduced = useReducedMotion();
  const rich = useRichMotion();

  // Orbs lean toward the cursor: one rAF-coalesced write of two CSS variables.
  useEffect(() => {
    if (!rich || !root.current) return;
    const el = root.current;
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        el.style.setProperty("--px", ((e.clientX / window.innerWidth - 0.5) * 2).toFixed(3));
        el.style.setProperty("--py", ((e.clientY / window.innerHeight - 0.5) * 2).toFixed(3));
      });
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
    };
  }, [rich]);

  // Pause the morph while the hero is off screen.
  useEffect(() => {
    const host = root.current;
    const s = svg.current;
    if (reduced || !host || !s || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => (entry.isIntersecting ? s.unpauseAnimations() : s.pauseAnimations()));
    io.observe(host);
    return () => io.disconnect();
  }, [reduced]);

  const morph = (dur: string, offset = 0) => {
    const ring = [...BLOB_PATHS.slice(offset), ...BLOB_PATHS.slice(0, offset)];
    return reduced ? null : (
      <animate attributeName="d" dur={dur} repeatCount="indefinite" calcMode="spline" values={[...ring, ring[0]].join(";")} keySplines=".45 0 .55 1;.45 0 .55 1;.45 0 .55 1;.45 0 .55 1" />
    );
  };

  return (
    <div ref={root} aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <div className="absolute inset-0 dark:opacity-55">
      {ORBS.map((o) => (
        <div
          key={o.token}
          className={`absolute ${o.at}`}
          style={{ width: o.size, height: o.size, transform: `translate3d(calc(var(--px, 0) * ${o.depth}px), calc(var(--py, 0) * ${o.depth}px), 0)`, transition: "transform 600ms ease-out" }}
        >
          <div
            className="size-full rounded-full"
            style={{
              background: `radial-gradient(circle at 50% 50%, var(--color-${o.token}) 0%, transparent 68%)`,
              opacity: o.alpha,
              animation: reduced ? undefined : `blob-drift ${o.drift} ease-in-out infinite`,
            }}
          />
        </div>
      ))}

      <svg ref={svg} viewBox="-120 -80 1040 760" preserveAspectRatio="xMidYMid meet" className="absolute -right-[6%] -top-[4%] h-[108%] w-[66%]">
        <defs>
          <linearGradient id="blob-a" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={`var(--color-${BLOBS[0].from})`} stopOpacity={BLOBS[0].fromAlpha} />
            <stop offset="1" stopColor={`var(--color-${BLOBS[0].to})`} stopOpacity={BLOBS[0].toAlpha} />
          </linearGradient>
          <linearGradient id="blob-b" x1="1" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={`var(--color-${BLOBS[1].from})`} stopOpacity={BLOBS[1].fromAlpha} />
            <stop offset="1" stopColor={`var(--color-${BLOBS[1].to})`} stopOpacity={BLOBS[1].toAlpha} />
          </linearGradient>
        </defs>
        <path d={BLOB_PATHS[0]} fill="url(#blob-a)">{morph("16s")}</path>
        <path d={BLOB_PATHS[1]} fill="url(#blob-b)" transform="translate(-60 60) scale(0.85)">{morph("20s", 1)}</path>
      </svg>
      </div>

      <div
        className="absolute inset-0 [animation:grid-shimmer_9s_ease-in-out_infinite]"
        style={{
          backgroundImage: "radial-gradient(var(--color-ink) 1px, transparent 1px)",
          backgroundSize: "26px 26px",
          opacity: 0.05,
          WebkitMaskImage: "radial-gradient(ellipse at 50% 45%, #000 25%, transparent 72%)",
          maskImage: "radial-gradient(ellipse at 50% 45%, #000 25%, transparent 72%)",
          animation: reduced ? "none" : undefined,
        }}
      />

      {CHIPS.map((c) => (
        <div key={c.label} className={`chip-drift absolute ${c.pos} hidden md:block`} style={{ "--dy": `${c.dy}px` } as React.CSSProperties}>
          <span
            className={`glass inline-block rounded-full px-3.5 py-1.5 text-small font-medium ${c.tone}`}
            style={{ animation: reduced ? undefined : `chip-float 7s ease-in-out ${c.delay} infinite` }}
          >
            {c.label}
          </span>
        </div>
      ))}
    </div>
  );
}
