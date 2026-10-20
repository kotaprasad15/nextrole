"use client";

import { ArrowUp } from "lucide-react";
import { useEffect, useRef } from "react";
import { setActiveSection, useActiveSection } from "@/lib/marketing/active-section";

/**
 * Scroll-position indicator for the homepage: a ring that fills AND rotates with scroll progress,
 * with the current section's name beside it. It replaces the native scrollbar (hidden site-wide)
 * and, being informative, stays under reduced motion (it just updates without easing).
 *
 * Performance: a passive scroll listener coalesced to one rAF writes a CSS variable and a text
 * node through refs; React only re-renders when the SECTION changes. It does not depend on GSAP,
 * so it works before the motion layer loads and when it is switched off.
 */
export function ScrollRing() {
  const ring = useRef<HTMLDivElement>(null);
  const percent = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const label = useActiveSection();

  useEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const p = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      ring.current?.style.setProperty("--p", p.toFixed(4));
      const pct = String(Math.round(p * 100));
      if (percent.current && percent.current.textContent !== pct) {
        percent.current.textContent = pct;
        // The accessible name must contain the visible text (WCAG 2.5.3 label in name), so it carries the number too.
        button.current?.setAttribute("aria-label", `Back to top (${pct}% scrolled)`);
      }

      // The current section is the last one whose top has passed 45% of the viewport.
      let active: string | null = null;
      for (const el of document.querySelectorAll<HTMLElement>("[data-section]")) {
        if (el.getBoundingClientRect().top <= window.innerHeight * 0.45) active = el.dataset.section ?? active;
      }
      if (active) setActiveSection(active);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-40 flex items-center gap-3 sm:bottom-6 sm:right-6">
      <span className="glass hidden rounded-full px-3.5 py-1.5 text-small font-medium text-ink sm:inline-block" aria-hidden>
        {label}
      </span>
      <button
        ref={button}
        type="button"
        onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        aria-label="Back to top (0% scrolled)"
        data-cursor="link"
        className="group pointer-events-auto relative size-12 rounded-full sm:size-14"
      >
        <div ref={ring} style={{ "--p": 0 } as React.CSSProperties} className="absolute inset-0">
          {/* Track + fill. The conic gradient rotates with progress (transform only). */}
          <div className="absolute inset-0 rounded-full [background:conic-gradient(var(--color-primary)_calc(var(--p)*360deg),var(--color-border-strong)_0)] [transform:rotate(calc(var(--p)*360deg))]" />
        </div>
        <span className="glass absolute inset-[5px] grid place-items-center rounded-full text-ink">
          <span ref={percent} className="text-caption font-semibold tabular-nums group-hover:hidden">0</span>
          <ArrowUp className="hidden size-4 group-hover:block" aria-hidden />
        </span>
      </button>
    </div>
  );
}
