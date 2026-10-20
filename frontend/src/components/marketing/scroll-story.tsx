"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useDisplayPrefs } from "@/lib/local/display-prefs";
import { TIMELINES } from "@/lib/marketing/timelines";

/** Reveal: one-shot, time-based (NOT scrubbed), when ~15% of the element is in view. */
export const REVEAL = { start: "top 85%", duration: 0.5, stagger: 0.06, y: 24, ease: "power3.out" } as const;
/** Smooth scrolling that follows the wheel closely (~0.9s settle, no extra lag on top of the scrub). */
export const LENIS = { duration: 0.9, wheelMultiplier: 1, syncTouch: false } as const;
const easeOutExpo = (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t));

/** Resolve once the page has loaded and the main thread is idle (or after a short cap). */
function whenIdle(): Promise<void> {
  return new Promise((resolve) => {
    const go = () => {
      const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
      if (ric) ric(() => resolve(), { timeout: 2500 });
      else setTimeout(resolve, 200);
    };
    if (document.readyState === "complete") go();
    else window.addEventListener("load", go, { once: true });
  });
}

/**
 * Motion layer for the homepage. EVERYTHING is progressive enhancement: the page is complete
 * static HTML, and this only adds, once the browser is idle and the user allows motion:
 *  - Lenis smooth scrolling, driven by GSAP's ticker so ScrollTrigger stays in sync;
 *  - time-based one-shot reveals on every `[data-reveal]` block (desktop and mobile);
 *  - on large screens, short pinned scenes (60-80% of a viewport of scroll) whose timelines are scrubbed:
 *    scrub is used ONLY where the scroll-linked morph is the point;
 * `gsap.matchMedia()` owns all of it, so crossing a breakpoint or toggling "reduce motion" tears
 * everything down and rebuilds it, and unmounting reverts every tween and trigger. GSAP, ScrollTrigger
 * and Lenis are imported dynamically here, so no other page ever downloads them.
 */
export function ScrollStory({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  // "Always reduce motion" in Settings turns the whole motion layer off (the OS setting is handled by the media queries below).
  const reduceByChoice = useDisplayPrefs().prefs.motion === "reduced";

  useEffect(() => {
    if (reduceByChoice) return;
    let cancelled = false;
    let teardown: (() => void) | undefined;

    (async () => {
      // The motion layer is not needed to paint or to read the page, so it waits for the browser
      // to be idle after load. That keeps GSAP and ScrollTrigger off the critical path and still
      // ready long before anyone scrolls.
      await whenIdle();
      if (cancelled) return;
      const [{ gsap }, { ScrollTrigger }, { default: Lenis }] = await Promise.all([import("gsap"), import("gsap/ScrollTrigger"), import("lenis")]);
      const scope = root.current;
      if (cancelled || !scope) return;
      gsap.registerPlugin(ScrollTrigger);

      const mm = gsap.matchMedia();
      mm.add(
        { desktop: "(min-width: 1024px) and (prefers-reduced-motion: no-preference)", mobile: "(max-width: 1023px) and (prefers-reduced-motion: no-preference)" },
        (context) => {
          const { desktop } = context.conditions as { desktop: boolean };

          const lenis = new Lenis({ autoRaf: false, easing: easeOutExpo, ...LENIS });
          lenis.on("scroll", ScrollTrigger.update);
          const raf = (t: number) => lenis.raf(t * 1000);
          gsap.ticker.add(raf);
          gsap.ticker.lagSmoothing(0);

          // One-shot, time-based reveals. Elements start hidden only when this runs and are revealed
          // as soon as ~15% is in view (already-visible ones reveal immediately), so nothing waits on scroll.
          const blocks = gsap.utils.toArray<HTMLElement>("[data-reveal]", scope);
          // Only blocks BELOW the reveal line start hidden; anything already in view stays put, so nothing flashes.
          gsap.set(blocks.filter((el) => el.getBoundingClientRect().top > window.innerHeight * 0.85), { y: REVEAL.y, opacity: 0 });
          ScrollTrigger.batch(blocks, {
            start: REVEAL.start,
            once: true,
            onEnter: (batch) => gsap.to(batch, { y: 0, opacity: 1, duration: REVEAL.duration, ease: REVEAL.ease, stagger: REVEAL.stagger, overwrite: true }),
          });

          if (desktop) {
            for (const scene of TIMELINES) {
              const el = scope.querySelector<HTMLElement>(`[data-scene="${scene.id}"]`);
              if (!el) continue;
              const tl = gsap.timeline({
                defaults: { ease: "power3.out" },
                scrollTrigger: {
                  trigger: el,
                  start: "top top",
                  end: `+=${Math.round(scene.distance * 100)}%`,
                  scrub: true, // Lenis already smooths the wheel; extra scrub easing would only add lag
                  pin: true,
                  anticipatePin: 1,
                  invalidateOnRefresh: true, // re-measure the morph offsets after resize / font load
                },
              });
              scene.build(tl, el);
            }
          }

          return () => {
            gsap.ticker.remove(raf);
            lenis.destroy();
          };
        },
        scope,
      );

      // Pin positions and morph offsets depend on layout, which moves when web fonts arrive.
      void document.fonts?.ready.then(() => !cancelled && ScrollTrigger.refresh());
      teardown = () => mm.revert();
    })();

    return () => {
      cancelled = true;
      teardown?.();
    };
  }, [reduceByChoice]);

  return <div ref={root}>{children}</div>;
}
