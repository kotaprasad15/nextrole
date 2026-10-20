import { FileText } from "lucide-react";
import { Chip } from "@/components/ui/chip";
import { SceneShell } from "./scene-shell";

const SKILLS = ["Python", "FastAPI", "PostgreSQL", "SQL", "Docker", "React"];

/** Scene 1: a resume becomes a structured profile. Decorative visual; the copy carries the meaning. */
export function SceneResume() {
  return (
    <SceneShell
      id="resume"
      step="1. Start with your resume"
      title="Drop it in. We read it once and build your profile."
      accent="primary"
      points={["PDF or Word, up to 5 MB", "You review and fix whatever it found", "Stored encrypted, deleted whenever you say"]}
      visual={
        <div aria-hidden className="relative w-full max-w-2xl">
        <div className="grid gap-5 sm:grid-cols-[1fr_1.1fr] sm:items-stretch">
          <div data-el="resume" className="relative overflow-hidden rounded-card border border-border bg-surface p-5 shadow-2">
            <div className="mb-4 flex items-center gap-2 text-small font-medium text-muted"><FileText className="size-4" /> priya-nair-resume.pdf</div>
            <div className="space-y-2.5">
              {[88, 64, 92, 40, 78, 70, 52, 84, 60, 74, 90, 46, 80, 58].map((w, i) => <div key={i} className="h-2.5 rounded-full bg-ink/10" style={{ width: `${w}%` }} />)}
            </div>
            <div data-el="scan" className="pointer-events-none absolute inset-x-0 top-0 h-12 bg-gradient-to-b from-primary/0 via-primary/20 to-primary/0 opacity-0" />
          </div>
          <div data-el="profile" className="rounded-card border border-border bg-surface p-5 shadow-3">
            <p className="font-display text-h1">Priya Nair</p>
            <p className="text-small text-muted">Backend engineer · Leeds · Remote OK</p>
            <ul className="mt-4 flex flex-wrap gap-2">
              {SKILLS.map((s) => <li key={s} data-el="chip"><Chip tone="primary" className="text-body">{s}</Chip></li>)}
            </ul>
            <dl className="mt-5 space-y-3 border-t border-border pt-4 text-small">
              <div><dt className="font-medium">Experience</dt><dd className="text-muted">Backend Engineering Intern, Finlytics</dd></div>
              <div><dt className="font-medium">Education</dt><dd className="text-muted">BSc Computer Science, University of Leeds</dd></div>
              <div><dt className="font-medium">Looking for</dt><dd className="text-muted">Backend Engineer</dd></div>
            </dl>
          </div>
        </div>
        <p className="mt-4 text-center text-caption text-muted">Sample resume, for illustration.</p>
        </div>
      }
    >
      <p>Upload a PDF or Word resume and say what you are looking for. NextRole pulls out your experience, projects and skills.</p>
      <p>Everything later is built from this profile, and the drafts can only mention what is in it.</p>
    </SceneShell>
  );
}
