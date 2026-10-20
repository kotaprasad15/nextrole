import type { Metadata } from "next";
import { Faq, FinalCta } from "@/components/marketing/faq-cta";
import { Hero } from "@/components/marketing/hero";
import { SceneAgents } from "@/components/marketing/scene-agents";
import { SceneAts } from "@/components/marketing/scene-ats";
import { SceneJobs } from "@/components/marketing/scene-jobs";
import { SceneOutreach } from "@/components/marketing/scene-outreach";
import { SceneResume } from "@/components/marketing/scene-resume";
import { ScrollStory } from "@/components/marketing/scroll-story";

export const metadata: Metadata = {
  title: { absolute: "NextRole: find the role, write the email" },
  description: "Upload your resume, see real openings sorted by company type, and get outreach drafts built only from facts you can check. You send them.",
};

/**
 * Homepage. Every scene is complete static HTML (works without JS and with reduced motion);
 * `ScrollStory` layers the smooth scrolling, pinned scenes and reveals on top.
 */
export default function Home() {
  return (
    <ScrollStory>
      <main id="main">
        <Hero />
        <div id="how-it-works" className="scroll-mt-16">
          <SceneResume />
          <SceneAgents />
          <SceneJobs />
          <SceneOutreach />
          <SceneAts />
        </div>
        <Faq />
        <FinalCta />
      </main>
    </ScrollStory>
  );
}
