import type { NextConfig } from "next";

// The FastAPI backend. The browser only ever talks to this app (`/api/*`), so the HttpOnly
// session cookie is same-origin and the backend needs no CORS configuration.
const BACKEND_URL = process.env.BACKEND_URL ?? "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  // Dev only: lets http://127.0.0.1:3100 load Next's dev resources (HMR, chunks). Useful because
  // cookies are per-host, so 127.0.0.1 gives a clean session separate from localhost.
  allowedDevOrigins: ["127.0.0.1"],
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async rewrites() {
    // Filesystem routes win over these, so app/api/runs/[id]/events/route.ts (the SSE stream)
    // handles its own path and everything else is proxied straight through.
    return [{ source: "/api/:path*", destination: `${BACKEND_URL}/:path*` }];
  },
};

export default nextConfig;
