"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BellRing, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Field, Select } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { ApiError } from "@/lib/api/client";
import { api } from "@/lib/api/endpoints";
import { keys, useAlertSettings, useAlerts, useCompanies } from "@/lib/api/queries";
import { ALERT_FREQUENCIES, type Alert, type AlertSettings } from "@/lib/api/schemas";
import { formatDate } from "@/lib/saved/status";

const FREQUENCY_LABEL: Record<(typeof ALERT_FREQUENCIES)[number], string> = {
  instant: "As soon as we find one",
  daily: "Once a day (digest)",
  weekly: "Once a week (digest)",
  off: "Never",
};
const METHOD_LABEL = { taxonomy: "Same kind of role", embedding: "Very close title", llm: "Checked by AI" } as const;

/**
 * `/alerts`: notifications for roles that fit what you want at companies you watch (the match does not
 * need the same job title), delivery settings, and a "check now" button. Email is optional and goes only
 * to your own address; every email has an unsubscribe link.
 */
export function AlertsPage() {
  const qc = useQueryClient();
  const alerts = useAlerts();
  const companies = useCompanies();
  const invalidate = () => qc.invalidateQueries({ queryKey: keys.alerts });
  const fail = (e: unknown) => toast(e instanceof ApiError ? e.message : "Something went wrong. Please try again.", { variant: "error" });

  const readAll = useMutation({ mutationFn: api.readAllAlerts, onSuccess: invalidate, onError: fail });
  const check = useMutation({
    mutationFn: api.checkAlerts,
    onSuccess: (r) => {
      invalidate();
      toast(r.created ? `${r.created} new role${r.created === 1 ? "" : "s"} found` : "No new roles right now", {
        description: r.errors ? `${r.errors} job board${r.errors === 1 ? " was" : "s were"} unavailable; we will try again later.` : undefined,
        variant: r.created ? "success" : "info",
      });
    },
    onError: fail,
  });

  const unread = alerts.data?.filter((a) => !a.read).length ?? 0;
  const watching = companies.data?.length ?? 0;
  const watchable = companies.data?.filter((c) => c.monitored).length ?? 0;

  let body;
  if (alerts.isPending) body = <div role="status" aria-label="Loading alerts" className="flex flex-col gap-4">{[0, 1].map((i) => <Skeleton key={i} className="h-32 rounded-card" />)}</div>;
  else if (alerts.error) body = <ErrorState title="Could not load your alerts" message={alerts.error.message} onRetry={() => alerts.refetch()} />;
  else if (alerts.data.length === 0) {
    body = watching === 0 ? (
      <EmptyState icon={<BellRing />} title="Pick companies to watch" description="Tell us which companies you would love to work for and we will tell you when they post a role like the ones you want."
        action={<Button asChild><Link href="/profile">Choose companies</Link></Button>} />
    ) : (
      <EmptyState icon={<BellRing />} title="Nothing new yet"
        description={watchable === 0 ? "None of the companies you watch have a job board we can read yet, so there is nothing to alert on. Try adding companies from the suggestions." : "We check the job boards of the companies you watch every few hours and tell you when a role fits. You can also check right now."} />
    );
  } else body = <ul className="flex flex-col gap-4" aria-label="Alerts">{alerts.data.map((a) => <li key={a.id}><AlertCard alert={a} /></li>)}</ul>;

  return (
    <>
      <PageHeader
        eyebrow="Alerts"
        title="New roles at companies you watch"
        description="We match on the kind of work, not the exact job title, so a role called something different can still reach you."
        actions={
          <>
            <Button variant="secondary" onClick={() => check.mutate()} disabled={check.isPending || watching === 0}>
              {check.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <RefreshCw className="size-4" aria-hidden />} Check now
            </Button>
            <Button variant="ghost" onClick={() => readAll.mutate()} disabled={readAll.isPending || unread === 0}>Mark all as read</Button>
          </>
        }
      />
      <AlertSettingsCard />
      <section aria-label="Your alerts" className="mt-8">{body}</section>
    </>
  );
}

function AlertSettingsCard() {
  const qc = useQueryClient();
  const settings = useAlertSettings();
  const save = useMutation({
    mutationFn: (s: Omit<AlertSettings, "email_available">) => api.saveAlertSettings(s),
    onSuccess: (s) => qc.setQueryData(keys.alertSettings, s),
    onError: (e) => toast(e instanceof ApiError ? e.message : "Could not save your alert settings.", { variant: "error" }),
  });
  if (!settings.data) return <Skeleton className="h-40 rounded-card" />;
  const s = settings.data;
  const update = (patch: Partial<Omit<AlertSettings, "email_available">>) => save.mutate({ in_app: s.in_app, email: s.email, frequency: s.frequency, ...patch });
  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-h3 font-semibold tracking-tight">How you hear about them</h2>
      <Switch checked={s.in_app} onCheckedChange={(in_app) => update({ in_app })} label="Show alerts in NextRole" description="They appear here and as a count on the bell." />
      <Switch
        checked={s.email && s.email_available}
        onCheckedChange={(email) => update({ email })}
        label="Also email me"
        description={s.email_available ? "Sent only to your own account address, with an unsubscribe link in every message." : "Email is not set up on this server, so alerts stay in NextRole."}
      />
      {s.email_available && s.email && (
        <Field label="How often should we email you?" className="max-w-xs">
          <Select value={s.frequency} onChange={(e) => update({ frequency: e.target.value as AlertSettings["frequency"] })}>
            {ALERT_FREQUENCIES.map((f) => <option key={f} value={f}>{FREQUENCY_LABEL[f]}</option>)}
          </Select>
        </Field>
      )}
      <p className="text-caption text-muted">At most 10 alerts a day, and we never alert you about the same job twice.</p>
    </Card>
  );
}

function AlertCard({ alert: a }: { alert: Alert }) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: keys.alerts });
  const read = useMutation({ mutationFn: () => api.readAlert(a.id), onSuccess: invalidate });
  const dismiss = useMutation({ mutationFn: () => api.dismissAlert(a.id), onSuccess: invalidate });
  const applyable = a.apply_url?.startsWith("https://");
  return (
    <Card className="flex flex-col gap-3 !p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {!a.read && <Badge tone="primary">New</Badge>}
            <Badge tone="outline">{METHOD_LABEL[a.method]}</Badge>
            {a.remote && <Badge tone="outline">Remote</Badge>}
          </div>
          <h2 className="mt-2 text-h3 font-semibold tracking-tight">{a.title}</h2>
          <p className="text-small text-muted">{a.company}{a.location ? ` · ${a.location}` : ""} · found {formatDate(a.created_at)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {applyable && (
            <Button asChild size="sm" variant="secondary">
              <a href={a.apply_url!} target="_blank" rel="noopener noreferrer" onClick={() => !a.read && read.mutate()}>Apply <ExternalLink className="size-4" aria-hidden /><span className="sr-only"> (opens in a new tab)</span></a>
            </Button>
          )}
          {!a.read && <Button size="sm" variant="ghost" onClick={() => read.mutate()} aria-label={`Mark ${a.title} as read`}>Mark as read</Button>}
          <Button size="sm" variant="ghost" onClick={() => dismiss.mutate()} disabled={dismiss.isPending} aria-label={`Dismiss ${a.title}`}>Dismiss</Button>
        </div>
      </div>
      <p className="rounded-control bg-ink/5 px-3.5 py-2.5 text-small"><span className="font-medium">Why this matched: </span>{a.why}</p>
      <p className="text-caption text-muted">Matched your wanted role &ldquo;{a.role}&rdquo;.</p>
    </Card>
  );
}
