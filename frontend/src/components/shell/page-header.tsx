import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Consistent page title block: small eyebrow, serif title, supporting text, right-aligned actions. */
export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  className,
}: {
  title: string;
  description?: ReactNode;
  eyebrow?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-4", className)}>
      <div className="max-w-2xl">
        {eyebrow && <p className="mb-2 text-small font-medium text-primary">{eyebrow}</p>}
        <h1 className="font-display text-display text-balance">{title}</h1>
        {description && <p className="mt-3 text-body-lg text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
    </header>
  );
}
