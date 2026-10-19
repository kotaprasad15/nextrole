"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Suspense, useEffect, type ReactNode } from "react";
import { setUnauthorizedHandler } from "@/lib/api/client";
import { api } from "@/lib/api/endpoints";
import { useMe } from "@/lib/api/queries";
import { AppNav, NavFallback } from "./app-nav";
import { SkipLink } from "./skip-link";

/**
 * Signed-in chrome: skip link, navigation and the page container. It does not block rendering
 * on `/me`: each page loads its own data, and ANY 401 (expired session) lands in the handler
 * registered here, which clears cached data and sends the user to /login with a return path.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const qc = useQueryClient();
  const me = useMe();

  useEffect(() => {
    setUnauthorizedHandler(() => {
      // The session cookie is HttpOnly, so only the server can delete it. Ask the backend to
      // (logout needs no valid session and answers with a cookie-clearing Set-Cookie). Without
      // this the route guard would see the stale cookie and bounce /login back to a page that
      // 401s again: a redirect loop.
      api
        .logout()
        .catch(() => {})
        .finally(() => {
          qc.clear();
          // Read the location at call time (not via usePathname) so the shell does not subscribe
          // to the URL, which Cache Components would force behind a Suspense boundary.
          const here = window.location.pathname + window.location.search;
          router.replace(`/login?next=${encodeURIComponent(here)}`);
        });
    });
    return () => setUnauthorizedHandler(null);
  }, [qc, router]);

  return (
    <>
      <SkipLink />
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
