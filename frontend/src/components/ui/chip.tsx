import { X } from "lucide-react";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  /** "good" for matched strengths, "gap" for missing items, "plain" for skills. */
  tone?: "plain" | "good" | "gap" | "primary";
  onRemove?: () => void;
  removeLabel?: string;
}

const TONES = {
  plain: "border-border bg-surface text-ink",
  good: "border-success/30 bg-success-tint text-success-ink",
  gap: "border-warning/40 bg-warning-tint text-warning-ink",
  primary: "border-primary/25 bg-primary-tint text-primary",
};

export function Chip({ className, tone = "plain", onRemove, removeLabel, children, ...props }: ChipProps) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full border px-3 py-1 text-small",
        TONES[tone],
        className,
      )}
      {...props}
    >
      <span className="truncate">{children}</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel ?? "Remove"}
          className="-mr-1 rounded-full p-0.5 text-muted transition-colors hover:bg-ink/10 hover:text-ink"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      )}
    </span>
  );
}
