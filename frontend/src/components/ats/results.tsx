"use client";

import { ArrowRight, Check, CircleAlert, X } from "lucide-react";
import type { RefObject } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Progress } from "@/components/ui/progress";
import { ScoreRing } from "@/components/ui/score-ring";
import { WEIGHTS, type AtsResult, type KeywordResult } from "@/lib/ats/analyze";

const band = (s: number) => (s >= 75 ? "Strong match" : s >= 50 ? "Fair match" : "Needs work");
const SEVERITY = { high: "danger", medium: "warning", low: "neutral" } as const;
const SEVERITY_LABEL = { high: "Fix first", medium: "Worth fixing", low: "Minor" } as const;

function KeywordGroup({ title, items, tone }: { title: string; items: KeywordResult[]; tone: "good" | "gap" }) {
  if (!items.length) return null;
  return (
    <div>
      <h4 className="text-small font-semibold">{title}</h4>
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {items.map((k) => (
          <li key={k.term}>
            <Chip tone={tone}>
              {k.display}
              {k.importance !== "general" && <span className="text-caption opacity-80"> · {k.importance === "required" ? "required" : "preferred"}</span>}
            </Chip>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Everything the check found, in the order a person would act on it. */
export function AtsResults({ result, headingRef }: { result: AtsResult; headingRef: RefObject<HTMLHeadingElement | null> }) {
  const r = result;
  const gain = r.projectedScore - r.score;
  const parts = [
    { label: "Keyword match", value: r.breakdown.keywords, weight: WEIGHTS.keywords },
    { label: "Sections present", value: r.breakdown.sections, weight: WEIGHTS.sections },
    { label: "Formatting", value: r.breakdown.formatting, weight: WEIGHTS.formatting },
  ];
  const missReq = r.missing.filter((k) => k.importance === "required");
  const missPref = r.missing.filter((k) => k.importance === "preferred");
  const missGen = r.missing.filter((k) => k.importance === "general");

  return (
    <section aria-labelledby="ats-results" className="flex flex-col gap-6">
      <Card className="p-6 md:p-8">
        <div className="flex flex-wrap items-center gap-8">
          <ScoreRing value={r.score} size={132} stroke={11} label="Estimated ATS match score" caption="of 100" />
          <div className="min-w-0 flex-1">
            <h2 id="ats-results" ref={headingRef} tabIndex={-1} className="font-display text-display outline-none">{band(r.score)}</h2>
            <p className="mt-1 text-body text-muted">
              {r.matched.length} of {r.keywords.length} keywords from the posting appear in your resume.
            </p>
            {gain > 0 && (
              <p className="mt-4 inline-flex flex-wrap items-center gap-2 rounded-control bg-primary-tint px-3.5 py-2.5 text-small">
                <span className="font-semibold tabular-nums">{r.score}</span>
                <ArrowRight className="size-4 text-primary" aria-hidden />
                <span className="font-semibold tabular-nums text-primary">{r.projectedScore}</span>
                <span className="text-ink/85">if you truthfully add the missing required and preferred keywords</span>
              </p>
            )}
          </div>
        </div>
        <ul className="mt-8 grid gap-5 md:grid-cols-3">
          {parts.map((p) => (
            <li key={p.label}>
              <div className="mb-1.5 flex justify-between text-small">
                <span className="font-medium">{p.label}</span>
                <span className="tabular-nums text-muted">{p.value} <span className="text-caption">({Math.round(p.weight * 100)}% of score)</span></span>
              </div>
              <Progress value={p.value} label={p.label} />
            </li>
          ))}
        </ul>
        <p className="mt-6 text-caption text-muted">
          This is a heuristic estimate from keyword coverage, structure and formatting, not the score of any employer&apos;s system. Your resume was analysed in this browser and never uploaded.
        </p>
      </Card>

      <Card>
        <CardTitle>Keywords</CardTitle>
        <CardDescription className="mt-1">Terms found in the job description, checked against your resume.</CardDescription>
        {r.noKeywords ? (
          <p className="mt-4 text-small text-muted">We could not find recognisable skills in that job description. Paste the full posting, including the requirements.</p>
        ) : (
          <div className="mt-5 flex flex-col gap-5">
            <KeywordGroup title={`In your resume (${r.matched.length})`} items={r.matched} tone="good" />
            <KeywordGroup title={`Missing, required (${missReq.length})`} items={missReq} tone="gap" />
            <KeywordGroup title={`Missing, preferred (${missPref.length})`} items={missPref} tone="gap" />
            <KeywordGroup title={`Missing, mentioned in the posting (${missGen.length})`} items={missGen} tone="gap" />
          </div>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardTitle>Sections</CardTitle>
          <ul className="mt-4 flex flex-col gap-2.5">
            {r.sections.map((s) => (
              <li key={s.id} className="flex items-center gap-2.5 text-small">
                {s.found ? <Check className="size-4 text-success-ink" aria-hidden /> : <X className="size-4 text-danger-ink" aria-hidden />}
                <span>{s.label}</span>
                <span className="text-muted">{s.found ? "found" : s.required ? "not found" : "not found (optional)"}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardTitle>Formatting</CardTitle>
          {r.issues.length === 0 ? (
            <p className="mt-4 flex items-center gap-2 text-small"><Check className="size-4 text-success-ink" aria-hidden /> No formatting problems found.</p>
          ) : (
            <ul className="mt-4 flex flex-col gap-4">
              {r.issues.map((i) => (
                <li key={i.id}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={SEVERITY[i.severity]}>{SEVERITY_LABEL[i.severity]}</Badge>
                    <p className="text-small font-semibold">{i.title}</p>
                  </div>
                  <p className="mt-1 text-small text-muted">{i.detail}</p>
                  <p className="mt-1 text-small"><span className="font-medium">Fix: </span>{i.fix}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {r.suggestions.length > 0 && (
        <Card>
          <CardTitle>What to change, section by section</CardTitle>
          <div className="mt-4 grid gap-5 md:grid-cols-2">
            {r.suggestions.map((s, idx) => (
              <div key={`${s.section}-${idx}`}>
                <h4 className="text-small font-semibold text-primary">{s.section}</h4>
                <ul className="mt-1.5 list-disc pl-5 text-small text-ink/85">
                  {s.tips.map((t) => <li key={t} className="mt-1">{t}</li>)}
                </ul>
              </div>
            ))}
          </div>
          <p className="mt-5 flex items-start gap-2 rounded-control bg-warning-tint px-3.5 py-3 text-small">
            <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning-ink" aria-hidden />
            Only add skills you really have. Keyword stuffing is easy to spot in an interview, and NextRole never writes claims for you.
          </p>
        </Card>
      )}
    </section>
  );
}
