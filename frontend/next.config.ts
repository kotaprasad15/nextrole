import type { NextConfig } from "next";

// The FastAPI backend. The browser only ever talks to this app (`/api/*`), so the HttpOnly
// session cookie is same-origin and the backend needs no CORS configuration.
const BACKEND_URL = process.env.BACKEND_URL ?? "http://127.0.0.1:8000";

const isDev = process.env.NODE_ENV === "development";

/**
 * Content Security Policy. We deliberately do NOT use per-request nonces: Next only applies them to
 * dynamically rendered pages, which would turn the static marketing site into a server-rendered one
 * (slower, uncacheable). What still holds without them: no `object`/`embed`, no foreign base URL,
 * forms and fetches only to ourselves, no framing, and React escapes everything we render (a test
 * bans `dangerouslySetInnerHTML`), so there is no inline-script injection point to abuse.
 * `'unsafe-inline'` is needed for Next's own bootstrap and the theme script. Revisit with
 * `experimental.sri` (hash-based, keeps static pages) once it leaves experimental.
 */
export const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
  "worker-src 'self' blob:", // pdf.js parses uploaded resumes in a worker
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CSP },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), interest-cohort=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // Browsers only honour HSTS over HTTPS, so it is harmless on plain-http localhost.
  ...(isDev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]),
];

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
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  async rewrites() {
    // Filesystem routes win over these, so app/api/runs/[id]/events/route.ts (the SSE stream)
    // handles its own path and everything else is proxied straight through.
    return [{ source: "/api/:path*", destination: `${BACKEND_URL}/:path*` }];
  },
};

export default nextConfig;
