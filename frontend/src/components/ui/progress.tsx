"use client";

import { Progress as ProgressPrimitive } from "radix-ui";
import { cn } from "@/lib/cn";

/** Linear progress (0 to 100). The fill scales on X (transform), not width. */
export function Progress({ value, label, className }: { value: number; label: string; className?: string }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <ProgressPrimitive.Root
      value={v}
      aria-label={label}
      className={cn("relative h-2 w-full overflow-hidden rounded-full bg-ink/[0.07]", className)}
    >
      <ProgressPrimitive.Indicator
        className="h-full w-full origin-left rounded-full bg-primary transition-transform duration-500 ease-out"
        style={{ transform: `scaleX(${v / 100})` }}
      />
    </ProgressPrimitive.Root>
  );
}
