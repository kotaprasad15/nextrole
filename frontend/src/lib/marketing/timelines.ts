import type { gsap } from "gsap";
import { ATS_FROM, ATS_TO, OUTREACH_SCORE, RING_C } from "./constants";

type Timeline = gsap.core.Timeline;

/**
 * One scrubbed timeline per pinned scene. These are PURE motion: they only touch elements the
 * static scenes already render (`[data-el="..."]`), and every timeline ENDS in the state the
 * static markup is already in, so the page looks the same with the motion layer on, off, or
 * halfway through loading. Animate transform and opacity; clip-path is used only for the
 * typing reveal (scrubbed, short-lived). No numbers or text live here that the markup lacks.
 */
export interface SceneTimeline {
  id: string;
  /** Scroll distance while pinned, in viewport heights. Kept short so the page never feels stuck. */
  distance: number;
  build(tl: Timeline, el: HTMLElement): void;
}

const els = (root: HTMLElement, name: string) => root.querySelectorAll<HTMLElement>(`[data-el="${name}"]`);
const OUT = "power3.out";

/** Write a rounded number into an element while a tween runs (the markup already holds the final value). */
function counter(tl: Timeline, target: HTMLElement | null, from: number, to: number, at: number | string, duration: number) {
  if (!target) return;
  const state = { v: from };
  tl.fromTo(
    state,
    { v: from },
    { v: to, duration, ease: "none", onUpdate: () => void (target.textContent = String(Math.round(state.v))) },
    at,
  );
}

export const TIMELINES: SceneTimeline[] = [
  {
    id: "resume",
    distance: 1,
    build(tl, el) {
      tl.from(els(el, "resume"), { x: -70, opacity: 0, duration: 0.6, ease: OUT })
        .fromTo(els(el, "scan"), { opacity: 1, yPercent: -100 }, { yPercent: 520, duration: 0.9, ease: "none" })
        .to(els(el, "scan"), { opacity: 0, duration: 0.1 })
        .from(els(el, "profile"), { y: 36, opacity: 0, scale: 0.96, duration: 0.6, ease: OUT }, "-=0.3")
        .from(els(el, "chip"), { x: -90, y: 12, opacity: 0, scale: 0.7, duration: 0.5, stagger: 0.1, ease: "back.out(1.6)" }, "-=0.2");
    },
  },
  {
    id: "agents",
    distance: 1.2,
    build(tl, el) {
      tl.from(els(el, "hub"), { scale: 0.6, opacity: 0, duration: 0.5, ease: "back.out(1.5)" })
        .fromTo(els(el, "line"), { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.6, stagger: 0.12, ease: "none" }, "-=0.2")
        .from(els(el, "node"), { scale: 0.5, opacity: 0, duration: 0.4, stagger: 0.12, ease: "back.out(1.5)" }, "<0.2")
        .from(els(el, "status"), { scale: 0, duration: 0.2, stagger: 0.12 }, "<0.2");
      // Each agent "wakes up" in turn.
      els(el, "node").forEach((n) => tl.to(n, { scale: 1.08, duration: 0.15, yoyo: true, repeat: 1, ease: "power1.inOut" }));
    },
  },
  {
    id: "jobs",
    distance: 1,
    build(tl, el) {
      tl.from(els(el, "column-head"), { y: -12, opacity: 0, duration: 0.4, stagger: 0.12, ease: OUT })
        .from(els(el, "job"), { y: -80, opacity: 0, rotate: (i: number) => (i % 2 ? 4 : -4), duration: 0.6, stagger: 0.12, ease: "back.out(1.3)" }, "-=0.1");
    },
  },
  {
    id: "outreach",
    distance: 1.4,
    build(tl, el) {
      tl.from(els(el, "visual"), { y: 30, opacity: 0, duration: 0.4, ease: OUT })
        .from(els(el, "mail-head"), { opacity: 0, duration: 0.3 });
      // "Typing": each line is revealed left to right. The text is real and already in the DOM.
      tl.fromTo(els(el, "line"), { clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)", duration: 0.7, stagger: 0.55, ease: "none" });
      tl.from(els(el, "facts"), { opacity: 0, y: 8, duration: 0.4 }, ">-0.1");
      counter(tl, el.querySelector<HTMLElement>('[data-el="score"]'), 0, OUTREACH_SCORE, ">-0.1", 0.9);
      tl.from(els(el, "approve"), { scale: 0.7, opacity: 0, duration: 0.3, ease: "back.out(2)" });
    },
  },
  {
    id: "ats",
    distance: 1,
    build(tl, el) {
      tl.fromTo(els(el, "ring"), { strokeDashoffset: RING_C * (1 - ATS_FROM / 100) }, { strokeDashoffset: RING_C * (1 - ATS_TO / 100), duration: 1.2, ease: "none" });
      counter(tl, el.querySelector<HTMLElement>('[data-el="ats-score"]'), ATS_FROM, ATS_TO, "<", 1.2);
      // Keywords flip from "missing" to "found" as the score climbs.
      tl.fromTo(els(el, "kw-missing"), { opacity: 1 }, { opacity: 0, duration: 0.25, stagger: 0.18 }, 0.2)
        .fromTo(els(el, "kw-found"), { opacity: 0 }, { opacity: 1, duration: 0.25, stagger: 0.18 }, 0.2);
    },
  },
];
