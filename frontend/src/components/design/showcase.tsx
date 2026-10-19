"use client";

import { ArrowRight, Briefcase, Search, Sparkles } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Badge, TierBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Progress } from "@/components/ui/progress";
import { ScoreRing } from "@/components/ui/score-ring";
import { Sheet } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { StepIndicator } from "@/components/ui/step-indicator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Timeline } from "@/components/ui/timeline";
import { toast } from "@/components/ui/toast";
import { Tooltip } from "@/components/ui/tooltip";
import { TIER_META, TIERS, type Tier } from "@/lib/tier";

const COLOR_GROUPS: { title: string; items: { name: string; cls: string; note?: string }[] }[] = [
  {
    title: "Surfaces and text",
    items: [
      { name: "bg", cls: "bg-bg border border-border", note: "#FAF8F5" },
      { name: "surface", cls: "bg-surface border border-border", note: "#FFFFFF" },
      { name: "ink", cls: "bg-ink", note: "#14161A" },
      { name: "muted", cls: "bg-muted", note: "#6B7280" },
      { name: "border", cls: "bg-border", note: "#E8E4DD" },
      { name: "primary", cls: "bg-primary", note: "#4F46E5" },
    ],
  },
  {
    title: "Tiers (fills) and their AA-safe text ink",
    items: [
      { name: "startup", cls: "bg-startup", note: "#FF6B4A" },
      { name: "startup-ink", cls: "bg-startup-ink", note: "text 5.9:1" },
      { name: "mid", cls: "bg-mid", note: "#14B8A6" },
      { name: "mid-ink", cls: "bg-mid-ink", note: "text 5.5:1" },
      { name: "mnc", cls: "bg-mnc", note: "#2563EB" },
      { name: "mnc-ink", cls: "bg-mnc-ink", note: "text 6.7:1" },
    ],
  },
  {
    title: "Status",
    items: [
      { name: "success", cls: "bg-success", note: "#16A34A" },
      { name: "success-ink", cls: "bg-success-ink", note: "text 5.0:1" },
      { name: "warning", cls: "bg-warning", note: "#F59E0B" },
      { name: "warning-ink", cls: "bg-warning-ink", note: "text 5.0:1" },
      { name: "danger", cls: "bg-danger", note: "#DC2626" },
      { name: "danger-ink", cls: "bg-danger-ink", note: "on tint" },
    ],
  },
];

const TYPE_SCALE = [
  { name: "display-xl", cls: "font-display text-display-xl", sample: "Land the role you want" },
  { name: "display-lg", cls: "font-display text-display-lg", sample: "Outreach that sounds like you" },
  { name: "display", cls: "font-display text-display", sample: "Jobs sorted for you" },
  { name: "h1 / 32", cls: "text-h1 font-semibold tracking-tight", sample: "Your matches" },
  { name: "h2 / 24", cls: "text-h2 font-semibold tracking-tight", sample: "Mid-size companies" },
  { name: "h3 / 20", cls: "text-h3 font-semibold", sample: "Backend Engineer, Payments" },
  { name: "body-lg / 18", cls: "text-body-lg", sample: "We read your resume and found 38 openings that fit." },
  { name: "body / 16", cls: "text-body", sample: "Python and FastAPI experience lines up with the role's API work." },
  { name: "small / 14", cls: "text-small", sample: "Remote (EU) · Posted 3 days ago" },
  { name: "caption / 12", cls: "text-caption text-muted", sample: "Match score is a heuristic estimate" },
];

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-24 border-t border-border py-12">
      <h2 id={`${id}-h`} className="mb-8 text-h2 font-semibold tracking-tight">
        {title}
      </h2>
      {children}
    </section>
  );
}

const SAMPLE_JOBS: { tier: Tier; title: string; company: string; where: string; score: number; why: string }[] = [
  { tier: "startup", title: "Software Engineer, Backend", company: "Linear", where: "Remote (EU)", score: 86, why: "Your FastAPI and PostgreSQL work matches their API-first stack." },
  { tier: "mid", title: "Backend Engineer, Payments", company: "Mercury", where: "New York · Hybrid", score: 72, why: "Strong SQL background; limited exposure to payment systems." },
  { tier: "mnc", title: "Software Engineer II", company: "Stripe", where: "Dublin", score: 64, why: "Right level and language, but the role expects more production scale." },
];

export function DesignShowcase() {
  const [tab, setTab] = useState<Tier>("startup");
  const [modal, setModal] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [step, setStep] = useState(1);
  const [score, setScore] = useState(48);

  return (
    <main id="main" className="page-container pb-24 pt-12">
      <header className="mb-4 max-w-3xl">
        <Badge tone="primary" className="mb-4">
          <Sparkles className="size-3" aria-hidden /> Design system v1
        </Badge>
        <h1 className="font-display text-display-xl text-balance">Paper &amp; Ink</h1>
        <p className="mt-4 text-body-lg text-muted">
          The tokens and components behind NextRole: calm paper-white surfaces, ink-dark text, one indigo
          accent, and three tier colours that mean the same thing on every screen.
        </p>
        <nav aria-label="Sections" className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-small">
          {["colors", "type", "buttons", "badges", "forms", "tabs", "cards", "feedback", "overlays", "progress"].map((s) => (
            <a key={s} href={`#${s}`} className="link-underline capitalize text-primary">
              {s}
            </a>
          ))}
        </nav>
      </header>

      <Section id="colors" title="Colour">
        <div className="flex flex-col gap-8">
          {COLOR_GROUPS.map((g) => (
            <div key={g.title}>
              <h3 className="mb-3 text-small font-semibold text-muted">{g.title}</h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                {g.items.map((c) => (
                  <div key={c.name} className="rounded-card border border-border bg-surface p-2 shadow-1">
                    <div className={`h-16 rounded-[10px] ${c.cls}`} />
                    <p className="mt-2 px-1 text-small font-medium">{c.name}</p>
                    <p className="px-1 text-caption text-muted">{c.note}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <p className="max-w-2xl text-small text-muted">
            Coral, teal and amber are too light to read as text on white (2.1 to 2.8:1), so they are used for fills,
            rings and glows. Text uses the matching <code className="font-mono text-caption">-ink</code> shade. Buttons
            filled with coral or teal use ink text. A unit test enforces these ratios.
          </p>
        </div>
      </Section>

      <Section id="type" title="Typography">
        <div className="flex flex-col divide-y divide-border">
          {TYPE_SCALE.map((t) => (
            <div key={t.name} className="grid items-baseline gap-2 py-4 md:grid-cols-[10rem_1fr]">
              <span className="font-mono text-caption text-muted">{t.name}</span>
              <span className={t.cls}>{t.sample}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section id="buttons" title="Buttons">
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap items-center gap-3">
            <Button magnetic>
              Get started <ArrowRight className="size-4" aria-hidden />
            </Button>
            <Button variant="secondary">Draft outreach</Button>
            <Button variant="ghost">Skip for now</Button>
            <Button variant="danger">Delete my data</Button>
            <Button disabled>Disabled</Button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="startup">Startups</Button>
            <Button variant="mid">Mid-size</Button>
            <Button variant="mnc">MNCs</Button>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <Button size="sm">Small</Button>
            <Button size="md">Medium</Button>
            <Button size="lg">Large</Button>
            <Button size="icon" variant="secondary" aria-label="Search jobs">
              <Search className="size-5" aria-hidden />
            </Button>
          </div>
        </div>
      </Section>

      <Section id="badges" title="Badges and chips">
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap gap-2">
            {TIERS.map((t) => (
              <TierBadge key={t} tier={t} />
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge>Neutral</Badge>
            <Badge tone="primary">Reviewer passed</Badge>
            <Badge tone="success">Approved</Badge>
            <Badge tone="warning">Needs review</Badge>
            <Badge tone="danger">Failed</Badge>
            <Badge tone="outline">Remote</Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            <Chip>Python</Chip>
            <Chip>FastAPI</Chip>
            <Chip tone="good">PostgreSQL experience</Chip>
            <Chip tone="gap">No Kubernetes</Chip>
            <Chip tone="primary" onRemove={() => toast("Removed Docker", { variant: "info" })} removeLabel="Remove Docker">
              Docker
            </Chip>
          </div>
        </div>
      </Section>

      <Section id="forms" title="Form controls">
        <div className="grid max-w-3xl gap-5 sm:grid-cols-2">
          <Field label="Desired roles" hint="Comma separated, e.g. Backend Engineer, Data Engineer">
            <Input placeholder="Backend Engineer" />
          </Field>
          <Field label="Experience level">
            <Select defaultValue="Junior">
              <option>Intern / New grad</option>
              <option>Junior</option>
              <option>Mid</option>
              <option>Senior</option>
            </Select>
          </Field>
          <Field label="Email" error="Enter a valid email address.">
            <Input type="email" defaultValue="priya@" />
          </Field>
          <Field label="Anything else we should know?" className="sm:col-span-2">
            <Textarea placeholder="e.g. I prefer small teams and no on-call." />
          </Field>
        </div>
      </Section>

      <Section id="tabs" title="Tabs and tier cards">
        <Tabs value={tab} onValueChange={(v) => setTab(v as Tier)}>
          <TabsList aria-label="Company type">
            {TIERS.map((t) => (
              <TabsTrigger key={t} value={t} accent={t}>
                {TIER_META[t].label}
              </TabsTrigger>
            ))}
          </TabsList>
          {TIERS.map((t) => (
            <TabsContent key={t} value={t}>
              <p className="mb-4 text-small text-muted">{TIER_META[t].blurb}</p>
            </TabsContent>
          ))}
        </Tabs>
      </Section>

      <Section id="cards" title="Cards">
        <div className="grid gap-5 lg:grid-cols-3">
          {SAMPLE_JOBS.map((j) => (
            <Card key={j.title} tier={j.tier} interactive data-cursor="view">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <TierBadge tier={j.tier} short className="mb-2" />
                  <CardTitle className="text-body-lg">{j.title}</CardTitle>
                  <CardDescription className="mt-1">
                    {j.company} · {j.where}
                  </CardDescription>
                </div>
                <ScoreRing value={j.score} tone={j.tier} label={`Match score for ${j.title}`} caption="match" />
              </div>
              <p className="mt-4 text-small text-ink/80">{j.why}</p>
              <div className="mt-5 flex flex-wrap gap-2">
                <Button size="sm">Apply</Button>
                <Button size="sm" variant="secondary">
                  Draft outreach
                </Button>
              </div>
            </Card>
          ))}
        </div>
      </Section>

      <Section id="feedback" title="Feedback, loading and empty states">
        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Skeleton loaders</CardTitle>
              <CardDescription>Shown while matches load.</CardDescription>
            </CardHeader>
            <div className="flex items-start gap-4">
              <Skeleton className="size-[72px] rounded-full" />
              <div className="flex-1 space-y-2.5">
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-4 w-full" />
              </div>
            </div>
          </Card>
          <EmptyState
            icon={<Briefcase />}
            title="No matches yet"
            description="Search the job boards and we will score the best openings against your profile."
            action={<Button size="sm">Find matches</Button>}
          />
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button variant="secondary" onClick={() => toast("Draft saved", { variant: "success", description: "Your edits are stored." })}>
            Success toast
          </Button>
          <Button variant="secondary" onClick={() => toast("Reviewer flagged 2 claims", { variant: "warning" })}>
            Warning toast
          </Button>
          <Button variant="secondary" onClick={() => toast("Could not reach the server", { variant: "error", description: "Check your connection and try again." })}>
            Error toast
          </Button>
          <Tooltip content="Researcher: reads public sources about the company, with citations.">
            <Button variant="ghost">Hover or focus me</Button>
          </Tooltip>
        </div>
      </Section>

      <Section id="overlays" title="Modal and sheet">
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" onClick={() => setModal(true)}>
            Open modal
          </Button>
          <Button variant="secondary" onClick={() => setSheet(true)}>
            Open sheet
          </Button>
        </div>
        <Modal
          open={modal}
          onOpenChange={setModal}
          title="Delete your data?"
          description="This removes your profile, resume, drafts and run history. It cannot be undone."
          footer={
            <>
              <Button variant="ghost" onClick={() => setModal(false)}>
                Cancel
              </Button>
              <Button variant="danger" onClick={() => setModal(false)}>
                Delete everything
              </Button>
            </>
          }
        />
        <Sheet open={sheet} onOpenChange={setSheet} title="Menu">
          <nav aria-label="Example" className="flex flex-col gap-1 text-body">
            {["Dashboard", "Outreach", "ATS check", "Profile"].map((l) => (
              <a key={l} href="#overlays" className="rounded-control px-3 py-2 hover:bg-ink/5">
                {l}
              </a>
            ))}
          </nav>
        </Sheet>
      </Section>

      <Section id="progress" title="Progress, scores and steps">
        <div className="flex flex-col gap-10">
          <div>
            <StepIndicator
              current={step}
              steps={[
                { id: "roles", label: "Roles" },
                { id: "where", label: "Where & level" },
                { id: "resume", label: "Resume" },
                { id: "review", label: "Review" },
              ]}
            />
            <div className="mt-4 flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setStep((s) => Math.max(0, s - 1))}>
                Back
              </Button>
              <Button size="sm" onClick={() => setStep((s) => Math.min(3, s + 1))}>
                Next
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-8">
            <ScoreRing value={score} size={120} stroke={10} label="ATS score" caption="ATS" />
            <ScoreRing value={91} tone="primary" size={72} label="Critic score" />
            <ScoreRing value={23} size={72} label="Low match" />
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setScore(23)}>
                Low
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setScore(64)}>
                Medium
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setScore(92)}>
                High
              </Button>
            </div>
          </div>
          <div className="max-w-md">
            <Progress value={62} label="Profile completeness" />
            <p className="mt-2 text-caption text-muted">Profile 62% complete</p>
          </div>
          <Card className="max-w-xl">
            <CardHeader>
              <CardTitle>Agent timeline</CardTitle>
              <CardDescription>Live steps from a run.</CardDescription>
            </CardHeader>
            <Timeline
              items={[
                { id: "1", title: "Searching job boards", detail: "1,284 openings from 40 boards", status: "done", meta: "30.9s" },
                { id: "2", title: "Classifying companies", detail: "37 companies classified", status: "done", meta: "2.8s" },
                { id: "3", title: "Scoring fit against your profile", detail: "scored 24 of 40", status: "running", meta: "12.1s" },
                { id: "4", title: "Saving", status: "pending" },
              ]}
            />
          </Card>
        </div>
      </Section>
    </main>
  );
}
