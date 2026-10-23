import { describe, expect, it } from "vitest";
import { guard, safeNext } from "./route-guard";
import { isActive } from "@/components/shell/app-nav";

describe("guard", () => {
  it.each(["/dashboard", "/dashboard/anything", "/onboarding", "/jobs/abc", "/jobs/abc/outreach", "/outreach", "/ats", "/profile", "/saved", "/interviews/new", "/settings"])(
    "sends signed-out visitors from %s to /login and remembers where they were going",
    (path) => {
      expect(guard(path, false)).toEqual({ action: "redirect", to: `/login?next=${encodeURIComponent(path)}` });
    },
  );

  it.each(["/", "/design", "/login", "/signup", "/about"])("lets signed-out visitors reach public page %s", (path) => {
    expect(guard(path, false)).toEqual({ action: "next" });
  });

  it("keeps signed-in users out of the login and signup pages", () => {
    expect(guard("/login", true)).toEqual({ action: "redirect", to: "/dashboard" });
    expect(guard("/signup", true)).toEqual({ action: "redirect", to: "/dashboard" });
  });

  it("lets signed-in users through everywhere else, including the marketing page", () => {
    for (const p of ["/dashboard", "/jobs/x", "/", "/design"]) expect(guard(p, true)).toEqual({ action: "next" });
  });

  it("does not treat lookalike paths as protected", () => {
    expect(guard("/dashboards", false)).toEqual({ action: "next" });
    expect(guard("/atsx", false)).toEqual({ action: "next" });
  });
});

describe("safeNext (open-redirect protection)", () => {
  it("allows same-site relative paths", () => {
    expect(safeNext("/jobs/abc?tab=notes")).toBe("/jobs/abc?tab=notes");
  });
  it.each([null, undefined, "", "https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "dashboard"])(
    "falls back for unsafe or empty value %s",
    (v) => {
      expect(safeNext(v as string | null)).toBe("/dashboard");
    },
  );
  it("uses the provided fallback", () => {
    expect(safeNext("//x", "/onboarding")).toBe("/onboarding");
  });
});

describe("nav active state", () => {
  it("treats job pages as part of the dashboard section", () => {
    expect(isActive("/jobs/abc", "/dashboard")).toBe(true);
    expect(isActive("/dashboard", "/dashboard")).toBe(true);
  });
  it("matches nested routes and not lookalikes", () => {
    expect(isActive("/saved/x", "/saved")).toBe(true);
    expect(isActive("/savedx", "/saved")).toBe(false);
    expect(isActive("/profile", "/dashboard")).toBe(false);
  });
});
