"use client";

import { Search, X } from "lucide-react";
import type { ReactNode } from "react";
import { Select } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { DEFAULT_FILTERS, MIN_SCORE_OPTIONS, activeFilterCount, type Filters } from "@/lib/dashboard/filters";

function Toggle({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      data-cursor="link"
      className={cn(
        "h-10 rounded-full border px-4 text-small font-medium transition-colors",
        pressed ? "border-primary bg-primary-tint text-primary" : "border-border-strong bg-surface text-ink hover:border-ink/40",
      )}
    >
      {children}
    </button>
  );
}

/** Search + quick filters. All state is lifted to the dashboard so tab counts can reflect it. */
export function FiltersBar({ value, onChange, shown, total }: { value: Filters; onChange: (f: Filters) => void; shown: number; total: number }) {
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => onChange({ ...value, [k]: v });
  const active = activeFilterCount(value);
  return (
    <section aria-label="Filter jobs" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-56 flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <input
            type="search"
            aria-label="Search jobs"
            placeholder="Search title, company or place"
            value={value.query}
            onChange={(e) => set("query", e.target.value)}
            className="h-10 w-full rounded-full border border-border-strong bg-surface pl-10 pr-4 text-small transition-[border-color,box-shadow] placeholder:text-muted hover:border-ink/40 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/15"
          />
        </div>
        <Toggle pressed={value.remoteOnly} onClick={() => set("remoteOnly", !value.remoteOnly)}>Remote only</Toggle>
        <Toggle pressed={value.hasDraft} onClick={() => set("hasDraft", !value.hasDraft)}>Has a draft</Toggle>
        <Toggle pressed={value.savedOnly} onClick={() => set("savedOnly", !value.savedOnly)}>Saved</Toggle>
        <div className="w-44">
          <Select aria-label="Minimum match score" className="h-10 rounded-full text-small" value={value.minScore} onChange={(e) => set("minScore", Number(e.target.value))}>
            {MIN_SCORE_OPTIONS.map((n) => (
              <option key={n} value={n}>{n === 0 ? "Any score" : `Score ${n}+`}</option>
            ))}
          </Select>
        </div>
        <div className="w-40">
          <Select aria-label="Sort by" className="h-10 rounded-full text-small" value={value.sort} onChange={(e) => set("sort", e.target.value as Filters["sort"])}>
            <option value="score">Best match</option>
            <option value="company">Company A to Z</option>
          </Select>
        </div>
      </div>
      <div className="flex items-center gap-3 text-small text-muted" aria-live="polite">
        <span>
          Showing {shown} of {total} {total === 1 ? "job" : "jobs"}
        </span>
        {active > 0 && (
          <button
            type="button"
            onClick={() => onChange({ ...DEFAULT_FILTERS, sort: value.sort })}
            className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
          >
            <X className="size-3.5" aria-hidden />
            Clear filters ({active})
          </button>
        )}
      </div>
    </section>
  );
}
