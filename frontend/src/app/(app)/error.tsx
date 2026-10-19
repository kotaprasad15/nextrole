"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/ui/error-state";

// Inside the shell, so the navigation stays usable when a page crashes. Next 16 passes `retry`.
export default function AppError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => console.error(error), [error]);
  return (
    <ErrorState
      title="This page hit a problem"
      message="Your data is safe. Try again, or use the navigation to go somewhere else."
      onRetry={retry}
    />
  );
}
