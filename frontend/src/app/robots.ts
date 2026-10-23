import type { MetadataRoute } from "next";
import { PROTECTED_PREFIXES } from "@/lib/route-guard";
import { SITE_URL } from "@/lib/site";

/**
 * robots.txt is a request to well-behaved crawlers, NOT a security control: it is public, and a
 * disallow line even advertises the path. Every private route is protected by authentication
 * (src/proxy.ts for pages, session + role checks in the FastAPI backend for data), and admin
 * routes additionally require the admin role ON THE SERVER. Never rely on this file to hide
 * anything.
 *
 * The disallow list reuses the route guard's protected prefixes so the two cannot drift apart,
 * plus the API proxy and the internal design page.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api", "/design", "/unsubscribe", ...PROTECTED_PREFIXES],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
