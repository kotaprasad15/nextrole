/**
 * WCAG contrast guard for the design tokens. It parses the REAL `globals.css`, so the tokens
 * stay the single source of truth and any edit that breaks AA fails the test suite.
 * Every check runs for BOTH themes: light = the @theme block, dark = the `.dark` overrides.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.resolve(__dirname, "../app/globals.css"), "utf-8");

type Theme = "light" | "dark";
const darkStart = css.indexOf(":root.dark {");
const darkBlock = css.slice(darkStart, css.indexOf("}", darkStart));

/** A colour token for a theme: the .dark block overrides @theme, so dark falls back to the shared value. */
function token(name: string, theme: Theme = "light"): string {
  const re = new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`);
  const m = (theme === "dark" ? darkBlock.match(re) : null) ?? css.match(re);
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
const rgbToHex = (r: number, g: number, b: number) => `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;

const AA_TEXT = 4.5;

describe.each<Theme>(["light", "dark"])("token contrast (WCAG AA), %s theme", (theme) => {
  const t = (name: string) => token(name, theme);
  const bg = () => t("bg");
  const surface = () => t("surface");

  it("body text and muted text are readable on both page surfaces", () => {
    for (const on of [bg(), surface()]) {
      expect(contrast(t("ink"), on)).toBeGreaterThanOrEqual(AA_TEXT);
      expect(contrast(t("muted"), on)).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it("muted and ink text stay readable on every tinted surface the app puts text on", () => {
    // Found by Lighthouse: inactive tab labels are muted text on the `bg-ink/5` tab list (4.13:1
    // with the old muted colour). Page-only checks missed it, so check the common tints too.
    const tints = [
      over(t("ink"), bg(), 0.05), // tab lists, segmented controls
      over(t("ink"), bg(), 0.03), // tracker columns
      over(t("ink"), surface(), 0.05),
      ...["primary", "startup", "mid", "mnc", "success", "warning", "danger"].map((n) => t(`${n}-tint`)),
    ];
    for (const on of tints) {
      expect(contrast(t("muted"), on), `muted on ${on}`).toBeGreaterThanOrEqual(AA_TEXT);
      expect(contrast(t("ink"), on), `ink on ${on}`).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it("primary works as text/link colour and as a button fill with its on-primary text", () => {
    expect(contrast(t("primary"), surface())).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrast(t("primary"), bg())).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrast(t("on-primary"), t("primary"))).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrast(t("on-primary"), t("primary-hover"))).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrast(t("primary"), t("primary-tint"))).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it.each(["startup", "mid", "mnc", "success", "warning", "danger"])("%s-ink is readable as text on surfaces and its own tint", (name) => {
    const ink = t(`${name}-ink`);
    expect(contrast(ink, surface())).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrast(ink, bg())).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrast(ink, t(`${name}-tint`))).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it("danger (error text) is readable on the surfaces and the danger fill carries its on-danger text", () => {
    // Light: raw danger on its own tint is 4.2:1, so tinted surfaces use danger-ink (tested above).
    expect(contrast(t("danger"), surface())).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrast(t("danger"), bg())).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrast(t("on-danger"), t("danger"))).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it("text on filled tier buttons and on ink fills (tooltip, skip link)", () => {
    expect(contrast(t("on-startup"), t("startup"))).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrast(t("on-mid"), t("mid"))).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrast("#ffffff", t("mnc"))).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrast(t("on-ink"), t("ink"))).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it("non-text UI (rings, borders that carry meaning) meets the 3:1 graphic contrast", () => {
    for (const name of ["primary", "startup", "mnc", "success", "danger"]) {
      // Coral is the one light-theme brand colour allowed 2.5:1 (it is always paired with text or an icon).
      const min = theme === "light" && name === "startup" ? 2.5 : 3;
      expect(contrast(t(name), surface()), `${name} vs surface`).toBeGreaterThanOrEqual(min);
    }
  });
});

describe("light-only design rules", () => {
  it("documents why raw coral/teal/warning must never be used as text on white", () => {
    // If this ever starts passing the design rule can be relaxed; until then it is enforced.
    expect(contrast(token("startup"), token("surface"))).toBeLessThan(AA_TEXT);
    expect(contrast(token("mid"), token("surface"))).toBeLessThan(AA_TEXT);
    expect(contrast(token("warning"), token("surface"))).toBeLessThan(AA_TEXT);
    expect(over(token("startup"), "#ffffff", 0.1)).toBe(token("startup-tint"));
  });
});

describe.each<Theme>(["light", "dark"])("homepage backdrop and glass keep text readable (WCAG AA), %s theme", async (theme) => {
  const { WORST_CASE_LAYERS, ORBS, BLOBS, DARK_WASH } = await import("./marketing/backdrop");
  const t = (name: string) => token(name, theme);
  const glassVar = (theme === "dark" ? darkBlock : css.replace(darkBlock, "")).match(/--glass-bg:\s*rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\)/)!;
  const glassAlpha = Number(glassVar[4]);
  const glassColor = rgbToHex(Number(glassVar[1]), Number(glassVar[2]), Number(glassVar[3]));
  // Composite EVERY backdrop layer over the page background: the worst place a word can ever sit.
  const worst = WORST_CASE_LAYERS.reduce((under, [name, alpha]) => over(t(name), under, alpha * (theme === "dark" ? DARK_WASH : 1)), t("bg"));
  const glassOnWorst = over(glassColor, worst, glassAlpha);

  it("the backdrop layers are light (their combined wash is a tint, not a colour)", () => {
    for (const o of ORBS) expect(o.alpha).toBeLessThanOrEqual(0.1);
    for (const b of BLOBS) expect(Math.max(b.fromAlpha, b.toAlpha)).toBeLessThanOrEqual(0.1);
  });

  it("hero text colours are readable on the worst-case stack of every layer", () => {
    for (const [label, fg] of [["ink", t("ink")], ["primary (eyebrow)", theme === "dark" ? t("primary") : t("primary-hover")]] as const) {
      expect(contrast(fg, worst), `${label} on ${worst}`).toBeGreaterThanOrEqual(AA_TEXT);
    }
    // text-ink/75 (hero paragraph) and text-ink/85 (trust row, bullets) are translucent ink: blend before measuring
    for (const a of [0.75, 0.85]) expect(contrast(over(t("ink"), worst, a), worst), `ink/${a * 100}`).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it("text on glass cards and chips is readable over the worst-case stack", () => {
    for (const [label, fg] of [["ink", t("ink")], ["muted", t("muted")], ["startup-ink", t("startup-ink")], ["mid-ink", t("mid-ink")], ["mnc-ink", t("mnc-ink")]] as const) {
      expect(contrast(fg, glassOnWorst), `${label} on glass ${glassOnWorst}`).toBeGreaterThanOrEqual(AA_TEXT);
    }
    expect(contrast(over(t("ink"), glassOnWorst, 0.85), glassOnWorst)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it("the dark wash factor matches the class the component ships", () => {
    const src = readFileSync(path.resolve(__dirname, "../components/marketing/hero-backdrop.tsx"), "utf-8");
    expect(src).toContain(`dark:opacity-${Math.round(DARK_WASH * 100)}`);
  });

  it("the hero's secondary copy is not plain muted text (muted is only guaranteed on flat surfaces)", () => {
    const hero = readFileSync(path.resolve(__dirname, "../components/marketing/hero.tsx"), "utf-8");
    expect(hero).not.toMatch(/text-muted/);
  });

  it("the glass is translucent enough to refract but still a surface", () => {
    expect(glassAlpha).toBeGreaterThanOrEqual(0.55);
    expect(glassAlpha).toBeLessThanOrEqual(0.9);
  });
});
