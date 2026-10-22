import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PREFS, setDisplayPrefs, useDisplayPrefs } from "@/lib/local/display-prefs";
import { useReducedMotion } from "@/lib/motion/hooks";
import { Tilt } from "@/lib/motion/tilt";

function mockMedia({ fine = true, reduce = false }: { fine?: boolean; reduce?: boolean } = {}) {
  window.matchMedia = ((query: string) => ({
    matches: query.includes("hover: hover") ? fine : query.includes("prefers-reduced-motion") ? reduce : false,
    media: query, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

beforeEach(() => {
  localStorage.clear();
  setDisplayPrefs(DEFAULT_PREFS);
  mockMedia();
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number);
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
});
afterEach(() => vi.unstubAllGlobals());

describe("display preferences", () => {
  it("defaults, persists in a versioned shape and survives corrupt storage", () => {
    const { result } = renderHook(() => useDisplayPrefs());
    expect(result.current.prefs).toEqual({ motion: "system" });
    act(() => result.current.set({ motion: "reduced" }));
    expect(JSON.parse(localStorage.getItem("nextrole_display")!)).toEqual({ v: 1, motion: "reduced" });
    localStorage.setItem("nextrole_display", "{nope");
    act(() => window.dispatchEvent(new Event("storage")));
    expect(result.current.prefs).toEqual(DEFAULT_PREFS);
  });

  it("'always reduce' turns reduced motion on; the OS setting alone also does; neither leaves it off", () => {
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
    act(() => setDisplayPrefs({ motion: "reduced" }));
    expect(result.current).toBe(true);
    act(() => setDisplayPrefs({ motion: "system" }));
    mockMedia({ reduce: true });
    expect(renderHook(() => useReducedMotion()).result.current).toBe(true);
  });
});

describe("Tilt", () => {
  it("is a plain wrapper without a fine pointer", () => {
    mockMedia({ fine: false });
    render(<Tilt><p>child</p></Tilt>);
    expect(screen.getByText("child").parentElement!.style.transform).toBe("");
  });

  it("tilts toward the pointer by at most 4 degrees, and resets on leave", async () => {
    render(<Tilt><p>child</p></Tilt>);
    const el = screen.getByText("child").parentElement!;
    el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.pointerMove(el, { clientX: 200, clientY: 0, pointerType: "mouse" }); // top-right corner
    await act(async () => void (await new Promise((r) => setTimeout(r, 5))));
    const m = el.style.transform.match(/rotateX\((-?[\d.]+)deg\) rotateY\((-?[\d.]+)deg\)/)!;
    expect(Number(m[1])).toBeCloseTo(4, 1); // tilts up
    expect(Number(m[2])).toBeCloseTo(4, 1); // and right
    expect(Math.abs(Number(m[1]))).toBeLessThanOrEqual(4);
    fireEvent.pointerLeave(el);
    await act(async () => void (await new Promise((r) => setTimeout(r, 5))));
    expect(el.style.transform).toMatch(/translateY\(0px\) rotateX\(0(\.00)?deg\) rotateY\(0(\.00)?deg\)/);
  });

  it("with glare and lift: a highlight follows the pointer and the card rises only while hovered", async () => {
    const { container } = render(<Tilt glare lift={4}><p>child</p></Tilt>);
    const el = screen.getByText("child").parentElement!;
    el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0, toJSON: () => ({}) });
    const shine = container.querySelector<HTMLElement>("span span")!;
    fireEvent.pointerEnter(el, { pointerType: "mouse" });
    fireEvent.pointerMove(el, { clientX: 100, clientY: 50, pointerType: "mouse" });
    await act(async () => void (await new Promise((r) => setTimeout(r, 5))));
    expect(el.style.transform).toContain("translateY(-4px)");
    expect(shine.style.opacity).toBe("1");
    expect(shine.style.transform).toBe("translate3d(40px, -10px, 0)"); // pointer minus 30% of the width
    fireEvent.pointerLeave(el);
    await act(async () => void (await new Promise((r) => setTimeout(r, 5))));
    expect(el.style.transform).toContain("translateY(0px)");
    expect(shine.style.opacity).toBe("0");
  });

  it("ignores touch pointers", async () => {
    render(<Tilt><p>child</p></Tilt>);
    const el = screen.getByText("child").parentElement!;
    fireEvent.pointerMove(el, { clientX: 5, clientY: 5, pointerType: "touch" });
    await act(async () => void (await new Promise((r) => setTimeout(r, 5))));
    expect(el.style.transform).toBe("");
  });
});
