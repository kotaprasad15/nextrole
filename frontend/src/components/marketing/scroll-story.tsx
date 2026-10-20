"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useDisplayPrefs } from "@/lib/local/display-prefs";
import { TIMELINES } from "@/lib/marketing/timelines";

/**
 * Motion layer for the homepage. EVERYTHING is progressive enhancement: the page is complete
 * static HTML, and this only adds, once the browser is idle and the user allows motion:
 *  - Lenis smooth scrolling, driven by GSAP's ticker so ScrollTrigger stays in sync;
 *  - on large screens, short pinned scenes whose timelines are scrubbed by scroll;
 *  - on small screens, simple fade-up reveals (no pinning: pinning fights mobile browser chrome);
 *  - a slim reading-progress bar.
 * `gsap.matchMedia()` owns all of it, so crossing a breakpoint or toggling "reduce motion" tears
 * everything down and rebuilds it, and unmounting reverts every tween and trigger. GSAP, ScrollTrigger
 * and Lenis are imported dynamically here, so no other page ever downloads them.
 */
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

export function ScrollStory({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  // "Always reduce motion" in Settings turns the whole motion layer off (the OS setting is handled by the media queries below).
  const reduceByChoice = useDisplayPrefs().prefs.motion === "reduced";

  useEffect(() => {
    if (reduceByChoice) return;
    let cancelled = false;
    let teardown: (() => void) | undefined;

    (async () => {
      // The motion layer is not needed to paint or to read the page, so it waits for the browser
      // to be idle after load. That keeps the ~140 KB of GSAP and ScrollTrigger off the critical path
      // (first paint, LCP and input delay) and still ready long before anyone scrolls.
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

          const lenis = new Lenis({ autoRaf: false, lerp: 0.1 });
          lenis.on("scroll", ScrollTrigger.update);
          const raf = (t: number) => lenis.raf(t * 1000);
          gsap.ticker.add(raf);
          gsap.ticker.lagSmoothing(0);

          if (bar.current) {
            gsap.set(bar.current, { scaleX: 0, transformOrigin: "left center" });
            ScrollTrigger.create({
              start: 0,
              end: "max",
              onUpdate: (self) => void (bar.current && gsap.set(bar.current, { scaleX: self.progress })),
            });
          }

          if (desktop) {
            for (const scene of TIMELINES) {
              const el = scope.querySelector<HTMLElement>(`[data-scene="${scene.id}"]`);
              if (!el) continue;
              const tl = gsap.timeline({
                defaults: { ease: "power3.out" },
                scrollTrigger: { trigger: el, start: "top top", end: `+=${Math.round(scene.distance * 100)}%`, scrub: 0.6, pin: true, anticipatePin: 1 },
              });
              scene.build(tl, el);
            }
          } else {
            // Small screens: no pinning. Each block fades up once as it enters.
            gsap.utils.toArray<HTMLElement>("[data-reveal]", scope).forEach((el) => {
              gsap.from(el, { y: 28, opacity: 0, duration: 0.7, ease: "power3.out", scrollTrigger: { trigger: el, start: "top 88%", once: true } });
            });
          }

          return () => {
            gsap.ticker.remove(raf);
            lenis.destroy();
          };
        },
        scope,
      );

      // Pin positions depend on layout, which moves when web fonts arrive.
      void document.fonts?.ready.then(() => !cancelled && ScrollTrigger.refresh());
      teardown = () => mm.revert();
    })();

    return () => {
      cancelled = true;
      teardown?.();
    };
  }, [reduceByChoice]);

  return (
    <div ref={root}>
      <div ref={bar} aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 origin-left scale-x-0 bg-primary" />
      {children}
    </div>
  );
}
