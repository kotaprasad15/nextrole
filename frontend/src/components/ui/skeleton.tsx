import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

/** Loading placeholder. Pulses via opacity only; static under reduced motion (global rule). */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden className={cn("animate-pulse rounded-control bg-ink/[0.07]", className)} {...props} />;
}
