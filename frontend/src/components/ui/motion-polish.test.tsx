import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PREFS, setDisplayPrefs, useDisplayPrefs } from "@/lib/local/display-prefs";
import { cursorStateFor } from "@/lib/motion/cursor-state";
import { useCustomCursor, useReducedMotion } from "@/lib/motion/hooks";
import { Tilt } from "@/lib/motion/tilt";
import { Cursor } from "./cursor";

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

const html = (markup: string) => {
  const host = document.createElement("div");
  host.innerHTML = markup;
  document.body.appendChild(host);
  return host;
};

describe("display preferences", () => {
  it("defaults, persists in a versioned shape and survives corrupt storage", () => {
    const { result } = renderHook(() => useDisplayPrefs());
    expect(result.current.prefs).toEqual({ cursor: true, motion: "system" });
    act(() => result.current.set({ cursor: false }));
    expect(JSON.parse(localStorage.getItem("nextrole_display")!)).toEqual({ v: 1, cursor: false, motion: "system" });
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

  it("the custom cursor needs a fine pointer, motion allowed and the setting on", () => {
    expect(renderHook(() => useCustomCursor()).result.current).toBe(true);
    mockMedia({ fine: false });
    expect(renderHook(() => useCustomCursor()).result.current).toBe(false);
    mockMedia({ reduce: true });
    expect(renderHook(() => useCustomCursor()).result.current).toBe(false);
    mockMedia();
    act(() => setDisplayPrefs({ cursor: false }));
    expect(renderHook(() => useCustomCursor()).result.current).toBe(false);
  });
});

describe("cursorStateFor", () => {
  it("links and buttons are links; plain content is default", () => {
    const host = html(`<a href="/x"><span id="a">go</span></a><button><i id="b"></i></button><p id="c">text</p>`);
    expect(cursorStateFor(host.querySelector("#a"))).toBe("link");
    expect(cursorStateFor(host.querySelector("#b"))).toBe("link");
    expect(cursorStateFor(host.querySelector("#c"))).toBe("default");
    expect(cursorStateFor(null)).toBe("default");
  });
  it("text entry keeps the native cursor, checkboxes and ranges are interactive", () => {
    const host = html(`<input id="t" type="text"><textarea id="ta"></textarea><select id="s"></select><input id="r" type="range"><input id="ck" type="checkbox"><div id="ce" contenteditable="true"></div>`);
    for (const id of ["t", "ta", "s", "ce"]) expect(cursorStateFor(host.querySelector(`#${id}`))).toBe("text");
    for (const id of ["r", "ck"]) expect(cursorStateFor(host.querySelector(`#${id}`))).toBe("link");
  });
  it("data-cursor wins, nearest first: a 'view' card shows view but its buttons stay links", () => {
    const host = html(`<div data-cursor="view"><p id="p">card</p><button id="b">Apply</button><a id="a" data-cursor="view" href="/j">title</a></div><div data-cursor="none"><span id="n"></span></div>`);
    expect(cursorStateFor(host.querySelector("#p"))).toBe("view");
    expect(cursorStateFor(host.querySelector("#b"))).toBe("link");
    expect(cursorStateFor(host.querySelector("#a"))).toBe("view"); // the stretched card link itself
    expect(cursorStateFor(host.querySelector("#n"))).toBe("text");
  });
});

describe("Cursor", () => {
  const shape = () => document.querySelector<HTMLElement>("[data-state]")!;

  it("renders nothing on touch devices, with reduced motion, or when switched off", () => {
    mockMedia({ fine: false });
    const a = render(<Cursor />);
    expect(a.container.innerHTML).toBe("");
    expect(document.documentElement.classList.contains("cursor-custom")).toBe(false);
    a.unmount();
    mockMedia({ reduce: true });
    expect(render(<Cursor />).container.innerHTML).toBe("");
  });

  it("shows on a fine pointer, follows the mouse, and reflects what is under it", () => {
    const host = html(`<a id="l" href="/x">link</a><input id="i"><p id="p">hi</p>`);
    const { unmount } = render(<Cursor />);
    expect(document.documentElement.classList.contains("cursor-custom")).toBe(true);
    expect(shape().dataset.state).toBe("hidden"); // not shown until the pointer moves

    fireEvent.pointerMove(document, { clientX: 120, clientY: 80, pointerType: "mouse" });
    expect(shape().dataset.state).toBe("default");
    const dot = document.querySelector<HTMLElement>(".will-change-transform:last-child")!;
    expect(dot.style.transform).toBe("translate3d(120px, 80px, 0)");

    fireEvent.pointerOver(host.querySelector("#l")!, { pointerType: "mouse" });
    expect(shape().dataset.state).toBe("link");
    fireEvent.pointerDown(document, { pointerType: "mouse" });
    expect(shape().dataset.state).toBe("link-press");
    fireEvent.pointerUp(document, { pointerType: "mouse" });
    fireEvent.pointerOver(host.querySelector("#i")!, { pointerType: "mouse" });
    expect(shape().dataset.state).toBe("text"); // hidden: the real caret is used
    fireEvent.pointerOver(host.querySelector("#p")!, { pointerType: "mouse" });
    expect(shape().dataset.state).toBe("default");

    unmount();
    expect(document.documentElement.classList.contains("cursor-custom")).toBe(false);
  });

  it("ignores touch and pen pointers, and hides when the mouse leaves the window", () => {
    render(<Cursor />);
    fireEvent.pointerMove(document, { clientX: 10, clientY: 10, pointerType: "touch" });
    expect(shape().dataset.state).toBe("hidden");
    fireEvent.pointerMove(document, { clientX: 10, clientY: 10, pointerType: "mouse" });
    expect(shape().dataset.state).toBe("default");
    fireEvent.mouseOut(document, { relatedTarget: null });
    expect(shape().dataset.state).toBe("hidden");
  });

  it("is hidden from assistive tech", () => {
    const { container } = render(<Cursor />);
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
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
