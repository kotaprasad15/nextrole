import type { Metadata } from "next";
import { Suspense } from "react";
import { Hero } from "@/components/marketing/hero";
import { HomeBody } from "@/components/marketing/home-body";
import { getFeaturedJobs } from "@/lib/marketing/hero-data";

export const metadata: Metadata = {
  title: { absolute: "NextRole: find the role, write the email" },
  description: "Upload your resume, see real openings sorted by company type, and get outreach drafts built only from facts you can check. You send them.",
};

/** Hero with real postings from the backend (cached; falls back to a generic card when none are available). */
async function HeroWithData() {
  return <Hero jobs={await getFeaturedJobs()} />;
}

/**
 * Homepage. Every scene is complete static HTML (works without JS and with reduced motion);
 * `ScrollStory` layers the smooth scrolling, pinned scenes and reveals on top.
 */
export default function Home() {
  return (
    <HomeBody
      // The fallback is the same hero with no jobs, so nothing shifts when real data streams in.
      hero={
        <Suspense fallback={<Hero jobs={[]} />}>
          <HeroWithData />
        </Suspense>
      }
    />
  );
}
