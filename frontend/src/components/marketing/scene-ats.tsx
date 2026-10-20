import { ATS_TO, RING_C, RING_R } from "@/lib/marketing/constants";
import { SceneShell } from "./scene-shell";

const KEYWORDS = ["Python", "FastAPI", "PostgreSQL", "Docker", "CI/CD", "Unit testing"];

/** Scene 5: the ATS check. The static page shows the improved result; the motion layer plays it from the weak start. */
export function SceneAts() {
  return (
    <SceneShell
      id="ats"
      step="5. Check your resume"
      title="See which keywords a filter would catch, and which it would miss."
      visual={
        <div aria-hidden className="mx-auto flex max-w-md flex-col items-center gap-6 rounded-card border border-border bg-surface p-6 shadow-3">
          <div className="relative size-36">
            <svg viewBox="0 0 120 120" className="size-full -rotate-90">
              <circle cx="60" cy="60" r={RING_R} fill="none" stroke="var(--color-border)" strokeWidth="10" />
              <circle data-el="ring" cx="60" cy="60" r={RING_R} fill="none" stroke="var(--color-success)" strokeWidth="10" strokeLinecap="round" strokeDasharray={RING_C} strokeDashoffset={RING_C * (1 - ATS_TO / 100)} />
            </svg>
            <div className="absolute inset-0 grid place-items-center text-center">
              <div>
                <p data-el="ats-score" className="font-display text-display-lg leading-none tabular-nums">{ATS_TO}</p>
                <p className="text-caption text-muted">of 100</p>
              </div>
            </div>
          </div>
          <ul className="flex flex-wrap justify-center gap-2">
            {KEYWORDS.map((k, i) => (
              <li key={k} data-el="kw" className="relative">
                {/* Two stacked states: "missing" fades out and "found" fades in as the score climbs. */}
                <span data-el="kw-missing" className="absolute inset-0 grid place-items-center rounded-full border border-warning/40 bg-warning-tint px-3 py-1 text-small text-warning-ink opacity-0">{k}</span>
                <span data-el="kw-found" data-i={i} className="inline-block rounded-full border border-success/30 bg-success-tint px-3 py-1 text-small text-success-ink">{k}</span>
              </li>
            ))}
          </ul>
          <p className="text-caption text-muted">Sample resume and posting, for illustration.</p>
        </div>
      }
    >
      <p>Paste a job description and add your resume. NextRole compares keywords, sections and formatting and tells you what to fix, section by section.</p>
      <p>It runs entirely in your browser, with no upload and no AI model. It is a heuristic estimate, not any employer&apos;s real system, and it only ever suggests adding skills you really have.</p>
    </SceneShell>
  );
}
