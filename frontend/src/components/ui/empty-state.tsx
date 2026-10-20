import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Friendly placeholder for "nothing here yet" and error screens: icon, message, one action. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-card border border-dashed border-border-strong bg-surface/60 px-6 py-12 text-center",
        className,
      )}
    >
      {icon && <div className="grid size-12 place-items-center rounded-full bg-primary-tint text-primary [&_svg]:size-6">{icon}</div>}
      <h2 className="text-h3 font-semibold tracking-tight">{title}</h2>
      {description && <p className="max-w-md text-small text-muted">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
