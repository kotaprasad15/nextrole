import { TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Button } from "./button";

/**
 * Error panel with a retry action. `role="alert"` announces it to screen readers. Used by route
 * error boundaries and by data views that fail to load.
 */
export function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
  action,
  className,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center gap-3 rounded-card border border-danger/25 bg-danger-tint/50 px-6 py-12 text-center",
        className,
      )}
    >
      <div className="grid size-12 place-items-center rounded-full bg-danger-tint text-danger-ink">
        <TriangleAlert className="size-6" aria-hidden />
      </div>
      <h2 className="text-h3 font-semibold tracking-tight">{title}</h2>
      {message && <p className="max-w-md text-small text-muted">{message}</p>}
      <div className="mt-2 flex flex-wrap justify-center gap-3">
        {onRetry && (
          <Button size="sm" variant="secondary" onClick={onRetry}>
            Try again
          </Button>
        )}
        {action}
      </div>
    </div>
  );
}
