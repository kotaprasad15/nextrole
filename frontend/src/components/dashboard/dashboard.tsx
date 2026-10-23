"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Briefcase, ClipboardPaste, Loader2, SearchX, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import { ApiError } from "@/lib/api/client";
import { api } from "@/lib/api/endpoints";
import { keys, useActiveRun, useOutreachList, useRecommendations } from "@/lib/api/queries";
import type { RunMode, StartRunBody, Tier } from "@/lib/api/schemas";
import { useRunEvents } from "@/lib/api/sse";
import { DEFAULT_FILTERS, filterJobs, type Filters } from "@/lib/dashboard/filters";
import { runFailure } from "@/lib/dashboard/run-steps";
import { useSavedJobs } from "@/lib/saved/use-saved-jobs";
import { useReducedMotion } from "@/lib/motion/hooks";
import { duration, ease } from "@/lib/motion/tokens";
import { TIERS, TIER_META } from "@/lib/tier";
import { FiltersBar } from "./filters-bar";
import { JobCard } from "./job-card";
import { PasteJobModal } from "./paste-job-modal";
import { RunPanel } from "./run-panel";

/**
 * The jobs dashboard: three company-size tabs, client-side filters, scored job cards, a live
 * run panel (SSE) and the paste-a-job flow. One run at a time per user (the server enforces it
 * with a 409), so a run already in progress is re-attached on load.
 */
export function Dashboard() {
  const qc = useQueryClient();
  const recs = useRecommendations();
  const drafts = useOutreachList();
  const active_ = useActiveRun();
  const saved = useSavedJobs();
  const reduced = useReducedMotion();

  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [tab, setTab] = useState<Tier | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteError, setPasteError] = useState<string>();
  const [started, setStarted] = useState<{ id: string; mode: RunMode } | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);

  // The run we show: one we just started, else one the server says is still running.
  const running = active_.data?.run_id && active_.data.mode ? { id: active_.data.run_id, mode: active_.data.mode } : null;
  const active = started ?? (running && running.id !== dismissed ? running : null);
  const stream = useRunEvents(active && active.id !== dismissed ? active.id : null);
  const shown = active && active.id !== dismissed ? active : null;
  const busy = !!shown && !stream.finished;

  // When a run ends, refresh everything it may have changed, once.
  const settled = useRef<string | null>(null);
  useEffect(() => {
    if (!stream.finished || !shown || settled.current === shown.id) return;
    settled.current = shown.id;
    void qc.invalidateQueries({ queryKey: keys.recommendations });
    void qc.invalidateQueries({ queryKey: keys.outreach });
    void qc.invalidateQueries({ queryKey: keys.runs });
    if (runFailure(stream.events)) toast("The run did not finish", { variant: "error", description: runFailure(stream.events) ?? undefined });
    else toast("Your results are ready", { variant: "success" });
  }, [stream.finished, stream.events, shown, qc]);

  const start = useMutation({
    mutationFn: (body: StartRunBody) => api.startRun(body),
    onSuccess: (res, body) => {
      setStarted({ id: res.run_id, mode: body.mode });
      setDismissed(null);
      setPasteOpen(false);
      setPasteError(undefined);
      void qc.invalidateQueries({ queryKey: keys.runs });
    },
    onError: (err, body) => {
      const message = err instanceof ApiError ? err.message : "Could not start. Please try again.";
      if (err instanceof ApiError && err.status === 409) {
        setPasteOpen(false);
        toast("A run is already in progress", { description: "Wait for it to finish, then try again." });
        void qc.invalidateQueries({ queryKey: keys.runs });
      } else if (body.mode === "single_job") setPasteError(message);
      else toast("Could not start the search", { variant: "error", description: message });
    },
  });

  const draftMap = useMemo(() => new Map((drafts.data ?? []).map((d) => [d.job_id, d.status])), [drafts.data]);
  const draftIds = useMemo(() => new Set(draftMap.keys()), [draftMap]);

  const view = useMemo(() => {
    const out = {} as Record<Tier, ReturnType<typeof filterJobs>>;
    for (const t of TIERS) out[t] = filterJobs(recs.data?.[t] ?? [], filters, { drafts: draftIds, saved: saved.ids });
    return out;
  }, [recs.data, filters, draftIds, saved.ids]);

  const total = recs.data ? TIERS.reduce((n, t) => n + recs.data[t].length, 0) : 0;
  const visible = TIERS.reduce((n, t) => n + view[t].length, 0);
  const current: Tier = tab ?? TIERS.find((t) => view[t].length > 0) ?? "startup";

  const header = (
    <PageHeader
      eyebrow="Dashboard"
      title="Your matches"
      description="Openings scored against your profile, sorted by company type."
      actions={
        <>
          <Button variant="secondary" onClick={() => { setPasteError(undefined); setPasteOpen(true); }} disabled={busy}>
            <ClipboardPaste className="size-4" aria-hidden /> Paste a job
          </Button>
          <Button onClick={() => start.mutate({ mode: "recommend" })} disabled={busy || start.isPending} magnetic>
            {start.isPending && start.variables?.mode === "recommend" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
            Find new matches
          </Button>
        </>
      }
    />
  );

  let body;
  if (recs.isPending) {
    body = (
      <div role="status" aria-label="Loading matches" className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-64 rounded-card" />)}
      </div>
    );
  } else if (recs.error) {
    body = <ErrorState title="Could not load your matches" message={recs.error.message} onRetry={() => recs.refetch()} />;
  } else if (total === 0) {
    body = (
      <EmptyState
        icon={<Briefcase />}
        title="No matches yet"
        description="Run a search and we will score openings against your profile. It takes about a minute."
        action={<Button onClick={() => start.mutate({ mode: "recommend" })} disabled={busy || start.isPending}><Sparkles className="size-4" aria-hidden /> Find my first matches</Button>}
      />
    );
  } else {
    body = (
      <div className="flex flex-col gap-6">
        <FiltersBar value={filters} onChange={setFilters} shown={visible} total={total} />
        <Tabs value={current} onValueChange={(v) => setTab(v as Tier)}>
          <TabsList aria-label="Company size">
            {TIERS.map((t) => (
              <TabsTrigger key={t} value={t} accent={t}>
                {TIER_META[t].label} <span className="tabular-nums text-muted">({view[t].length})</span>
              </TabsTrigger>
            ))}
          </TabsList>
          {TIERS.map((t) => (
            <TabsContent key={t} value={t}>
              <p className="mb-4 text-small text-muted">{TIER_META[t].blurb}</p>
              {view[t].length === 0 ? (
                <EmptyState
                  icon={<SearchX />}
                  title={recs.data[t].length === 0 ? `No ${TIER_META[t].label.toLowerCase()} matches yet` : "No jobs match these filters"}
                  description={recs.data[t].length === 0 ? "Try Find new matches, or check the other tabs." : "Loosen a filter to see more."}
                  action={recs.data[t].length > 0 ? <Button variant="secondary" size="sm" onClick={() => setFilters({ ...DEFAULT_FILTERS, sort: filters.sort })}>Clear filters</Button> : undefined}
                />
              ) : (
                <ul className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                  {view[t].map((job, i) => (
                    <motion.li
                      key={job.job_id}
                      initial={reduced ? false : { opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: duration.base, ease: ease.out, delay: Math.min(i, 8) * 0.04 }}
                    >
                      <JobCard job={job} tier={t} draftStatus={draftMap.get(job.job_id)} saved={saved.isSaved(job.job_id)} onToggleSave={saved.toggle} />
                    </motion.li>
                  ))}
                </ul>
              )}
            </TabsContent>
          ))}
        </Tabs>
      </div>
    );
  }

  return (
    <>
      {header}
      <div className="flex flex-col gap-8">
        {shown && <RunPanel mode={shown.mode} events={stream.events} status={stream.status} onDismiss={() => setDismissed(shown.id)} />}
        {body}
      </div>
      <PasteJobModal
        open={pasteOpen}
        onOpenChange={setPasteOpen}
        pending={start.isPending}
        serverError={pasteError}
        onSubmit={(v) => start.mutate({ mode: "single_job", url: v.url || undefined, text: v.text || undefined })}
      />
    </>
  );
}
