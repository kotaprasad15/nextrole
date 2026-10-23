import { readFileSync } from "node:fs";
import path from "node:path";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TIMELINES } from "@/lib/marketing/timelines";

// ---- A controllable stand-in for gsap / ScrollTrigger / Lenis, to test OUR wiring ----
const state = { desktop: false, mobile: false, timelines: [] as { scrollTrigger: Record<string, unknown> }[], batches: [] as Record<string, unknown>[], lenisOptions: [] as Record<string, unknown>[], reverted: 0, lenisCreated: 0, lenisDestroyed: 0, tickerAdded: 0, tickerRemoved: 0 };

vi.mock("gsap", () => {
  const timeline = (vars: { scrollTrigger: Record<string, unknown> }) => {
    state.timelines.push(vars);
    const tl: Record<string, unknown> = {};
    for (const m of ["from", "fromTo", "to", "set"]) tl[m] = () => tl;
    return tl;
  };
  const gsap = {
    registerPlugin: () => {},
    timeline,
    set: () => {},
    to: () => ({}),
    utils: { toArray: (sel: string, scope: HTMLElement) => Array.from(scope.querySelectorAll(sel)) },
    ticker: { add: () => void state.tickerAdded++, remove: () => void state.tickerRemoved++, lagSmoothing: () => {} },
    matchMedia: () => {
      let cleanup: (() => void) | void;
      return {
        add: (_conds: unknown, fn: (c: { conditions: Record<string, boolean> }) => (() => void) | void) => {
          if (state.desktop || state.mobile) cleanup = fn({ conditions: { desktop: state.desktop, mobile: state.mobile } });
        },
        revert: () => {
          state.reverted++;
          cleanup?.();
        },
      };
    },
  };
  return { gsap, default: gsap };
});
vi.mock("gsap/ScrollTrigger", () => ({
  ScrollTrigger: { create: () => ({}), update: () => {}, refresh: () => {}, batch: (_t: unknown, vars: Record<string, unknown>) => void state.batches.push(vars) },
}));
vi.mock("lenis", () => ({
  default: class {
    constructor(options: Record<string, unknown>) {
      state.lenisCreated++;
      state.lenisOptions.push(options);
    }
    on() {}
    raf() {}
    destroy() {
      state.lenisDestroyed++;
    }
  },
}));

import { Faq, FAQS, FinalCta } from "./faq-cta";
import { Hero } from "./hero";
import { SceneAgents } from "./scene-agents";
import { SceneAts } from "./scene-ats";
import { SceneJobs } from "./scene-jobs";
import { SceneOutreach } from "./scene-outreach";
import { SceneResume } from "./scene-resume";
import { LENIS, REVEAL, ScrollStory } from "./scroll-story";
import { HomeBody } from "@/components/marketing/home-body";

const SCENES = { resume: SceneResume, agents: SceneAgents, jobs: SceneJobs, outreach: SceneOutreach, ats: SceneAts } as const;

beforeEach(() => {
  Object.assign(state, { desktop: false, mobile: false, timelines: [], batches: [], lenisOptions: [], reverted: 0, lenisCreated: 0, lenisDestroyed: 0, tickerAdded: 0, tickerRemoved: 0 });
});
afterEach(() => vi.restoreAllMocks());

describe("static content (no JS, no motion)", () => {
  it("renders the full story as plain headings and copy", () => {
    render(<TooltipProvider><HomeBody hero={<Hero jobs={[]} />} /></TooltipProvider>);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Find the role. Write the email.");
    for (const name of [/Drop it in/, /A small team of agents|Each agent has one job/, /Startups, mid-size companies and MNCs/, /A draft built only from facts/, /See which keywords a filter would catch/, /Questions, answered plainly/, /Ready to find your next role/]) {
      expect(screen.getByRole("heading", { level: 2, name })).toBeInTheDocument();
    }
    expect(screen.getByRole("link", { name: "Get started" })).toHaveAttribute("href", "/signup");
    expect(screen.getByRole("link", { name: /see how it works/i })).toHaveAttribute("href", "#how-it-works");
  });

  it("never hides meaningful content by default (only decorative, aria-hidden bits start transparent)", () => {
    const { container } = render(<TooltipProvider><HomeBody hero={<Hero jobs={[]} />} /></TooltipProvider>);
    for (const el of container.querySelectorAll(".opacity-0")) {
      expect(el.closest("[aria-hidden='true']"), `${el.outerHTML.slice(0, 80)} is hidden but not decorative`).not.toBeNull();
    }
  });

  it("labels the illustrative scene mock-ups, and the hero carries no fake data or caption", () => {
    render(<TooltipProvider><HomeBody hero={<Hero jobs={[]} />} /></TooltipProvider>);
    // The resume, jobs, outreach and ATS scenes are mock-ups and say so; the hero is real-or-generic and needs no caption.
    expect(screen.getAllByText(/for illustration/i)).toHaveLength(4);
    const hero = document.querySelector('[data-section="Intro"]')!;
    expect(hero.textContent).not.toMatch(/illustration|sample data|\d+\s*match|Reviewer \d+|Lumen/i);
  });

  it("makes every agent reachable by keyboard with its description", () => {
    render(<TooltipProvider><SceneAgents /></TooltipProvider>);
    const nodes = screen.getAllByRole("button", { name: /Discovery:|Tiering:|Matcher:|Researcher:|Writer:|Critic:/ });
    expect(nodes).toHaveLength(6);
    expect(screen.getByRole("button", { name: /Critic: .*rewrite/i })).toBeInTheDocument();
  });

  it("FAQ answers open and close with the keyboard-friendly details element", async () => {
    const user = userEvent.setup();
    render(<Faq />);
    const first = screen.getByText(FAQS[0].q);
    expect(first.closest("details")).not.toHaveAttribute("open");
    await user.click(first);
    expect(first.closest("details")).toHaveAttribute("open");
    expect(within(first.closest("details")!).getByText(/no send button/i)).toBeInTheDocument();
  });

  it("final call to action links to sign up and log in", () => {
    render(<FinalCta />);
    expect(screen.getByRole("link", { name: "Create your account" })).toHaveAttribute("href", "/signup");
    expect(screen.getByRole("link", { name: "Log in" })).toHaveAttribute("href", "/login");
  });

  it("hero headline words carry staggered CSS delays", () => {
    render(<Hero jobs={[]} />);
    const words = screen.getByRole("heading", { level: 1 }).querySelectorAll("span");
    expect(words).toHaveLength(6);
    expect((words[5] as HTMLElement).style.animationDelay).toBe("450ms");
  });
});

describe("spacing rules", () => {
  const css = readFileSync(path.resolve(__dirname, "../../app/globals.css"), "utf-8");

  it("scenes are compact by default and only become viewport-tall stages where the pin runs", () => {
    expect(css).toMatch(/\.scene \{\s*padding-bottom: var\(--scene-gap\);/);
    expect(css).toMatch(/@media \(min-width: 1024px\) and \(prefers-reduced-motion: no-preference\) \{\s*html:not\(\[data-motion="reduced"\]\) \.scene \{\s*min-height: 100svh;/);
    const { container } = render(<TooltipProvider><SceneResume /></TooltipProvider>);
    expect(container.querySelector("[data-scene]")!.className).toMatch(/\bscene\b/);
    expect(container.querySelector("[data-scene]")!.className).not.toMatch(/min-h-/);
  });

  it("the gap between chapters is 24-32px on phones and at most 56px on desktop", () => {
    const m = css.match(/--scene-gap:\s*clamp\(([\d.]+)rem,\s*([\d.]+)rem \+ ([\d.]+)vw,\s*([\d.]+)rem\)/)!;
    const [min, base, vw, max] = [Number(m[1]) * 16, Number(m[2]) * 16, Number(m[3]), Number(m[4]) * 16];
    const at = (w: number) => Math.min(max, Math.max(min, base + (w * vw) / 100));
    for (const w of [360, 390, 430, 600, 767]) {
      expect(at(w), `${w}px`).toBeGreaterThanOrEqual(24);
      expect(at(w), `${w}px`).toBeLessThanOrEqual(32);
    }
    for (const w of [1024, 1280, 1920, 3840]) {
      expect(at(w), `${w}px`).toBeGreaterThanOrEqual(32);
      expect(at(w), `${w}px`).toBeLessThanOrEqual(56);
    }
  });

  it("the vertical rhythm never exceeds 64px on phones and 96px on desktop", () => {
    // --section-y is clamp(2.5rem, 5vw, 6rem): 40px on a 375px phone, 96px cap on desktop
    const m = css.match(/--section-y:\s*clamp\(([\d.]+)rem,\s*([\d.]+)vw,\s*([\d.]+)rem\)/)!;
    const [min, vw, max] = [Number(m[1]) * 16, Number(m[2]), Number(m[3]) * 16];
    expect(Math.min(max, Math.max(min, (375 * vw) / 100))).toBeLessThanOrEqual(64);
    expect(max).toBeLessThanOrEqual(96);
    // Section-level padding must come from the shared scale (var(--section-y)), never a numeric py-/pt-/pb- utility.
    for (const f of ["faq-cta.tsx", "scene-shell.tsx", "hero.tsx"]) {
      const sections = readFileSync(path.resolve(__dirname, f), "utf-8").match(/<section[\s\S]*?>/g) ?? [];
      expect(sections.length).toBeGreaterThan(0);
      for (const tag of sections) expect(tag, `${f}: ${tag.slice(0, 60)}`).not.toMatch(/\b(?:lg:)?p[ytb]-\d/);
    }
  });
});

describe("timeline contract", () => {
  it("has exactly one timeline per pinned scene, with short pin distances", () => {
    expect(TIMELINES.map((t) => t.id).sort()).toEqual(Object.keys(SCENES).sort());
    for (const t of TIMELINES) {
      // 60-80% of a viewport of scroll per pinned scene
      expect(t.distance).toBeGreaterThanOrEqual(0.6);
      expect(t.distance).toBeLessThanOrEqual(0.8);
    }
  });

  for (const t of TIMELINES) {
    it(`"${t.id}" only targets elements its scene renders, and ends where the static markup is`, () => {
      const Scene = SCENES[t.id as keyof typeof SCENES];
      const { container } = render(<TooltipProvider><Scene /></TooltipProvider>);
      const root = container.querySelector<HTMLElement>(`[data-scene="${t.id}"]`)!;
      expect(root).toBeTruthy();

      const targets: unknown[] = [];
      const calls: { method: string; vars: Record<string, unknown>[] }[] = [];
      const tl: Record<string, unknown> = {};
      for (const m of ["from", "fromTo", "to", "set"]) {
        tl[m] = (target: unknown, ...vars: Record<string, unknown>[]) => {
          targets.push(target);
          calls.push({ method: m, vars });
          return tl;
        };
      }
      t.build(tl as never, root);

      expect(targets.length).toBeGreaterThan(0);
      for (const target of targets) {
        if (target instanceof NodeList) expect(target.length, "a selector matched nothing").toBeGreaterThan(0);
      }
      // Scrubbed tweens must not leave the page in a different state than the static markup.
      for (const c of calls) for (const v of c.vars) expect(v).not.toHaveProperty("display");
    });
  }

  it("no scene starts blank: only decorative overlays may start transparent", () => {
    const OVERLAYS = new Set(["scan", "kw-found"]); // their counterpart (the resume / the "missing" label) is visible
    for (const t of TIMELINES) {
      const Scene = SCENES[t.id as keyof typeof SCENES];
      const { container, unmount } = render(<TooltipProvider><Scene /></TooltipProvider>);
      const root = container.querySelector<HTMLElement>(`[data-scene="${t.id}"]`)!;
      const bad: string[] = [];
      const tl: Record<string, unknown> = {};
      for (const m of ["from", "fromTo", "to", "set"]) {
        tl[m] = (target: unknown, ...vars: Record<string, unknown>[]) => {
          const startVars = m === "from" ? vars[0] : m === "fromTo" ? vars[0] : null; // the state at progress 0
          if (startVars && target instanceof NodeList && startVars.opacity !== undefined && Number(startVars.opacity) < 0.3) {
            const name = (target[0] as HTMLElement).dataset.el ?? "?";
            if (!OVERLAYS.has(name)) bad.push(`${t.id}: [data-el=${name}] starts at opacity ${startVars.opacity}`);
          }
          return tl;
        };
      }
      t.build(tl as never, root);
      expect(bad).toEqual([]);
      unmount();
    }
  });

  it("the counters in the markup already hold their final values", () => {
    render(<TooltipProvider><SceneOutreach /><SceneAts /></TooltipProvider>);
    expect(document.querySelector('[data-el="score"]')).toHaveTextContent("92");
    expect(document.querySelector('[data-el="ats-score"]')).toHaveTextContent("87");
  });
});

describe("ScrollStory wiring", () => {
  const mount = () =>
    render(
      <ScrollStory>
        {TIMELINES.map((t) => <section key={t.id} data-scene={t.id}><div data-reveal /></section>)}
      </ScrollStory>,
    );

  it("does nothing when motion is reduced (neither media query matches)", async () => {
    mount();
    await new Promise((r) => setTimeout(r, 30));
    expect(state.lenisCreated).toBe(0);
    expect(state.timelines).toHaveLength(0);
  });

  it("on desktop: Lenis tuned for responsiveness, one-shot reveals, and a short scrubbed pin per scene", async () => {
    state.desktop = true;
    mount();
    await waitFor(() => expect(state.timelines).toHaveLength(TIMELINES.length));
    expect(state.lenisCreated).toBe(1);
    expect(state.lenisOptions[0]).toMatchObject({ duration: 0.9, syncTouch: false });
    for (const tl of state.timelines) expect(tl.scrollTrigger).toMatchObject({ pin: true, start: "top top", scrub: true, invalidateOnRefresh: true });
    expect(state.timelines[0].scrollTrigger.end).toBe("+=70%");
    // Reveals are time-based and one-shot, not scrubbed.
    expect(state.batches).toHaveLength(1);
    expect(state.batches[0]).toMatchObject({ start: "top 85%", once: true });
    expect(state.batches[0]).not.toHaveProperty("scrub");
  });

  it("on small screens: the same one-shot reveals, no pinning", async () => {
    state.mobile = true;
    mount();
    await waitFor(() => expect(state.batches).toHaveLength(1));
    expect(state.batches[0]).toMatchObject({ start: "top 85%", once: true });
    expect(state.timelines).toHaveLength(0);
  });

  it("reveal and smooth-scroll settings stay inside the agreed ranges", () => {
    expect(REVEAL.duration).toBeGreaterThanOrEqual(0.4);
    expect(REVEAL.duration).toBeLessThanOrEqual(0.6);
    expect(REVEAL.stagger).toBe(0.06);
    expect(LENIS.duration).toBeGreaterThanOrEqual(0.8);
    expect(LENIS.duration).toBeLessThanOrEqual(1);
  });

  it("tears everything down on unmount", async () => {
    state.desktop = true;
    const { unmount } = mount();
    await waitFor(() => expect(state.lenisCreated).toBe(1));
    unmount();
    expect(state.reverted).toBe(1);
    expect(state.lenisDestroyed).toBe(1);
    expect(state.tickerRemoved).toBe(state.tickerAdded);
  });
});
