"use client";

import { RadioGroup } from "radix-ui";
import { cn } from "@/lib/cn";

export interface RadioCardOption {
  value: string;
  label: string;
  hint?: string;
}

interface RadioCardsProps {
  value: string;
  onValueChange: (value: string) => void;
  options: RadioCardOption[];
  /** Accessible name for the group (the visible <label> is on the Field). */
  label: string;
  className?: string;
}

/** Single choice as large selectable cards. Radix gives arrow-key navigation and radio semantics. */
export function RadioCards({ value, onValueChange, options, label, className }: RadioCardsProps) {
  return (
    <RadioGroup.Root value={value} onValueChange={onValueChange} aria-label={label} className={cn("grid gap-2.5 sm:grid-cols-2", className)}>
      {options.map((o) => (
        <RadioGroup.Item
          key={o.value}
          value={o.value}
          className={cn(
            "rounded-control border border-border-strong bg-surface p-3.5 text-left transition-[border-color,box-shadow,background-color] duration-150",
            "hover:border-ink/40 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/15",
            "data-[state=checked]:border-primary data-[state=checked]:bg-primary-tint data-[state=checked]:shadow-[0_0_0_1px_var(--color-primary)]",
          )}
        >
          <span className="block font-medium">{o.label}</span>
          {o.hint && <span className="mt-0.5 block text-small text-muted">{o.hint}</span>}
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
}
