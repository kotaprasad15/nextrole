"use client";

import { motion } from "framer-motion";
import { ToggleGroup } from "radix-ui";
import { useId, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { useReducedMotion } from "@/lib/motion/hooks";
import { spring } from "@/lib/motion/tokens";

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
}

/**
 * A filter control: one choice out of a few, with the same sliding pill as Tabs. Use it (not
 * Tabs) when choosing does NOT switch between panels, so there is no tab/tabpanel relationship
 * to break. Semantics are a labelled group of radio buttons; arrow keys move, and picking the
 * current option again keeps it selected.
 */
export function Segmented<T extends string>({
  value,
  onValueChange,
  options,
  label,
  className,
}: {
  value: T;
  onValueChange: (v: T) => void;
  options: SegmentedOption<T>[];
  label: string;
  className?: string;
}) {
  const pillId = useId();
  const reduced = useReducedMotion();
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      onValueChange={(v) => v && onValueChange(v as T)}
      aria-label={label}
      className={cn("inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-[14px] bg-ink/5 p-1", className)}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <ToggleGroup.Item
            key={o.value}
            value={o.value}
            className="relative inline-flex h-9 shrink-0 items-center gap-2 rounded-[10px] px-3.5 text-small font-medium text-muted transition-colors hover:text-ink data-[state=on]:text-ink"
          >
            {active && (
              <motion.span layoutId={`${pillId}-pill`} aria-hidden className="absolute inset-0 rounded-[10px] bg-surface shadow-1" transition={reduced ? { duration: 0 } : spring.snappy} />
            )}
            <span className="relative">{o.label}</span>
          </ToggleGroup.Item>
        );
      })}
    </ToggleGroup.Root>
  );
}
