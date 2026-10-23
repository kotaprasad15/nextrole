"use client";

import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, Loader2, MailX } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ApiError } from "@/lib/api/client";
import { api } from "@/lib/api/endpoints";

/**
 * The page the unsubscribe link in alert emails opens. It works without signing in: the token in the
 * link is the credential. Nothing happens on page load (link scanners and prefetchers open links), only
 * when the person presses the button.
 */
export function Unsubscribe() {
  // Read at click time from the address bar (no useSearchParams, so the page stays static).
  const [token] = useState(() => (typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("token") ?? ""));
  const done = useMutation({ mutationFn: () => api.unsubscribeAlerts(new URLSearchParams(window.location.search).get("token") ?? "") });

  return (
    <main id="main" className="grid min-h-screen place-items-center px-4 py-12">
      <Card className="flex w-full max-w-md flex-col items-center gap-4 text-center">
        {done.isSuccess ? (
          <>
            <CheckCircle2 className="size-10 text-success-ink" aria-hidden />
            <h1 className="font-display text-display">You are unsubscribed</h1>
            <p className="text-muted">We will not email you about new roles any more. You can still see alerts in NextRole, and turn email back on in your alert settings.</p>
            <Button asChild variant="secondary"><Link href="/">Back to NextRole</Link></Button>
          </>
        ) : (
          <>
            <MailX className="size-10 text-primary" aria-hidden />
            <h1 className="font-display text-display">Stop alert emails?</h1>
            <p className="text-muted">Press the button to stop emails about new roles at companies you watch.</p>
            {done.error && (
              <p role="alert" className="rounded-control bg-danger-tint px-3.5 py-3 text-small font-medium text-danger-ink">
                {done.error instanceof ApiError && done.error.status === 404 ? "This link is not valid any more. Sign in and turn email alerts off in your alert settings." : "Something went wrong. Please try again."}
              </p>
            )}
            <Button size="lg" onClick={() => done.mutate()} disabled={done.isPending || !token}>
              {done.isPending && <Loader2 className="size-5 animate-spin" aria-hidden />} Unsubscribe
            </Button>
            {!token && <p className="text-small text-muted">This link is incomplete. Open it again from the email.</p>}
          </>
        )}
      </Card>
    </main>
  );
}
