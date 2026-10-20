import type { gsap } from "gsap";
import { ATS_FROM, ATS_TO, OUTREACH_SCORE, RING_C } from "./constants";

type Timeline = gsap.core.Timeline;

/**
 * One scrubbed timeline per pinned scene. These are PURE motion: they only touch elements the
 * static scenes already render (`[data-el="..."]`), and every timeline ENDS in the state the static
 * markup is already in, so the page looks the same with the motion layer on, off, or halfway.
 *
 * Rule: a scene is never blank. Every timeline STARTS from a complete, readable, on-screen state
 * (full opacity) and only MORPHS from there, e.g. skill chips begin on top of the resume and fly
 * into the profile; job cards begin as one pile and spread into their three columns. The only
 * elements allowed to start transparent are pure overlays whose counterpart is visible
 * (`scan`, `kw-found`): a test enforces this.
 *
 * Positions are FUNCTION-BASED values measured when ScrollTrigger refreshes (`invalidateOnRefresh`),
 * so they stay right after resize and once web fonts have loaded. Animate transform and opacity
 * only (plus stroke-dashoffset on SVG, and clip-path nowhere).
 */
export interface SceneTimeline {
  id: string;
  /** Scroll distance while pinned, in viewport heights. Short, so the page never feels stuck. */
  distance: number;
  build(tl: Timeline, el: HTMLElement): void;
}

const els = (root: HTMLElement, name: string) => root.querySelectorAll<HTMLElement>(`[data-el="${name}"]`);
const OUT = "power3.out";
/**
 * Centre of an element at REST (without any translate GSAP has applied). Rotation and scale act about
 * the centre, so they do not move it; only the translation has to be subtracted.
 */
function restCenter(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  const m = new DOMMatrix(getComputedStyle(el).transform === "none" ? undefined : getComputedStyle(el).transform);
  return { x: r.left + r.width / 2 - m.m41, y: r.top + r.height / 2 - m.m42 };
}

/** Offset (px) that moves `el` from its rest position onto `to`'s rest centre. */
function offsetTo(el: HTMLElement, to: HTMLElement | null) {
  if (!to) return { x: 0, y: 0 };
  const a = restCenter(el);
  const b = restCenter(to);
  return { x: b.x - a.x, y: b.y - a.y };
}

/** Write a rounded number into an element while a tween runs (the markup already holds the final value). */
function counter(tl: Timeline, target: HTMLElement | null, from: number, to: number, at: number | string, duration: number) {
  if (!target) return;
  const state = { v: from };
  tl.fromTo(state, { v: from }, { v: to, duration, ease: "none", onUpdate: () => void (target.textContent = String(Math.round(state.v))) }, at);
}

export const TIMELINES: SceneTimeline[] = [
  {
    id: "resume",
    distance: 0.7,
    build(tl, el) {
      const resume = el.querySelector<HTMLElement>('[data-el="resume"]');
      // Skills start ON the resume (as highlighted keywords) and travel into the profile card.
      tl.fromTo(els(el, "scan"), { opacity: 1, yPercent: -100 }, { yPercent: 520, duration: 0.8, ease: "none" })
        .to(els(el, "scan"), { opacity: 0, duration: 0.1 })
        .from(
          els(el, "chip"),
          {
            // A tidy 3x2 grid of highlighted keywords over the resume, so every chip is readable at the start.
            x: (i: number, t: HTMLElement) => offsetTo(t, resume).x + ((i % 3) - 1) * 70,
            y: (i: number, t: HTMLElement) => offsetTo(t, resume).y + (Math.floor(i / 3) - 0.5) * 44,
            scale: 0.8,
            duration: 0.9,
            stagger: 0.08,
            ease: "power3.inOut",
          },
          0.1,
        )
        .from(els(el, "profile"), { y: 24, scale: 0.97, duration: 0.8, ease: OUT }, 0);
    },
  },
  {
    id: "agents",
    distance: 0.8,
    build(tl, el) {
      const hub = el.querySelector<HTMLElement>('[data-el="hub"]');
      // Agents start tucked in around the orchestrator and fan out to their places while the lines draw.
      tl.from(
        els(el, "node"),
        {
          x: (_i: number, t: HTMLElement) => offsetTo(t, hub).x * 0.3,
          y: (_i: number, t: HTMLElement) => offsetTo(t, hub).y * 0.3,
          scale: 0.92,
          duration: 0.9,
          stagger: 0.07,
          ease: "power3.out",
        },
        0,
      )
        .fromTo(els(el, "line"), { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.7, stagger: 0.07, ease: "none" }, 0.1)
        .from(els(el, "status"), { scale: 0, duration: 0.25, stagger: 0.07 }, 0.5);
      // Each agent "wakes up" in turn.
      els(el, "node").forEach((n, i) => tl.to(n, { scale: 1.07, duration: 0.14, yoyo: true, repeat: 1, ease: "power1.inOut" }, 0.9 + i * 0.12));
    },
  },
  {
    id: "jobs",
    distance: 0.7,
    build(tl, el) {
      const stage = el.querySelector<HTMLElement>('[data-el="visual"]');
      // Cards start as one pile in the middle of the stage and spread into their tier columns.
      tl.from(
        els(el, "job"),
        {
          x: (i: number, t: HTMLElement) => offsetTo(t, stage).x + (i - 2.5) * 6,
          y: (i: number, t: HTMLElement) => offsetTo(t, stage).y + (i - 2.5) * 5,
          rotate: (i: number) => (i % 2 ? 5 : -5),
          scale: 0.94,
          duration: 0.9,
          stagger: 0.07,
          ease: "power3.inOut",
        },
        0,
      ).from(els(el, "column-head"), { y: -8, duration: 0.5, stagger: 0.1, ease: OUT }, 0.4);
    },
  },
  {
    id: "outreach",
    distance: 0.8,
    build(tl, el) {
      // The draft is fully visible from the start; lines are "typed in" by brightening one after another.
      tl.fromTo(els(el, "line"), { opacity: 0.32 }, { opacity: 1, duration: 0.45, stagger: 0.4, ease: "none" }, 0);
      tl.fromTo(els(el, "facts"), { y: 8, opacity: 0.4 }, { y: 0, opacity: 1, duration: 0.4 }, ">-0.2");
      counter(tl, el.querySelector<HTMLElement>('[data-el="score"]'), 0, OUTREACH_SCORE, ">-0.2", 0.8);
      tl.from(els(el, "approve"), { scale: 0.8, duration: 0.3, ease: "back.out(2)" });
    },
  },
  {
    id: "ats",
    distance: 0.7,
    build(tl, el) {
      tl.fromTo(els(el, "ring"), { strokeDashoffset: RING_C * (1 - ATS_FROM / 100) }, { strokeDashoffset: RING_C * (1 - ATS_TO / 100), duration: 1.1, ease: "none" }, 0);
      counter(tl, el.querySelector<HTMLElement>('[data-el="ats-score"]'), ATS_FROM, ATS_TO, 0, 1.1);
      // Keywords flip from "missing" to "found" as the score climbs (both layers are text, so nothing is blank).
      tl.fromTo(els(el, "kw-missing"), { opacity: 1 }, { opacity: 0, duration: 0.25, stagger: 0.16 }, 0.2)
        .fromTo(els(el, "kw-found"), { opacity: 0 }, { opacity: 1, duration: 0.25, stagger: 0.16 }, 0.2);
    },
  },
];
