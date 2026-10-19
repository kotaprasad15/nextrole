"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";

// Catches errors in pages outside the signed-in shell (marketing, auth).
export default function RootError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => console.error(error), [error]);
  return (
    <main id="main" className="page-container grid min-h-screen place-items-center py-16">
      <ErrorState
        title="Something went wrong"
        message="An unexpected error occurred. You can try again or head back home."
        onRetry={retry}
        action={
          <Button asChild size="sm" variant="ghost">
            <Link href="/">Back to home</Link>
          </Button>
        }
        className="max-w-lg"
      />
    </main>
  );
}
