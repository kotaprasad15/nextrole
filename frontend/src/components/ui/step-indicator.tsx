import { Check } from "lucide-react";
import { cn } from "@/lib/cn";

export interface Step {
  id: string;
  label: string;
}

/**
 * Horizontal progress through a multi-step flow (onboarding). `current` is the 0-based index
 * of the active step. On small screens only the active label shows, with an "n of N" summary.
 */
export function StepIndicator({ steps, current, className }: { steps: Step[]; current: number; className?: string }) {
  return (
    <nav aria-label="Progress" className={className}>
      <p className="mb-3 text-small text-muted sm:hidden">
        Step {current + 1} of {steps.length}: <span className="font-medium text-ink">{steps[current]?.label}</span>
      </p>
      <ol className="flex items-center gap-2">
        {steps.map((s, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <li
              key={s.id}
              aria-current={active ? "step" : undefined}
              className={cn("flex items-center gap-2", i < steps.length - 1 && "flex-1")}
            >
              <span
                className={cn(
                  "grid size-8 shrink-0 place-items-center rounded-full border text-small font-semibold transition-colors duration-200",
                  done && "border-primary bg-primary text-on-primary",
                  active && "border-primary bg-primary-tint text-primary",
                  !done && !active && "border-border-strong bg-surface text-muted",
                )}
              >
                {done ? <Check className="size-4" aria-hidden /> : i + 1}
                <span className="sr-only">{done ? "completed" : active ? "current" : "upcoming"}</span>
              </span>
              <span
                className={cn(
                  "hidden text-small font-medium sm:inline",
                  active ? "text-ink" : done ? "text-ink/80" : "text-muted",
                )}
              >
                {s.label}
              </span>
              {i < steps.length - 1 && (
                <span aria-hidden className="relative h-0.5 flex-1 overflow-hidden rounded-full bg-border">
                  <span
                    className={cn(
                      "absolute inset-0 origin-left bg-primary transition-transform duration-300",
                      done ? "scale-x-100" : "scale-x-0",
                    )}
                  />
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
