"use client";

import { History } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { diffLines } from "@/lib/diff";
import { useDraftVersions, type DraftVersion } from "@/lib/local/draft-versions";

const SOURCE_LABEL = { generated: "Written by NextRole", edited: "Edited by you" } as const;
const MARK = { same: "  ", add: "+ ", del: "- " } as const;

/**
 * Earlier versions of this draft, kept in this browser. "Compare" shows a line diff between that
 * version and what is in the editor right now; "Restore" puts it in the editor (nothing is saved
 * until the user saves). The diff uses +/- markers as well as colour.
 */
export function VersionHistory({
  jobId,
  current,
  onRestore,
}: {
  jobId: string;
  current: { subject: string; body: string };
  onRestore: (v: DraftVersion) => void;
}) {
  const versions = useDraftVersions(jobId);
  const [open, setOpen] = useState<string | null>(null);

  return (
    <Card>
      <CardTitle className="flex items-center gap-2"><History className="size-5 text-muted" aria-hidden /> Version history</CardTitle>
      <CardDescription className="mt-1">Saved in this browser only, up to 20 versions.</CardDescription>
      {versions.length === 0 ? (
        <p className="mt-4 text-small text-muted">Versions appear here as the draft is written and edited.</p>
      ) : (
        <ol className="mt-4 flex flex-col gap-3">
          {versions.map((v, i) => {
            const isOpen = open === v.id;
            return (
              <li key={v.id} className="rounded-control border border-border p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <p className="text-small font-medium">
                    {i === 0 ? "Latest: " : ""}{SOURCE_LABEL[v.source]}
                    {v.score !== null && <span className="font-normal text-muted"> · reviewer {Math.round(v.score)}</span>}
                  </p>
                  <time dateTime={v.at} className="text-caption text-muted">
                    {new Date(v.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                  </time>
                </div>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" variant="secondary" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : v.id)}>
                    {isOpen ? "Hide changes" : "Compare with editor"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => onRestore(v)}>Restore</Button>
                </div>
                {isOpen && <Diff before={v} after={current} />}
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}

function Diff({ before, after }: { before: { subject: string; body: string }; after: { subject: string; body: string } }) {
  const lines = diffLines(`${before.subject}\n\n${before.body}`, `${after.subject}\n\n${after.body}`);
  const same = lines.every((l) => l.kind === "same");
  return (
    <div className="mt-3" role="group" aria-label="Changes from this version to the editor">
      {same ? (
        <p className="text-small text-muted">Identical to what is in the editor.</p>
      ) : (
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-control bg-bg p-3 text-caption leading-relaxed">
          {lines.map((l, i) => (
            <span
              key={i}
              className={cn("block", l.kind === "add" && "bg-success-tint text-success-ink", l.kind === "del" && "bg-danger-tint text-danger-ink line-through decoration-danger-ink/40")}
            >
              <span aria-hidden>{MARK[l.kind]}</span>
              <span className="sr-only">{l.kind === "add" ? "Added: " : l.kind === "del" ? "Removed: " : ""}</span>
              {l.text || " "}
            </span>
          ))}
        </pre>
      )}
    </div>
  );
}
