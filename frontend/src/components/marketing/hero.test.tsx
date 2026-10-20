import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FeaturedJob } from "@/lib/api/schemas";
import { HOME_SECTIONS } from "@/lib/marketing/constants";
import { setActiveSection } from "@/lib/marketing/active-section";
import { setDisplayPrefs } from "@/lib/local/display-prefs";

const cacheLife = vi.fn();
vi.mock("next/cache", () => ({ cacheLife: (p: unknown) => cacheLife(p) }));

import { Button } from "@/components/ui/button";
import { getFeaturedJobs } from "@/lib/marketing/hero-data";
import { Hero } from "./hero";
import { MarketingNav } from "./marketing-nav";
import { ScrollRing } from "./scroll-ring";
import { TierMarquee } from "./tier-marquee";

const job = (o: Partial<FeaturedJob> = {}): FeaturedJob => ({
  title: "Backend Engineer", company: "Acme", location: "Dublin", remote: false, tier: "startup", source: "greenhouse",
  apply_url: "https://boards.greenhouse.io/acme/jobs/1", ...o,
});

function media({ fine = true, reduce = false } = {}) {
  window.matchMedia = ((q: string) => ({
    matches: q.includes("hover: hover") ? fine : q.includes("prefers-reduced-motion") ? reduce : false,
    media: q, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  setDisplayPrefs({ cursor: true, motion: "system" });
  media();
  setActiveSection(HOME_SECTIONS.intro);
});

describe("Hero: real or generic, never invented", () => {
  it("shows a real posting with its source and the real apply link, and no score", () => {
    render(<Hero jobs={[job(), job({ company: "Orbit", title: "Data Engineer", tier: "mid", source: "lever", apply_url: "https://jobs.lever.co/orbit/2" })]} />);
    expect(screen.getByText("Backend Engineer")).toBeInTheDocument();
    expect(screen.getByText(/Acme · Dublin/)).toBeInTheDocument();
    expect(screen.getByText(/via Greenhouse/)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /see the real posting/i });
    expect(link).toHaveAttribute("href", "https://boards.greenhouse.io/acme/jobs/1");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
    const text = document.querySelector('[data-section="Intro"]')!.textContent!;
    expect(text).not.toMatch(/\d+\s*match|Reviewer \d|illustration|sample data/i);
  });

  it("fills the tier list from real jobs where it has them, and from the tier descriptions otherwise", () => {
    render(<Hero jobs={[job(), job({ company: "Orbit", title: "Data Engineer", tier: "mid" })]} />);
    expect(screen.getByText("Backend Engineer, Acme")).toBeInTheDocument();
    expect(screen.getByText("Data Engineer, Orbit")).toBeInTheDocument();
    expect(screen.getByText(/Over 5,000 people/)).toBeInTheDocument(); // no real MNC job: the honest description
  });

  it("falls back to a clearly generic card: no company, no number, no link", () => {
    render(<Hero jobs={[]} />);
    expect(screen.getByRole("group", { name: /your matches will appear here/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /real posting/i })).not.toBeInTheDocument();
    const text = document.querySelector('[data-section="Intro"]')!.textContent!;
    expect(text).not.toMatch(/\d+%|\b\d{2}\s*match|Lumen|Stripe|Acme/);
  });

  it("keeps the CTAs and a three-point trust row", () => {
    render(<Hero jobs={[]} />);
    expect(screen.getByRole("link", { name: /^Get started/ })).toHaveAttribute("href", "/signup");
    for (const t of ["Real apply links", "You approve every email", "Facts sourced"]) expect(screen.getByText(t)).toBeInTheDocument();
  });
});

describe("getFeaturedJobs (server data)", () => {
  const ok = (body: unknown, status = 200) => vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status })));

  it("returns validated jobs from the public endpoint and caches them for hours", async () => {
    ok([job(), job({ company: "B" }), job({ company: "C" }), job({ company: "D" })]);
    const jobs = await getFeaturedJobs();
    expect(jobs).toHaveLength(3);
    expect(String((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0])).toMatch(/\/public\/featured-jobs$/);
    expect(cacheLife).toHaveBeenCalledWith("hours");
  });

  it("never throws: a down backend, a bad status or a malformed payload give [] and a SHORT cache", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    expect(await getFeaturedJobs()).toEqual([]);
    ok({}, 500);
    expect(await getFeaturedJobs()).toEqual([]);
    ok([{ ...job(), apply_url: "http://insecure.example.com" }]); // non-https is refused by the schema
    expect(await getFeaturedJobs()).toEqual([]);
    for (const call of cacheLife.mock.calls) expect(call[0]).toMatchObject({ revalidate: expect.any(Number) });
    expect(cacheLife).not.toHaveBeenCalledWith("hours");
  });

  it("an empty list is cached briefly so real data appears soon after the backend has some", async () => {
    ok([]);
    expect(await getFeaturedJobs()).toEqual([]);
    expect(cacheLife.mock.calls[0][0]).toMatchObject({ revalidate: 120 });
  });
});

describe("TierMarquee", () => {
  it("scrolls, lists its content once for assistive tech, and can be paused", async () => {
    const user = userEvent.setup();
    const { container } = render(<TierMarquee />);
    const tracks = container.querySelectorAll("ul");
    expect(tracks).toHaveLength(2);
    expect(tracks[1]).toHaveAttribute("aria-hidden", "true");
    const pause = screen.getByRole("button", { name: "Pause the scrolling band" });
    expect(pause).toHaveAttribute("aria-pressed", "false");
    await user.click(pause);
    expect(screen.getByRole("button", { name: "Play the scrolling band" })).toHaveAttribute("aria-pressed", "true");
    expect(container.querySelector(".marquee")).toHaveAttribute("data-paused", "true");
  });

  it("is a static wrapped row with no moving track and no button under reduced motion", () => {
    media({ reduce: true });
    const { container } = render(<TierMarquee />);
    expect(container.querySelector(".marquee-track")).toBeNull();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("Backend Engineer")).toBeInTheDocument();
  });
});

describe("ScrollRing and the header nav", () => {
  function sections() {
    document.body.insertAdjacentHTML("beforeend", ["Intro", "Resume", "Jobs", "FAQ"].map((n, i) => `<section data-section="${n}" data-i="${i}"></section>`).join(""));
    const tops: Record<string, number> = { Intro: -800, Resume: -300, Jobs: 900, FAQ: 1800 };
    document.querySelectorAll<HTMLElement>("[data-section]").forEach((el) => {
      el.getBoundingClientRect = () => ({ top: tops[el.dataset.section!], bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) });
    });
  }
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number);
    vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
    Object.defineProperty(document.documentElement, "scrollHeight", { configurable: true, value: 5000 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 1000 });
  });

  it("fills with scroll progress and names the section in view", async () => {
    sections();
    render(<ScrollRing />);
    Object.defineProperty(window, "scrollY", { configurable: true, value: 2000 }); // half of 5000 - 1000 = 4000
    await act(async () => {
      fireEvent.scroll(window);
      await new Promise((r) => setTimeout(r, 10));
    });
    const ring = document.querySelector<HTMLElement>("[style*='--p']")!;
    expect(ring.style.getPropertyValue("--p")).toBe("0.5000");
    expect(screen.getByText("50")).toBeInTheDocument();
    expect(screen.getByText("Resume", { selector: "span" })).toBeInTheDocument(); // last section whose top passed 45% of the viewport
    // label-in-name: the accessible name contains the visible percentage
    expect(screen.getByRole("button", { name: "Back to top (50% scrolled)" })).toBeInTheDocument();
  });

  it("the header pill follows the section: How it works for scenes, FAQ for the FAQ", () => {
    render(<MarketingNav />);
    const how = screen.getByRole("link", { name: "How it works" });
    const faq = screen.getByRole("link", { name: "FAQ" });
    expect(how).not.toHaveAttribute("aria-current");
    act(() => setActiveSection(HOME_SECTIONS.jobs));
    expect(how).toHaveAttribute("aria-current", "location");
    act(() => setActiveSection(HOME_SECTIONS.faq));
    expect(faq).toHaveAttribute("aria-current", "location");
    expect(how).not.toHaveAttribute("aria-current");
    expect(how).toHaveAttribute("href", "#how-it-works");
  });
});

describe("Button fx", () => {
  it("is off by default (the app keeps calm buttons)", () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole("button", { name: "Save" }).className).not.toMatch(/fx-border|fx-outline/);
  });

  it("glow: rotating border, sweep layer, press scale 0.97, and the real link element is kept with asChild", () => {
    render(
      <Button asChild fx="glow">
        <a href="/signup">Get started</a>
      </Button>,
    );
    const a = screen.getByRole("link", { name: "Get started" });
    expect(a.tagName).toBe("A");
    expect(a.className).toMatch(/fx-border/);
    expect(a.className).toContain("active:scale-[0.97]");
    expect(a.querySelector("[aria-hidden='true']")).not.toBeNull(); // the sweep is decorative
  });

  it("outline: a sliding fill layer inside, edges drawn by CSS", () => {
    render(<Button fx="outline">Log in</Button>);
    const b = screen.getByRole("button", { name: "Log in" });
    expect(b.className).toMatch(/fx-outline/);
    expect(b.querySelector("span[aria-hidden='true']")?.className).toContain("origin-left");
  });
});
