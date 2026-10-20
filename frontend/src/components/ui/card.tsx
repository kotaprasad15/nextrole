import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { TIER_META, type Tier } from "@/lib/tier";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Raises the shadow on hover; use for clickable cards. */
  interactive?: boolean;
  /** Adds a thin tier-coloured accent along the top edge. */
  tier?: Tier;
}

export function Card({ className, interactive, tier, children, ...props }: CardProps) {
  return (
    <div
      className={cn(
        "relative rounded-card border border-border bg-surface p-5 shadow-1 md:p-6",
        interactive && "transition-[box-shadow,transform] duration-200 hover:shadow-2",
        className,
      )}
      {...props}
    >
      {tier && (
        <span
          aria-hidden
          className={cn("absolute inset-x-5 top-0 h-0.5 rounded-b-full", TIER_META[tier].swatch)}
        />
      )}
      {children}
    </div>
  );
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mb-4 flex flex-col gap-1", className)} {...props} />;
}

/** Heading level follows the document outline: h2 under the page title, pass `as="h3"` inside an h2 section. */
export function CardTitle({ className, as: Tag = "h2", ...props }: HTMLAttributes<HTMLHeadingElement> & { as?: "h2" | "h3" | "h4" }) {
  return <Tag className={cn("text-h3 font-semibold tracking-tight", className)} {...props} />;
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-small text-muted", className)} {...props} />;
}
