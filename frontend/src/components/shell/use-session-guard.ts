"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { setUnauthorizedHandler } from "@/lib/api/client";
import { api } from "@/lib/api/endpoints";

/**
 * Registers the app-wide 401 handler: ANY expired session lands here, clears cached data and
 * sends the user to /login with a return path. Shared by every signed-in layout (app shell and
 * the focused onboarding flow).
 */
export function useSessionGuard() {
  const router = useRouter();
  const qc = useQueryClient();

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
          // Read the location at call time (not via usePathname) so callers do not subscribe
          // to the URL, which Cache Components would force behind a Suspense boundary.
          const here = window.location.pathname + window.location.search;
          router.replace(`/login?next=${encodeURIComponent(here)}`);
        });
    });
    return () => setUnauthorizedHandler(null);
  }, [qc, router]);
}
