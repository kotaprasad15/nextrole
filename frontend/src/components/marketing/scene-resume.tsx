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
      visual={
        <div aria-hidden className="relative mx-auto grid max-w-md gap-4 sm:grid-cols-[1fr_1.15fr] sm:items-center">
          <div data-el="resume" className="relative overflow-hidden rounded-card border border-border bg-surface p-4 shadow-2">
            <div className="mb-3 flex items-center gap-2 text-caption font-medium text-muted"><FileText className="size-4" /> priya-nair-resume.pdf</div>
            <div className="space-y-2">
              {[88, 64, 92, 40, 78, 70, 52, 84].map((w, i) => <div key={i} className="h-2 rounded-full bg-ink/10" style={{ width: `${w}%` }} />)}
            </div>
            <div data-el="scan" className="pointer-events-none absolute inset-x-0 top-0 h-10 bg-gradient-to-b from-primary/0 via-primary/20 to-primary/0 opacity-0" />
          </div>
          <div data-el="profile" className="rounded-card border border-border bg-surface p-4 shadow-3">
            <p className="font-display text-h2">Priya Nair</p>
            <p className="text-caption text-muted">Backend engineer · Leeds · Remote OK</p>
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {SKILLS.map((s) => <li key={s} data-el="chip"><Chip tone="primary">{s}</Chip></li>)}
            </ul>
            <p className="mt-3 text-caption text-muted">Looking for: Backend Engineer</p>
          </div>
        </div>
      }
    >
      <p>Upload a PDF or Word resume and say what you are looking for. NextRole pulls out your experience, projects and skills, and you fix anything it got wrong.</p>
      <p>Everything later is built from this profile, and the drafts can only mention what is in it. Your resume is stored encrypted and you can delete it at any time.</p>
    </SceneShell>
  );
}
