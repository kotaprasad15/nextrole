import type { MetadataRoute } from "next";
import { PUBLIC_PATHS, SITE_URL } from "@/lib/site";

/** Only the public pages. Private routes (see robots.ts) are never listed. */
export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_PATHS.map((path) => ({
    url: `${SITE_URL}${path === "/" ? "" : path}`,
    changeFrequency: path === "/" ? "weekly" : "yearly",
    priority: path === "/" ? 1 : 0.5,
  }));
}
