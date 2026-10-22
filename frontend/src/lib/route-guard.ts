/**
 * Pure routing rules for the auth guard (used by proxy.ts, unit-tested without Next).
 * The guard only checks that a session cookie EXISTS, for a fast redirect. Whether the session
 * is actually valid is confirmed by `GET /me` in the app shell (an expired cookie gets a 401,
 * which the shell turns into a redirect to /login).
 */
export const PROTECTED_PREFIXES = ["/dashboard", "/admin", "/onboarding", "/jobs", "/outreach", "/ats", "/profile", "/activity", "/settings"];
export const AUTH_PAGES = ["/login", "/signup"];

const matches = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

export type GuardResult = { action: "next" } | { action: "redirect"; to: string };

export function guard(pathname: string, hasSession: boolean): GuardResult {
  if (!hasSession && PROTECTED_PREFIXES.some((p) => matches(pathname, p))) {
    return { action: "redirect", to: `/login?next=${encodeURIComponent(pathname)}` };
  }
  if (hasSession && AUTH_PAGES.some((p) => matches(pathname, p))) {
    return { action: "redirect", to: "/dashboard" };
  }
  return { action: "next" };
}

/**
 * Only same-site relative paths may be used as a post-login destination, so a crafted
 * `?next=https://evil.example` can never turn the login page into an open redirect.
 */
export function safeNext(next: string | null | undefined, fallback = "/dashboard"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return fallback;
  return next;
}
