"use client";

import { MessagesSquare, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Field, Input, Select } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { useInterviews, useMyInterviews } from "@/lib/api/queries";
import { LEVELS, OUTCOMES } from "@/lib/interviews";
import { ConfidentialityNotice } from "./confidentiality-notice";
import { ExperienceCard } from "./experience-card";

type View = "all" | "mine";

/**
 * `/interviews`: what interviews really looked like, shared by other members. Browse, search and filter
 * (company, role through the role synonym list, difficulty, outcome, level), upvote what helped, report
 * what should not be here, and manage your own posts. Members only; every post is moderated.
 */
export function InterviewsPage() {
  const [view, setView] = useState<View>("all");
  return (
    <>
      <PageHeader
        eyebrow="Interviews"
        title="Interview experiences"
        description="Real accounts of interview processes from other members: how many rounds, what kind of questions, how hard it felt, and what helped."
        actions={<Button asChild><Link href="/interviews/new"><Plus className="size-4" aria-hidden /> Share your experience</Link></Button>}
      />
      <div className="mb-6"><ConfidentialityNotice compact /></div>
      <div className="mb-6">
        <Segmented<View> label="Which posts" value={view} onValueChange={setView} options={[{ value: "all", label: "All experiences" }, { value: "mine", label: "My posts" }]} />
      </div>
      {view === "all" ? <Browse /> : <Mine />}
    </>
  );
}

function Browse() {
  const [f, setF] = useState({ q: "", company: "", role: "", difficulty: "", outcome: "", level: "", sort: "recent" });
  const [page, setPage] = useState(1);
  const set = (patch: Partial<typeof f>) => { setF((p) => ({ ...p, ...patch })); setPage(1); };
  const filtering = Boolean(f.q || f.company || f.role || f.difficulty || f.outcome || f.level);
  const list = useInterviews({ q: f.q.trim(), company: f.company.trim(), role: f.role.trim(), difficulty: f.difficulty, outcome: f.outcome, level: f.level, sort: f.sort, page });

  let body;
  if (list.isPending) body = <div role="status" aria-label="Loading experiences" className="flex flex-col gap-4">{[0, 1].map((i) => <Skeleton key={i} className="h-56 rounded-card" />)}</div>;
  else if (list.error) body = <ErrorState title="Could not load interview experiences" message={list.error.message} onRetry={() => list.refetch()} />;
  else if (list.data.items.length === 0) {
    body = filtering ? (
      <EmptyState icon={<Search />} title="No experiences match" description="Try fewer filters, or a different company or role." />
    ) : (
      <EmptyState icon={<MessagesSquare />} title="No experiences yet" description="Be the first: share how your last interview went and help the next candidate." action={<Button asChild><Link href="/interviews/new">Share your experience</Link></Button>} />
    );
  } else {
    const pages = Math.max(1, Math.ceil(list.data.total / list.data.page_size));
    body = (
      <>
        <p className="mb-3 text-small text-muted" aria-live="polite">{list.data.total} experience{list.data.total === 1 ? "" : "s"}</p>
        <ul className="flex flex-col gap-4" aria-label="Interview experiences">{list.data.items.map((e) => <li key={e.id}><ExperienceCard exp={e} /></li>)}</ul>
        {pages > 1 && (
          <nav aria-label="Pages" className="mt-6 flex items-center justify-center gap-3">
            <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
            <span className="text-small text-muted">Page {page} of {pages}</span>
            <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
          </nav>
        )}
      </>
    );
  }

  return (
    <>
      <form role="search" aria-label="Filter experiences" onSubmit={(e) => e.preventDefault()} className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Search" className="lg:col-span-2"><Input type="search" value={f.q} onChange={(e) => set({ q: e.target.value })} placeholder="Words from the post" /></Field>
        <Field label="Company"><Input value={f.company} onChange={(e) => set({ company: e.target.value })} placeholder="e.g. Stripe" /></Field>
        <Field label="Role" hint="SDE also finds Software Development Engineer."><Input value={f.role} onChange={(e) => set({ role: e.target.value })} placeholder="e.g. SDE" /></Field>
        <Field label="Difficulty">
          <Select value={f.difficulty} onChange={(e) => set({ difficulty: e.target.value })}>
            <option value="">Any</option>{[1, 2, 3, 4, 5].map((d) => <option key={d} value={d}>{d} of 5</option>)}
          </Select>
        </Field>
        <Field label="Outcome">
          <Select value={f.outcome} onChange={(e) => set({ outcome: e.target.value })}><option value="">Any</option>{OUTCOMES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
        </Field>
        <Field label="Level">
          <Select value={f.level} onChange={(e) => set({ level: e.target.value })}><option value="">Any</option>{LEVELS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
        </Field>
        <Field label="Sort by">
          <Select value={f.sort} onChange={(e) => set({ sort: e.target.value })}><option value="recent">Newest</option><option value="helpful">Most helpful</option></Select>
        </Field>
      </form>
      {body}
    </>
  );
}

function Mine() {
  const mine = useMyInterviews();
  if (mine.isPending) return <Skeleton className="h-56 rounded-card" />;
  if (mine.error) return <ErrorState title="Could not load your posts" message={mine.error.message} onRetry={() => mine.refetch()} />;
  if (mine.data.length === 0) {
    return <EmptyState icon={<MessagesSquare />} title="You have not shared anything yet" description="Your posts appear here with their review status." action={<Button asChild><Link href="/interviews/new">Share your experience</Link></Button>} />;
  }
  return <ul className="flex flex-col gap-4" aria-label="Your posts">{mine.data.map((e) => <li key={e.id}><ExperienceCard exp={e} /></li>)}</ul>;
}
