import { TierBadge } from "@/components/ui/badge";
import { TIER_META, TIERS, type Tier } from "@/lib/tier";
import { cn } from "@/lib/cn";
import { SceneShell } from "./scene-shell";

// Fictional companies and roles, for illustration only.
const SAMPLE: Record<Tier, { title: string; company: string; score: number }[]> = {
  startup: [
    { title: "Platform Engineer", company: "Lumen Labs", score: 86 },
    { title: "Backend Engineer, APIs", company: "Parcelwise", score: 79 },
    { title: "Full-stack Engineer", company: "Quillnote", score: 68 },
  ],
  mid: [
    { title: "Data Platform Engineer", company: "Northwind Health", score: 77 },
    { title: "Software Engineer", company: "Orbit Systems", score: 72 },
    { title: "Platform Engineer", company: "Harbor Labs", score: 66 },
  ],
  mnc: [
    { title: "Backend Developer", company: "Meridian Group", score: 74 },
    { title: "Cloud Engineer", company: "Halcyon Global", score: 68 },
    { title: "Systems Developer", company: "Vantage Corp", score: 63 },
  ],
};

/** Scene 3: results land in three company-size columns. Sample data, labelled as such. */
export function SceneJobs() {
  return (
    <SceneShell
      id="jobs"
      step="3. Real openings, sorted"
      title="Startups, mid-size companies and MNCs, each scored for you."
      accent="startup"
      points={["Apply goes to the company's own page", "A score, a one-line reason, strengths and gaps", "Paste any posting to add it yourself"]}
      visual={
        <div aria-hidden className="w-full max-w-2xl">
          <div className="grid grid-cols-3 gap-3 sm:gap-4">
            {TIERS.map((t) => (
              <div key={t} data-el="column" className="rounded-card bg-ink/[0.03] p-3 sm:p-4">
                <div data-el="column-head"><TierBadge tier={t} short /></div>
                <div className="mt-3 flex flex-col gap-3">
                  {SAMPLE[t].map((j) => (
                    <div key={j.title} data-el="job" className="relative rounded-control border border-border bg-surface p-3 shadow-1 sm:p-3.5">
                      <span className={cn("absolute inset-x-2.5 top-0 h-0.5 rounded-b-full", TIER_META[t].swatch)} />
                      <p className="text-small font-semibold leading-snug sm:text-body">{j.title}</p>
                      <p className="text-caption text-muted sm:text-small">{j.company}</p>
                      <p className={cn("mt-2 text-small font-semibold tabular-nums", TIER_META[t].text)}>{j.score}<span className="font-normal text-muted"> match</span></p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-center text-caption text-muted">Sample data, for illustration.</p>
        </div>
      }
    >
      <p>NextRole reads the public job boards of the companies it watches, so every opening is real and the Apply button goes to the company&apos;s own page.</p>
      <p>Each match comes with a score and a one-line reason, the strengths that line up and the gaps to be ready for. We never scrape LinkedIn, Indeed or Naukri.</p>
    </SceneShell>
  );
}
