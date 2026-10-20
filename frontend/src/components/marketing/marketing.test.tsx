import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TIMELINES } from "@/lib/marketing/timelines";

// ---- A controllable stand-in for gsap / ScrollTrigger / Lenis, to test OUR wiring ----
const state = { desktop: false, mobile: false, timelines: [] as { scrollTrigger: Record<string, unknown> }[], reveals: 0, reverted: 0, lenisCreated: 0, lenisDestroyed: 0, tickerAdded: 0, tickerRemoved: 0 };

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
    from: () => void state.reveals++,
    set: () => {},
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
vi.mock("gsap/ScrollTrigger", () => ({ ScrollTrigger: { create: () => ({}), update: () => {}, refresh: () => {} } }));
vi.mock("lenis", () => ({
  default: class {
    constructor() {
      state.lenisCreated++;
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
import { ScrollStory } from "./scroll-story";
import Home from "@/app/(marketing)/page";

const SCENES = { resume: SceneResume, agents: SceneAgents, jobs: SceneJobs, outreach: SceneOutreach, ats: SceneAts } as const;

beforeEach(() => {
  Object.assign(state, { desktop: false, mobile: false, timelines: [], reveals: 0, reverted: 0, lenisCreated: 0, lenisDestroyed: 0, tickerAdded: 0, tickerRemoved: 0 });
});
afterEach(() => vi.restoreAllMocks());

describe("static content (no JS, no motion)", () => {
  it("renders the full story as plain headings and copy", () => {
    render(<TooltipProvider><Home /></TooltipProvider>);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Find the role. Write the email.");
    for (const name of [/Drop it in/, /A small team of agents|Each agent has one job/, /Startups, mid-size companies and MNCs/, /A draft built only from facts/, /See which keywords a filter would catch/, /Questions, answered plainly/, /Ready to find your next role/]) {
      expect(screen.getByRole("heading", { level: 2, name })).toBeInTheDocument();
    }
    expect(screen.getByRole("link", { name: "Get started" })).toHaveAttribute("href", "/signup");
    expect(screen.getByRole("link", { name: /see how it works/i })).toHaveAttribute("href", "#how-it-works");
  });

  it("never hides meaningful content by default (only decorative, aria-hidden bits start transparent)", () => {
    const { container } = render(<TooltipProvider><Home /></TooltipProvider>);
    for (const el of container.querySelectorAll(".opacity-0")) {
      expect(el.closest("[aria-hidden='true']"), `${el.outerHTML.slice(0, 80)} is hidden but not decorative`).not.toBeNull();
    }
  });

  it("states honestly that sample visuals are samples", () => {
    render(<TooltipProvider><Home /></TooltipProvider>);
    expect(screen.getAllByText(/for illustration/i).length).toBeGreaterThanOrEqual(4);
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
    render(<Hero />);
    const words = screen.getByRole("heading", { level: 1 }).querySelectorAll("span");
    expect(words).toHaveLength(6);
    expect((words[5] as HTMLElement).style.animationDelay).toBe("450ms");
  });
});

describe("timeline contract", () => {
  it("has exactly one timeline per pinned scene, with short pin distances", () => {
    expect(TIMELINES.map((t) => t.id).sort()).toEqual(Object.keys(SCENES).sort());
    for (const t of TIMELINES) {
      expect(t.distance).toBeGreaterThan(0);
      expect(t.distance).toBeLessThanOrEqual(1.5);
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

  it("on desktop pins and scrubs every scene, and starts smooth scrolling", async () => {
    state.desktop = true;
    mount();
    await waitFor(() => expect(state.timelines).toHaveLength(TIMELINES.length));
    expect(state.lenisCreated).toBe(1);
    expect(state.reveals).toBe(0);
    for (const tl of state.timelines) expect(tl.scrollTrigger).toMatchObject({ pin: true, start: "top top" });
    expect(state.timelines[0].scrollTrigger.end).toBe("+=100%");
  });

  it("on small screens uses simple reveals only: no pinning", async () => {
    state.mobile = true;
    mount();
    await waitFor(() => expect(state.reveals).toBe(TIMELINES.length));
    expect(state.timelines).toHaveLength(0);
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
