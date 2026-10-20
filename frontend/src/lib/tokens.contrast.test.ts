/**
 * WCAG contrast guard for the design tokens. It parses the REAL `globals.css`, so the tokens
 * stay the single source of truth and any edit that breaks AA fails the test suite.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.resolve(__dirname, "../app/globals.css"), "utf-8");

function token(name: string): string {
  const m = css.match(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!m) throw new Error(`token --color-${name} not found in globals.css`);
  return m[1].toLowerCase();
}

function channel(hex: string, i: number) {
  return parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
}
function luminance(hex: string) {
  const [r, g, b] = [0, 1, 2].map((i) => {
    const v = channel(hex, i);
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
/** Colour `fg` at `alpha` over `bg` (for "10% tint" surfaces). */
function over(fg: string, bg: string, alpha: number) {
  const ch = (i: number) => Math.round(channel(fg, i) * 255 * alpha + channel(bg, i) * 255 * (1 - alpha));
  return `#${[0, 1, 2].map((i) => ch(i).toString(16).padStart(2, "0")).join("")}`;
}

const AA_TEXT = 4.5;
const bg = () => token("bg");
const surface = () => token("surface");

describe("token contrast (WCAG AA)", () => {
  it("body text and muted text are readable on both page surfaces", () => {
    for (const on of [bg(), surface()]) {
      expect(contrast(token("ink"), on)).toBeGreaterThanOrEqual(AA_TEXT);
      expect(contrast(token("muted"), on)).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it("muted and ink text stay readable on every tinted surface the app puts text on", () => {
    // Found by Lighthouse: inactive tab labels are muted text on the `bg-ink/5` tab list (4.13:1
    // with the old muted colour). Page-only checks missed it, so check the common tints too.
    const tints = [
      over(token("ink"), bg(), 0.05), // tab lists, segmented controls
      over(token("ink"), bg(), 0.03), // tracker columns
      over(token("ink"), surface(), 0.05),
      ...["primary", "startup", "mid", "mnc", "success", "warning", "danger"].map((n) => token(`${n}-tint`)),
    ];
    for (const on of tints) {
      expect(contrast(token("muted"), on), `muted on ${on}`).toBeGreaterThanOrEqual(AA_TEXT);
      expect(contrast(token("ink"), on), `ink on ${on}`).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it("primary works as text/link colour and as a button fill with white text", () => {
    expect(contrast(token("primary"), surface())).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrast(token("primary"), bg())).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrast(token("on-primary"), token("primary"))).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrast(token("on-primary"), token("primary-hover"))).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it.each(["startup", "mid", "mnc", "success", "warning", "danger"])("%s-ink is readable as text on surfaces and its own tint", (name) => {
    const ink = token(`${name}-ink`);
    expect(contrast(ink, surface())).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrast(ink, bg())).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrast(ink, token(`${name}-tint`))).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it("danger (error text on white) is readable; its tint pairs with danger-ink instead", () => {
    // Raw danger on its own tint is 4.2:1, so tinted surfaces use danger-ink (tested above).
    expect(contrast(token("danger"), surface())).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrast(token("danger"), bg())).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it("button text on filled tier buttons: ink on coral and teal, white on blue", () => {
    expect(contrast(token("ink"), token("startup"))).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrast(token("ink"), token("mid"))).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrast("#ffffff", token("mnc"))).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it("documents why raw coral/teal/warning must never be used as text on white", () => {
    // If this ever starts passing the design rule can be relaxed; until then it is enforced.
    expect(contrast(token("startup"), surface())).toBeLessThan(AA_TEXT);
    expect(contrast(token("mid"), surface())).toBeLessThan(AA_TEXT);
    expect(contrast(token("warning"), surface())).toBeLessThan(AA_TEXT);
  });

  it("non-text UI (rings, borders that carry meaning) meets the 3:1 graphic contrast", () => {
    for (const name of ["primary", "startup", "mnc", "success", "danger"]) {
      expect(contrast(token(name), surface())).toBeGreaterThanOrEqual(name === "startup" ? 2.5 : 3);
    }
    expect(over(token("startup"), "#ffffff", 0.1)).toBe(token("startup-tint"));
  });
});
