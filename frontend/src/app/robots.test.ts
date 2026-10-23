import { describe, expect, it } from "vitest";
import { PROTECTED_PREFIXES } from "@/lib/route-guard";
import robots from "./robots";
import sitemap from "./sitemap";

describe("robots.txt and sitemap", () => {
  const rule = (robots().rules as { userAgent: string; allow: string; disallow: string[] }[])[0];

  it("disallows the API, admin and every private app route, and allows the marketing pages", () => {
    for (const p of ["/api", "/admin", "/dashboard", "/profile", "/settings", "/jobs", "/outreach", "/onboarding"]) {
      expect(rule.disallow, p).toContain(p);
    }
    for (const p of PROTECTED_PREFIXES) expect(rule.disallow).toContain(p);
    expect(rule.allow).toBe("/");
  });

  it("points at the sitemap, which lists public pages only", () => {
    expect(robots().sitemap).toMatch(/\/sitemap\.xml$/);
    const urls = sitemap().map((s) => new URL(s.url).pathname);
    expect(urls).toContain("/");
    for (const u of urls) expect(rule.disallow.some((d) => u === d || u.startsWith(`${d}/`))).toBe(false);
  });
});
