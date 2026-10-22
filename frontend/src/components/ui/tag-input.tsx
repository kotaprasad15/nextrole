"use client";

import { useState, type ComponentProps, type KeyboardEvent } from "react";
import { cn } from "@/lib/cn";
import { addTags, splitTags } from "@/lib/tags";
import { Chip } from "./chip";

interface TagInputProps extends Omit<ComponentProps<"input">, "value" | "onChange" | "type"> {
  value: string[];
  onChange: (next: string[]) => void;
  max?: number;
  /** Quick-add suggestions not already chosen. */
  suggestions?: string[];
  /** Noun for screen readers, e.g. "role" -> "Remove role Backend Engineer". */
  noun?: string;
}

/**
 * Chip input: Enter or comma adds, Backspace on an empty box removes the last chip, pasting a
 * comma/newline list adds them all, and leaving the box commits what was typed (so nothing typed
 * is silently lost). Takes `id`/`aria-*` so <Field> can wire it like a normal input.
 */
export function TagInput({ value, onChange, max = 20, suggestions = [], noun = "item", className, ...props }: TagInputProps) {
  const [draft, setDraft] = useState("");

  const commit = (text: string) => {
    const parts = splitTags(text);
    if (parts.length) onChange(addTags(value, parts, max));
    setDraft("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault(); // Enter must not submit the surrounding form
      commit(draft);
    } else if (e.key === "Backspace" && !draft && value.length) {
      onChange(value.slice(0, -1));
    }
  };

  const open = suggestions.filter((s) => !value.some((v) => v.toLowerCase() === s.toLowerCase())).slice(0, 6);
  const full = value.length >= max;

  return (
    <div>
      <div
        className={cn(
          "flex min-h-11 flex-wrap items-center gap-1.5 rounded-control border border-border-strong bg-surface px-2 py-1.5",
          "transition-[border-color,box-shadow] duration-150 hover:border-ink/40",
          "focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/15",
          "has-[[aria-invalid=true]]:border-danger",
          className,
        )}
      >
        {value.map((t) => (
          <Chip key={t} tone="primary" onRemove={() => onChange(value.filter((v) => v !== t))} removeLabel={`Remove ${noun} ${t}`}>
            {t}
          </Chip>
        ))}
        <input
          {...props}
          data-edit-only
          type="text"
          value={draft}
          disabled={full || props.disabled}
          onChange={(e) => (e.target.value.includes(",") ? commit(e.target.value) : setDraft(e.target.value))}
          onKeyDown={onKeyDown}
          onPaste={(e) => {
            const text = e.clipboardData.getData("text");
            if (/[,\n]/.test(text)) {
              e.preventDefault();
              commit(draft + text);
            }
          }}
          onBlur={(e) => {
            commit(draft);
            props.onBlur?.(e);
          }}
          className="min-w-32 flex-1 bg-transparent px-1.5 py-1 text-body text-ink outline-none placeholder:text-muted disabled:cursor-not-allowed"
        />
      </div>
      {open.length > 0 && !full && (
        <div data-edit-only className="mt-2 flex flex-wrap items-center gap-1.5" aria-label={`Suggested ${noun}s`} role="group">
          <span className="text-caption text-muted">Try:</span>
          {open.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onChange(addTags(value, [s], max))}
              className="rounded-full border border-dashed border-border-strong px-2.5 py-0.5 text-caption text-muted transition-colors hover:border-primary hover:text-primary"
            >
              + {s}
            </button>
          ))}
        </div>
      )}
      {full && <p data-edit-only className="mt-2 text-caption text-muted">You can add up to {max}.</p>}
    </div>
  );
}
