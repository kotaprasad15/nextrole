"use client";

import { Suspense, type ReactNode } from "react";
import { useMe } from "@/lib/api/queries";
import { AppNav, NavFallback } from "./app-nav";
import { SkipLink } from "./skip-link";
import { useSessionGuard } from "./use-session-guard";

/**
 * Signed-in chrome: skip link, navigation and the page container. It does not block rendering
 * on `/me`: each page loads its own data, and ANY 401 (expired session) lands in the handler
 * registered by `useSessionGuard`.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const me = useMe();
  useSessionGuard();

  return (
    <>
      <SkipLink />
      <div aria-hidden className="app-progress" />
      {/* usePathname (active link) needs a Suspense boundary under Cache Components; the fallback
          has the same height so nothing shifts when the real nav streams in. */}
      <Suspense fallback={<NavFallback />}>
        <AppNav email={me.data?.email} />
      </Suspense>
      <main id="main" tabIndex={-1} className="page-container py-8 outline-none md:py-12">
        {children}
      </main>
    </>
  );
}
