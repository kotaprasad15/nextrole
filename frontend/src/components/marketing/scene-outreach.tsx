import { CheckCircle2 } from "lucide-react";
import { Chip } from "@/components/ui/chip";
import { OUTREACH_SCORE } from "@/lib/marketing/constants";
import { SceneShell } from "./scene-shell";

/** Scene 4: a draft writes itself, cites its facts and is reviewed. A sample; the user approves and sends. */
export function SceneOutreach() {
  return (
    <SceneShell
      id="outreach"
      step="4. Outreach that sounds like you"
      title="A draft built only from facts it can show you."
      flip
      accent="mnc"
      points={["Every claim cites a fact you can see", "A reviewer flags what it cannot back up", "You approve it. NextRole never sends."]}
      visual={
        <div aria-hidden className="w-full max-w-xl rounded-card border border-border bg-surface p-6 shadow-3">
          <div data-el="mail-head" className="border-b border-border pb-3 text-small text-muted">
            <p>To: <span className="text-ink">talent@lumenlabs.example</span></p>
            <p className="mt-0.5">Subject: <span className="font-medium text-ink">FastAPI and PostgreSQL work for the Platform role</span></p>
          </div>
          <div className="mt-4 space-y-3 text-body leading-relaxed">
            <p data-el="line">Hi there,</p>
            <p data-el="line">At Finlytics I built REST endpoints in FastAPI for an invoicing service and wrote the PostgreSQL migrations behind its reporting tables, which is close to the API work in your posting.</p>
            <p data-el="line">Could you point me to the right person to talk to about this role?</p>
            <p data-el="line">Priya Nair</p>
          </div>
          <div data-el="facts" className="mt-3 flex flex-wrap gap-1.5">
            <Chip tone="plain">F-P4 profile</Chip>
            <Chip tone="plain">F-J2 posting</Chip>
          </div>
          <ol className="mt-4 space-y-1.5 text-small text-muted" aria-hidden>
            <li className="flex justify-between"><span>Attempt 1</span><span>Reviewer 71: asked for a rewrite</span></li>
            <li className="flex justify-between"><span>Attempt 2</span><span className="font-medium text-success-ink">Reviewer passed</span></li>
          </ol>
          <div className="mt-3 flex items-center justify-between rounded-control bg-success-tint px-3 py-2">
            <span data-el="critic" className="flex items-center gap-1.5 text-small font-semibold text-success-ink">
              <CheckCircle2 className="size-4" /> Reviewer <span data-el="score" className="tabular-nums">{OUTREACH_SCORE}</span>/100
            </span>
            <span data-el="approve" className="rounded-full bg-primary px-3 py-1 text-caption font-semibold text-on-primary">Approve</span>
          </div>
          <p className="mt-2 text-center text-caption text-muted">Sample draft, for illustration.</p>
        </div>
      }
    >
      <p>The Researcher gathers sourced facts about the company. The Writer may only use those and the facts in your profile, and has to cite each one.</p>
      <p>The Critic then checks the draft and can send it back for a rewrite. You read it, edit it and approve it. NextRole never sends a message for you.</p>
    </SceneShell>
  );
}
