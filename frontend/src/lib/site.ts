/** Public origin used for absolute URLs (sitemap, robots). Set NEXT_PUBLIC_SITE_URL in production. */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3100").replace(/\/+$/, "");

/** Public marketing/auth pages that belong in the sitemap. */
export const PUBLIC_PATHS = ["/", "/login", "/signup"] as const;
