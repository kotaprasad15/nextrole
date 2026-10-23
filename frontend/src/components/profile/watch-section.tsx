"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, Plus, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { toast } from "@/components/ui/toast";
import { ApiError } from "@/lib/api/client";
import { api } from "@/lib/api/endpoints";
import { keys, useCompanies } from "@/lib/api/queries";

/**
 * "How we read your roles": each wanted role resolved through the server's synonym list, so users can
 * see that "SDE" also finds "Software Development Engineer" postings. Read-only; it follows the draft.
 */
export function RoleReading({ roles }: { roles: string[] }) {
  const wanted = roles.map((r) => r.trim()).filter(Boolean).slice(0, 20);
  const resolved = useQuery({
    queryKey: ["roles", "resolve", wanted],
    queryFn: () => api.resolveRoles(wanted),
    enabled: wanted.length > 0,
    staleTime: 60_000,
  });
  if (!wanted.length || !resolved.data) return null;
  return (
    <div className="rounded-control bg-ink/5 p-3.5">
      <h3 className="text-small font-medium">How we read your roles</h3>
      <ul className="mt-2 flex flex-col gap-1.5 text-small text-muted">
        {resolved.data.map((r) => (
          <li key={r.text}>
            <span className="font-medium text-ink">{r.text}</span>
            {r.canonical ? <> counts as <span className="font-medium text-ink">{r.label}</span>; we also look for {r.also_matches.slice(0, 4).join(", ")}.</> : <> is a custom role; we match titles that contain all its words.</>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Companies whose job boards we keep an eye on. Saved straight away (not part of the profile draft). */
export function WatchedCompanies() {
  const qc = useQueryClient();
  const companies = useCompanies();
  const [name, setName] = useState("");
  const suggestions = useQuery({
    queryKey: ["companies", "suggestions", name.trim()],
    queryFn: () => api.companySuggestions(name.trim()),
    staleTime: 30_000,
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: keys.companies });
  const fail = (e: unknown) => toast(e instanceof ApiError ? e.message : "Something went wrong. Please try again.", { variant: "error" });

  const add = useMutation({ mutationFn: (n: string) => api.addCompany(n), onSuccess: () => { setName(""); invalidate(); qc.invalidateQueries({ queryKey: ["companies", "suggestions"] }); }, onError: fail });
  const remove = useMutation({ mutationFn: (id: number) => api.removeCompany(id), onSuccess: () => { invalidate(); qc.invalidateQueries({ queryKey: ["companies", "suggestions"] }); }, onError: fail });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim()) add.mutate(name.trim());
  };

  return (
    <section aria-labelledby="watch-title" className="mt-10">
      <div className="mb-4">
        <h2 id="watch-title" className="text-h2 font-semibold tracking-tight">Companies to watch</h2>
        <p className="mt-1 text-small text-muted">Pick companies you would love to work for. We watch their job boards and can tell you when they post a role like the ones you want.</p>
      </div>
      <Card className="flex flex-col gap-5">
        {companies.data && companies.data.length > 0 ? (
          <ul className="flex flex-wrap gap-2" aria-label="Watched companies">
            {companies.data.map((c) => (
              <li key={c.id} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface py-1 pl-3 pr-1.5 text-small">
                <Eye className="size-3.5 text-muted" aria-hidden />
                <span>{c.name}</span>
                {!c.monitored && <Badge tone="outline" title="We cannot read this company's job board yet, so it will not trigger alerts.">not watchable yet</Badge>}
                <button type="button" aria-label={`Stop watching ${c.name}`} onClick={() => remove.mutate(c.id)} className="grid size-6 place-items-center rounded-full text-muted hover:bg-ink/10 hover:text-ink">
                  <X className="size-3.5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-small text-muted">{companies.isPending ? "Loading..." : "You are not watching any company yet."}</p>
        )}

        <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
          <Field label="Add a company" className="min-w-56 flex-1">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Stripe" maxLength={80} autoComplete="off" />
          </Field>
          <Button type="submit" variant="secondary" disabled={!name.trim() || add.isPending}><Plus className="size-4" aria-hidden /> Add</Button>
        </form>

        {suggestions.data && suggestions.data.length > 0 && (
          <div role="group" aria-label="Suggested companies" className="flex flex-wrap items-center gap-1.5">
            <span className="text-caption text-muted">Companies we can watch:</span>
            {suggestions.data.slice(0, 8).map((s) => (
              <button key={s} type="button" onClick={() => add.mutate(s)} className="rounded-full border border-dashed border-border-strong px-2.5 py-0.5 text-caption text-muted transition-colors hover:border-primary hover:text-primary">
                + {s}
              </button>
            ))}
          </div>
        )}
      </Card>
    </section>
  );
}
