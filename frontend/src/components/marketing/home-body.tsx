import type { ReactNode } from "react";
import { Faq, FinalCta } from "./faq-cta";
import { SceneAgents } from "./scene-agents";
import { SceneAts } from "./scene-ats";
import { SceneJobs } from "./scene-jobs";
import { SceneOutreach } from "./scene-outreach";
import { SceneResume } from "./scene-resume";
import { ScrollStory } from "./scroll-story";
import { TierMarquee } from "./tier-marquee";

/**
 * The homepage composition. The hero is passed in (the page streams it with real data; tests pass a
 * static one), everything else is plain static HTML that `ScrollStory` enhances.
 */
export function HomeBody({ hero }: { hero: ReactNode }) {
  return (
    <ScrollStory>
      <main id="main">
        {hero}
        <TierMarquee />
        <div id="how-it-works" className="scroll-mt-16 pt-[var(--section-y)] lg:pt-0">
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
