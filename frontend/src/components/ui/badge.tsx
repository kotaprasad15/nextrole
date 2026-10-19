import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { TIER_META, type Tier } from "@/lib/tier";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-caption font-medium",
  {
    variants: {
      tone: {
        neutral: "bg-ink/5 text-ink",
        primary: "bg-primary-tint text-primary",
        success: "bg-success-tint text-success-ink",
        warning: "bg-warning-tint text-warning-ink",
        danger: "bg-danger-tint text-danger-ink",
        outline: "border border-border-strong text-muted",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

/** Tier badge: swatch dot + label in AA-safe ink on a soft tint. Same look on every screen. */
export function TierBadge({
  tier,
  className,
  short = false,
}: {
  tier: Tier;
  className?: string;
  short?: boolean;
}) {
  const m = TIER_META[tier];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-caption font-medium",
        m.tint,
        m.text,
        className,
      )}
    >
      <span aria-hidden className={cn("size-1.5 rounded-full", m.swatch)} />
      {short ? m.short : m.label}
    </span>
  );
}
