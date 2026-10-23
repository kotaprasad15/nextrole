import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import config, { CSP } from "../../next.config";

describe("security headers", () => {
  it("sends the full set on every route", async () => {
    const rules = await config.headers!();
    const headers = Object.fromEntries(rules[0].headers.map((h) => [h.key, h.value]));
    expect(rules[0].source).toBe("/:path*");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["Referrer-Policy"]).toBeTruthy();
    expect(headers["Cross-Origin-Opener-Policy"]).toBe("same-origin");
    expect(headers["Permissions-Policy"]).toContain("camera=()");
    expect(headers["Content-Security-Policy"]).toBe(CSP);
  });

  it("the CSP blocks framing, plugins, foreign bases and cross-origin form posts or fetches", () => {
    for (const d of ["default-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'", "connect-src 'self'"]) {
      expect(CSP).toContain(d);
    }
    expect(CSP).not.toMatch(/script-src[^;]*https?:/); // no third-party script hosts
  });
});

/** Raw HTML injection is the one way React code can reintroduce XSS, so it is banned outright. */
describe("no raw HTML rendering", () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(tsx?|jsx?)$/.test(name) && !/\.test\./.test(name)) files.push(full);
    }
  };
  walk(path.resolve(__dirname, ".."));

  it("never uses dangerouslySetInnerHTML or innerHTML assignments", () => {
    const offenders = files.filter((f) => /dangerouslySetInnerHTML|\.innerHTML\s*=|insertAdjacentHTML/.test(readFileSync(f, "utf-8")));
    expect(offenders).toEqual([]);
  });
});
