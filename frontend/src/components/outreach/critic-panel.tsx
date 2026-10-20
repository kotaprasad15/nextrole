import { CheckCircle2, TriangleAlert } from "lucide-react";
import { Card, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ScoreRing } from "@/components/ui/score-ring";
import type { CriticReport } from "@/lib/api/schemas";
import { criterionLabel } from "@/lib/outreach";

/**
 * The reviewer's verdict: overall score, per-criterion bars, and anything it could not verify.
 * The reviewer is another AI pass, so the copy reminds the user that they are the final check.
 */
export function CriticPanel({ critic, attempts }: { critic: CriticReport | null; attempts: number }) {
  if (!critic) {
    return (
      <Card>
        <CardTitle>Reviewer</CardTitle>
        <p className="mt-2 text-small text-muted">
          This draft has not been checked since your last edit. Read it carefully before approving: every claim should be something you can back up.
        </p>
      </Card>
    );
  }
  const pass = critic.verdict === "pass" && critic.unsupported_claims.length === 0 && critic.violations.length === 0;
  return (
    <Card>
      <div className="flex items-center gap-4">
        <ScoreRing value={critic.overall} size={64} stroke={6} label="Reviewer score" />
        <div>
          <CardTitle className="flex items-center gap-1.5">
            {pass ? <CheckCircle2 className="size-5 text-success-ink" aria-hidden /> : <TriangleAlert className="size-5 text-warning-ink" aria-hidden />}
            {pass ? "Reviewer passed" : "Reviewer flagged this"}
          </CardTitle>
          <p className="text-small text-muted">
            {attempts === 1 ? "Written once" : `Rewritten until it passed or ran out of tries (${attempts} drafts)`}
          </p>
        </div>
      </div>

      <ul className="mt-5 flex flex-col gap-3">
        {Object.entries(critic.scores).map(([key, value]) => (
          <li key={key}>
            <div className="mb-1 flex justify-between text-small">
              <span>{criterionLabel(key)}</span>
              <span className="tabular-nums text-muted">{Math.round(value)}</span>
            </div>
            <Progress value={value} label={criterionLabel(key)} />
          </li>
        ))}
      </ul>

      {critic.unsupported_claims.length > 0 && (
        <div className="mt-5 rounded-control bg-warning-tint p-3.5">
          <p className="text-small font-semibold text-warning-ink">Claims the reviewer could not verify</p>
          <ul className="mt-1.5 list-disc pl-5 text-small text-ink/85">
            {critic.unsupported_claims.map((c) => <li key={c}>{c}</li>)}
          </ul>
        </div>
      )}
      {critic.violations.length > 0 && (
        <div className="mt-3 rounded-control bg-danger-tint p-3.5">
          <p className="text-small font-semibold text-danger-ink">Rule violations</p>
          <ul className="mt-1.5 list-disc pl-5 text-small text-ink/85">
            {critic.violations.map((c) => <li key={c}>{c}</li>)}
          </ul>
        </div>
      )}
      <p className="mt-4 text-caption text-muted">The reviewer is an AI check and can be wrong. You are the final reader.</p>
    </Card>
  );
}
