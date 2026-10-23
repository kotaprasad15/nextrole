/**
 * Guards the contrast of text that the TOKEN test cannot see: colours made translucent in the
 * markup (`text-ink/80`, `placeholder:text-muted/80`) and text dimmed with `opacity-*`. It scans
 * the real component sources, blends each translucent colour over both page surfaces and fails
 * below WCAG AA (4.5:1). Placeholders count: they are text people must read.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { contrast } from "./tokens.contrast.test";

const SRC = path.resolve(__dirname, "..");
const css = readFileSync(path.join(SRC, "app/globals.css"), "utf-8");
const token = (name: string) => css.match(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`))![1].toLowerCase();

const ch = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
const blend = (fg: string, bg: string, a: number) => `#${[0, 1, 2].map((i) => Math.round(ch(fg, i) * a + ch(bg, i) * (1 - a)).toString(16).padStart(2, "0")).join("")}`;

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? sources(p) : /\.tsx$/.test(e.name) && !/\.test\.tsx$/.test(e.name) ? [p] : [];
  });
}

const FILES = sources(SRC).map((f) => ({ file: path.relative(SRC, f), text: readFileSync(f, "utf-8") }));
// Colour tokens that are used as TEXT colours (not fills).
const TEXT_TOKENS = ["ink", "muted", "primary", "success-ink", "warning-ink", "danger-ink", "startup-ink", "mid-ink", "mnc-ink"];

describe("translucent text in components keeps AA contrast", () => {
  const found: { file: string; cls: string; name: string; alpha: number }[] = [];
  for (const { file, text } of FILES) {
    for (const m of text.matchAll(/(?<![\w-])((?:[a-z-]+:)*(?:placeholder:)?text-([a-z-]+)\/(\d{1,3}))(?![\w/-])/g)) {
      if (TEXT_TOKENS.includes(m[2])) found.push({ file, cls: m[1], name: m[2], alpha: Number(m[3]) / 100 });
    }
  }

  it("actually finds the translucent text classes it is meant to check", () => {
    expect(found.length).toBeGreaterThan(5);
  });

  it.each([...new Map(found.map((f) => [`${f.cls}`, f])).values()])("$cls ($file) is at least 4.5:1 on the page and card backgrounds", ({ name, alpha }) => {
    for (const on of [token("bg"), token("surface")]) {
      expect(contrast(blend(token(name), on, alpha), on)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("no text is dimmed with an opacity-* utility (only disabled/decorative states may use it)", () => {
    const offenders: string[] = [];
    for (const { file, text } of FILES) {
      for (const m of text.matchAll(/(?<![\w:-])((?:[a-z-]+:)*)opacity-(\d+)(?![\w-])/g)) {
        const prefix = m[1];
        const level = Number(m[2]);
        const before = text.slice(Math.max(0, m.index! - 200), m.index);
        const allowed =
          level === 0 || level === 100 || /disabled:|data-\[|group-hover:|hover:|focus/.test(prefix) ||
          /glow/.test(before) || // decorative halo behind a card
          /hero-backdrop/.test(file) || // aria-hidden decorative wash (its contrast is tested in tokens.contrast.test.ts)
          /disabled\s*&&\s*"[^"]*$/.test(before); // `disabled && "... opacity-50"`
        if (!allowed) offenders.push(`${file}: ${prefix}opacity-${level}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
