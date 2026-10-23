"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Bookmark, ExternalLink, Loader2, Search } from "lucide-react";
import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { PageHeader } from "@/components/shell/page-header";
import { Badge, TierBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api/endpoints";
import { keys, useRecommendations, useSavedList } from "@/lib/api/queries";
import { SAVED_STATUSES, type SavedJob, type SavedStatus } from "@/lib/api/schemas";
import { readLegacySaves, removeLegacy } from "@/lib/local/legacy-saves";
import { STATUS_LABEL, STATUS_TONE, formatDate } from "@/lib/saved/status";
import { useSavedJobs } from "@/lib/saved/use-saved-jobs";

type Sort = "saved_desc" | "saved_asc" | "company" | "status";
const NOTES_MAX = 2000;

/**
 * `/saved`: every job the user saved, with the snapshot taken at save time (so it survives the
 * posting expiring), a status, notes, filters, and a "no longer listed" flag when the employer
 * removes the posting. Filtering and sorting happen on the server.
 */
export function SavedPage() {
  const [status, setStatus] = useState<SavedStatus | "">("");
  const [tier, setTier] = useState("");
  const [listed, setListed] = useState("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("saved_desc");

  const list = useSavedList({ status: status || undefined, tier: tier || undefined, listed: listed === "" ? undefined : listed === "true", q: q.trim(), sort });
  const all = useSavedList({});
  const filtering = Boolean(status || tier || listed || q.trim());

  let body;
  if (list.isPending) body = <div role="status" aria-label="Loading saved jobs" className="flex flex-col gap-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-36 rounded-card" />)}</div>;
  else if (list.error) body = <ErrorState title="Could not load your saved jobs" message={list.error.message} onRetry={() => list.refetch()} />;
  else if (list.data.length === 0) {
    body = filtering && (all.data?.length ?? 0) > 0 ? (
      <EmptyState icon={<Search />} title="No saved jobs match" description="Try a different filter or clear the search." />
    ) : (
      <EmptyState
        icon={<Bookmark />}
        title="No saved jobs yet"
        description="Use the bookmark on any recommended job to keep it here with its status and your notes."
        action={<Button asChild><Link href="/dashboard">Browse matches</Link></Button>}
      />
    );
  } else {
    body = (
      <ul className="flex flex-col gap-4" aria-label="Saved jobs">
        {list.data.map((job) => <li key={job.id}><SavedCard job={job} /></li>)}
      </ul>
    );
  }

  return (
    <>
      <PageHeader eyebrow="Saved" title="Your saved jobs" description="Keep track of where each application stands. Postings are kept as they were when you saved them, even after they close." />
      <LegacyImport />

      <form role="search" aria-label="Filter saved jobs" onSubmit={(e) => e.preventDefault()} className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_1fr]">
        <Field label="Search">
          <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Title, company or notes" />
        </Field>
        <Field label="Status">
          <Select value={status} onChange={(e) => setStatus(e.target.value as SavedStatus | "")}>
            <option value="">All statuses</option>
            {SAVED_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </Select>
        </Field>
        <Field label="Company type">
          <Select value={tier} onChange={(e) => setTier(e.target.value)}>
            <option value="">All types</option>
            <option value="startup">Startups</option>
            <option value="mid">Mid-size</option>
            <option value="mnc">MNCs</option>
          </Select>
        </Field>
        <Field label="Listing">
          <Select value={listed} onChange={(e) => setListed(e.target.value)}>
            <option value="">Any</option>
            <option value="true">Still listed</option>
            <option value="false">No longer listed</option>
          </Select>
        </Field>
        <Field label="Sort by">
          <Select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="saved_desc">Newest saved</option>
            <option value="saved_asc">Oldest saved</option>
            <option value="company">Company</option>
            <option value="status">Status</option>
          </Select>
        </Field>
      </form>

      {body}
    </>
  );
}

function SavedCard({ job }: { job: SavedJob }) {
  const saved = useSavedJobs();
  const recs = useRecommendations();
  const [notes, setNotes] = useState(job.notes);
  const [confirming, setConfirming] = useState(false);
  const live = Boolean([...(recs.data?.startup ?? []), ...(recs.data?.mid ?? []), ...(recs.data?.mnc ?? [])].some((c) => c.job_id === job.job_id));
  const applyable = job.listed && job.apply_url?.startsWith("https://");
  const dirty = notes !== job.notes;

  return (
    <Card tier={job.tier} className="flex flex-col gap-4 !p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <TierBadge tier={job.tier} short />
            <Badge tone={STATUS_TONE[job.status]}>{STATUS_LABEL[job.status]}</Badge>
            {!job.listed && <Badge tone="warning">No longer listed</Badge>}
            {job.remote && <Badge tone="outline">Remote</Badge>}
          </div>
          <h2 className="mt-2 text-h3 font-semibold tracking-tight">
            {live ? <Link href={`/jobs/${encodeURIComponent(job.job_id)}`} className="hover:underline">{job.title}</Link> : job.title}
          </h2>
          <p className="text-small text-muted">{job.company}{job.location ? ` · ${job.location}` : ""}</p>
          <p className="mt-1 text-caption text-muted">
            Saved {formatDate(job.saved_at)}
            {job.status !== "saved" && ` · ${STATUS_LABEL[job.status]} since ${formatDate(job.status_updated_at)}`}
            {!job.listed && job.delisted_at && ` · removed by the employer around ${formatDate(job.delisted_at)}`}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Status" className="w-40">
            <Select aria-label={`Status for ${job.title} at ${job.company}`} value={job.status} onChange={(e) => saved.update.mutate({ id: job.id, status: e.target.value as SavedStatus })}>
              {SAVED_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </Select>
          </Field>
          {applyable && (
            <Button asChild size="md" variant="secondary">
              <a href={job.apply_url!} target="_blank" rel="noopener noreferrer">Apply <ExternalLink className="size-4" aria-hidden /><span className="sr-only"> (opens in a new tab)</span></a>
            </Button>
          )}
        </div>
      </div>

      {job.summary && <p className="text-small text-muted">{job.summary}</p>}

      <Field label="Notes" hint={`${notes.length}/${NOTES_MAX}. Only you can see these.`}>
        <Textarea
          aria-label={`Notes for ${job.title} at ${job.company}`}
          className="min-h-20"
          value={notes}
          maxLength={NOTES_MAX}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => dirty && saved.update.mutate({ id: job.id, notes })}
        />
      </Field>

      <div className="flex justify-end gap-2">
        {confirming ? (
          <>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>Keep it</Button>
            <Button size="sm" variant="danger" disabled={saved.unsave.isPending} onClick={() => saved.unsave.mutate(job.id, { onSuccess: () => toast("Removed from saved jobs", { variant: "info" }) })}>
              {saved.unsave.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />} Remove and delete notes
            </Button>
          </>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setConfirming(true)} aria-label={`Remove ${job.title} from saved jobs`}>Remove</Button>
        )}
      </div>
    </Card>
  );
}

/** One-time move of saves/tracker entries an older version kept in this browser. */
function LegacyImport() {
  const qc = useQueryClient();
  // localStorage is browser-only: nothing is shown on the server render or the first client render.
  const hydrated = useSyncExternalStore(() => () => {}, () => true, () => false);
  const [version, setVersion] = useState(0);
  const items = hydrated ? readLegacySaves() : [];
  void version;

  const move = useMutation({
    mutationFn: () => api.importSavedJobs(items),
    onSuccess: (res) => {
      const moved = items.filter((i) => !res.skipped.includes(i.job_id)).map((i) => i.job_id);
      removeLegacy(moved);
      setVersion((v) => v + 1);
      qc.invalidateQueries({ queryKey: keys.saved });
      toast(`Moved ${res.imported} saved job${res.imported === 1 ? "" : "s"} to your account`, {
        description: res.skipped.length ? `${res.skipped.length} no longer match your recommendations and stay in this browser.` : undefined,
        variant: "success",
      });
    },
    onError: () => toast("Could not move your saved jobs. Please try again.", { variant: "error" }),
  });

  if (items.length === 0) return null;
  return (
    <Card className="mb-6 flex flex-wrap items-center justify-between gap-4 !p-5">
      <div>
        <h2 className="text-h3 font-semibold tracking-tight">{items.length} saved job{items.length === 1 ? "" : "s"} found in this browser</h2>
        <p className="mt-1 text-small text-muted">Saved jobs now live in your account. Move the ones that are still in your matches; the rest stay here until you clear browser data.</p>
      </div>
      <Button onClick={() => move.mutate()} disabled={move.isPending}>
        {move.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />} Move to my account
      </Button>
    </Card>
  );
}
