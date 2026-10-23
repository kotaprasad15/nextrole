"use client";

import { ArrowDown, ArrowRight, ArrowUp, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api/client";
import { useAdminMetrics, useAdminTrace, useAdminTraces } from "@/lib/api/queries";
import type { Metrics } from "@/lib/api/schemas";

type Range = "7" | "30" | "90";
const usd = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n < 10 ? 4 : 2 }).format(n);
const num = (n: number) => new Intl.NumberFormat("en-US", { notation: n >= 100_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(n);
const pct = (n: number) => `${(n * 100).toFixed(n > 0 && n < 0.01 ? 2 : 1)}%`;

/**
 * `/admin`: usage and cost, as TOTALS only. The server returns no per-user figure at all, so there is
 * nothing here to break down by person. Access is enforced by the server (admin role read from the
 * database on every request, 404 otherwise); this page shows "Not found" if the server refuses.
 */
export function AdminPage() {
  const [range, setRange] = useState<Range>("30");
  const m = useAdminMetrics(Number(range));
  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title="Usage and cost"
        description="Totals across everyone. No figure on this page can be broken down by person."
        actions={<Button asChild variant="secondary"><Link href="/admin/moderation"><ShieldCheck className="size-4" aria-hidden /> Moderation <ArrowRight className="size-4" aria-hidden /></Link></Button>}
      />
      <div className="mb-6">
        <Segmented<Range> label="Time range" value={range} onValueChange={setRange} options={[{ value: "7", label: "7 days" }, { value: "30", label: "30 days" }, { value: "90", label: "90 days" }]} />
      </div>
      {m.isPending ? (
        <div role="status" aria-label="Loading metrics" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28 rounded-card" />)}</div>
      ) : m.error ? (
        m.error instanceof ApiError && m.error.status === 404 ? <EmptyState icon={<ShieldCheck />} title="Not found" description="This page does not exist." /> : <ErrorState title="Could not load metrics" message={m.error.message} onRetry={() => m.refetch()} />
      ) : (
        <Dashboard m={m.data} />
      )}
    </>
  );
}

function Trend({ now, before, goodWhenDown = true, label }: { now: number; before: number; goodWhenDown?: boolean; label: string }) {
  if (!before) return <span className="text-caption text-muted">no earlier data to compare</span>;
  const change = (now - before) / before;
  const flat = Math.abs(change) < 0.005;
  const up = change > 0;
  const good = flat ? null : up !== goodWhenDown;
  const Icon = flat ? ArrowRight : up ? ArrowUp : ArrowDown;
  return (
    <span className={`inline-flex items-center gap-1 text-caption font-medium ${good === null ? "text-muted" : good ? "text-success-ink" : "text-danger-ink"}`}>
      <Icon className="size-3.5" aria-hidden />
      {flat ? "no change" : `${Math.abs(change * 100).toFixed(0)}% ${up ? "more" : "less"}`}
      <span className="sr-only"> {label}</span>
      <span aria-hidden className="font-normal text-muted"> vs previous period</span>
    </span>
  );
}

function Tile({ label, value, children }: { label: string; value: string; children?: ReactNode }) {
  return (
    <Card className="flex flex-col gap-1 !p-5">
      <p className="text-small text-muted">{label}</p>
      <p className="font-display text-display tabular-nums">{value}</p>
      {children}
    </Card>
  );
}

function Dashboard({ m }: { m: Metrics }) {
  const t = m.totals;
  const share = (v: number) => (t.cost_usd ? (v / t.cost_usd) * 100 : 0);
  return (
    <div className="flex flex-col gap-8">
      <section aria-label="Totals" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Cost" value={usd(t.cost_usd)}><Trend now={t.cost_usd} before={m.previous.cost_usd} label="cost" /></Tile>
        <Tile label="Tokens" value={num(t.tokens)}>
          <p className="text-caption text-muted">{num(t.tokens_in)} in, {num(t.tokens_out)} out</p>
          <Trend now={t.tokens} before={m.previous.tokens} label="tokens" />
        </Tile>
        <Tile label="Model requests" value={num(t.llm_requests)}>
          <p className="text-caption text-muted">average {Math.round(t.avg_latency_ms)} ms</p>
          <Trend now={t.llm_requests} before={m.previous.llm_requests} goodWhenDown={false} label="requests" />
        </Tile>
        <Tile label="Model error rate" value={pct(t.error_rate)}>
          <p className="text-caption text-muted">{num(t.llm_errors)} of {num(t.llm_requests)} failed</p>
          <Trend now={t.error_rate} before={m.previous.error_rate} label="error rate" />
        </Tile>
      </section>

      <section aria-labelledby="trend-title">
        <h2 id="trend-title" className="mb-3 text-h2 font-semibold tracking-tight">Over time</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <Chart title="Cost per day" unit="USD" points={m.series.map((s) => ({ day: s.day, value: s.cost_usd }))} format={usd} />
          <Chart title="Model requests per day" unit="requests" points={m.series.map((s) => ({ day: s.day, value: s.requests }))} format={num} />
          <Chart title="Model errors per day" unit="errors" points={m.series.map((s) => ({ day: s.day, value: s.errors }))} format={num} tone="danger" />
          <Chart title="Web requests per day" unit="requests" points={m.http.series.map((s) => ({ day: s.day, value: s.requests }))} format={num} />
        </div>
      </section>

      <section aria-labelledby="models-title" className="grid gap-4 lg:grid-cols-2">
        <Card className="flex flex-col gap-3">
          <div><CardTitle id="models-title">Cost by model</CardTitle><CardDescription>Share of total cost in this period.</CardDescription></div>
          {m.by_model.length === 0 ? <p className="text-small text-muted">No model calls in this period.</p> : (
            <table className="w-full text-small">
              <thead><tr className="text-left text-muted"><th className="pb-2 font-medium">Model</th><th className="pb-2 text-right font-medium">Requests</th><th className="pb-2 text-right font-medium">Errors</th><th className="pb-2 text-right font-medium">Cost</th></tr></thead>
              <tbody>
                {m.by_model.map((r) => (
                  <tr key={r.name} className="border-t border-border align-top">
                    <th scope="row" className="py-2 pr-2 text-left font-medium">{r.name}
                      <span aria-hidden className="mt-1 block h-1.5 rounded-full bg-ink/10"><span className="block h-full rounded-full bg-primary" style={{ width: `${share(r.cost_usd)}%` }} /></span>
                    </th>
                    <td className="py-2 text-right tabular-nums">{num(r.requests)}</td><td className="py-2 text-right tabular-nums">{pct(r.error_rate)}</td><td className="py-2 text-right tabular-nums">{usd(r.cost_usd)}<span className="sr-only"> ({share(r.cost_usd).toFixed(0)}% of total)</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card className="flex flex-col gap-3">
          <div><CardTitle>By pipeline stage</CardTitle><CardDescription>Which step of the agents spends the most.</CardDescription></div>
          {m.by_stage.length === 0 ? <p className="text-small text-muted">Nothing yet.</p> : (
            <table className="w-full text-small">
              <thead><tr className="text-left text-muted"><th className="pb-2 font-medium">Stage</th><th className="pb-2 text-right font-medium">Requests</th><th className="pb-2 text-right font-medium">Tokens</th><th className="pb-2 text-right font-medium">Cost</th></tr></thead>
              <tbody>{m.by_stage.map((r) => <tr key={r.name} className="border-t border-border"><th scope="row" className="py-2 text-left font-medium">{r.name}</th><td className="py-2 text-right tabular-nums">{num(r.requests)}</td><td className="py-2 text-right tabular-nums">{num(r.tokens)}</td><td className="py-2 text-right tabular-nums">{usd(r.cost_usd)}</td></tr>)}</tbody>
            </table>
          )}
        </Card>
      </section>

      <section aria-label="Other activity" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Agent runs" value={num(m.runs.total)}>
          <p className="text-caption text-muted">{m.runs.failed} failed ({pct(m.runs.error_rate)})</p>
          <p className="text-caption text-muted">{m.runs.by_mode.map((r) => `${r.mode.replace("_", " ")}: ${r.total}`).join(", ") || "none"}</p>
        </Tile>
        <Tile label="Web requests" value={num(m.http.requests)}>
          <p className="text-caption text-muted">{pct(m.http.error_rate)} server errors ({num(m.http.server_errors)})</p>
          <p className="text-caption text-muted">{num(m.http.client_errors)} client errors</p>
        </Tile>
        <Tile label="Alerts sent" value={num(m.alerts.alerts_created)}>
          <p className="text-caption text-muted">{m.alerts.passes} passes, {m.alerts.emails_sent} emails, {m.alerts.errors} errors</p>
        </Tile>
        <Tile label="Interview posts" value={`${m.interviews.pending} waiting`}>
          <p className="text-caption text-muted">{m.interviews.approved} published, {m.interviews.open_reports} open reports</p>
          <p className="text-caption text-muted">{m.accounts.total} accounts in total</p>
        </Tile>
      </section>

      <Traces />
    </div>
  );
}

/** Bar chart in plain SVG (no chart library). The numbers are also in a table for screen readers. */
function Chart({ title, unit, points, format, tone = "primary" }: { title: string; unit: string; points: { day: string; value: number }[]; format: (n: number) => string; tone?: "primary" | "danger" }) {
  const max = Math.max(...points.map((p) => p.value), 0);
  const total = points.reduce((n, p) => n + p.value, 0);
  const W = 560, H = 120, gap = points.length > 45 ? 1 : 3;
  const bar = (W - gap * (points.length - 1)) / Math.max(points.length, 1);
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2"><CardTitle>{title}</CardTitle><p className="text-small text-muted">Total {format(total)}</p></div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}: ${format(total)} in ${points.length} days, peak ${format(max)}`} className="h-32 w-full">
        <line x1="0" x2={W} y1={H - 0.5} y2={H - 0.5} className="stroke-border" strokeWidth="1" />
        {points.map((p, i) => {
          const h = max ? Math.max(p.value > 0 ? 2 : 0, (p.value / max) * (H - 6)) : 0;
          return <rect key={p.day} x={i * (bar + gap)} y={H - h} width={bar} height={h} rx="1.5" className={tone === "danger" ? "fill-danger" : "fill-primary"}><title>{`${p.day}: ${format(p.value)} ${unit}`}</title></rect>;
        })}
      </svg>
      <div className="flex justify-between text-caption text-muted" aria-hidden><span>{points[0]?.day}</span><span>{points.at(-1)?.day}</span></div>
      <table className="sr-only"><caption>{title} by day</caption><thead><tr><th>Day</th><th>{unit}</th></tr></thead><tbody>{points.map((p) => <tr key={p.day}><td>{p.day}</td><td>{format(p.value)}</td></tr>)}</tbody></table>
    </Card>
  );
}

/** Debugging traces. Already scrubbed of personal data on the server, and not linked to any user. */
function Traces() {
  const list = useAdminTraces();
  const [open, setOpen] = useState<string | null>(null);
  const entries = useAdminTrace(open);
  return (
    <section aria-labelledby="traces-title">
      <h2 id="traces-title" className="text-h2 font-semibold tracking-tight">Debugging traces</h2>
      <p className="mb-3 mt-1 text-small text-muted">Each run writes a trace for debugging. Personal data is scrubbed and no trace says whose run it was.</p>
      <Card className="flex flex-col gap-3">
        {list.isPending ? <Skeleton className="h-16" /> : list.error ? <p className="text-small text-danger-ink">Could not load traces.</p> : list.data.length === 0 ? <p className="text-small text-muted">No traces yet.</p> : (
          <ul className="flex flex-col divide-y divide-border" aria-label="Recent traces">
            {list.data.slice(0, 15).map((t) => (
              <li key={t.run_id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-small">
                <span><span className="font-mono">{t.run_id}</span> <span className="text-muted">· {new Date(t.modified).toLocaleString()} · {(t.size_bytes / 1024).toFixed(1)} KB</span></span>
                <Button size="sm" variant="ghost" aria-pressed={open === t.run_id} aria-label={`${open === t.run_id ? "Hide" : "View"} trace ${t.run_id}`} onClick={() => setOpen(open === t.run_id ? null : t.run_id)}>{open === t.run_id ? "Hide" : "View"}</Button>
              </li>
            ))}
          </ul>
        )}
        {open && (entries.isPending ? <Skeleton className="h-24" /> : entries.error ? <p className="text-small text-danger-ink">Could not load this trace.</p> : (
          <table className="w-full text-small">
            <caption className="sr-only">Steps in trace {open}</caption>
            <thead><tr className="text-left text-muted"><th className="pb-2 font-medium">Step</th><th className="pb-2 text-right font-medium">Latency</th><th className="pb-2 text-right font-medium">Tokens</th><th className="pb-2 text-right font-medium">Cost</th><th className="pb-2 font-medium">Error</th></tr></thead>
            <tbody>
              {entries.data.map((e, i) => (
                <tr key={i} className="border-t border-border align-top">
                  <th scope="row" className="py-2 text-left font-medium">{e.agent}</th>
                  <td className="py-2 text-right tabular-nums">{e.latency_ms != null ? `${Math.round(e.latency_ms)} ms` : ""}</td>
                  <td className="py-2 text-right tabular-nums">{(e.input_tokens ?? 0) + (e.output_tokens ?? 0)}</td>
                  <td className="py-2 text-right tabular-nums">{e.cost_usd != null ? usd(e.cost_usd) : ""}</td>
                  <td className="py-2 text-danger-ink">{e.error ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </Card>
    </section>
  );
}
