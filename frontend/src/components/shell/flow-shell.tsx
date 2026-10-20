"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useLogout } from "@/lib/api/queries";
import { Logo } from "./logo";
import { SkipLink } from "./skip-link";
import { useSessionGuard } from "./use-session-guard";

/** Minimal chrome for focused flows: logo, a log-out escape hatch, and a centred column. */
export function FlowShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const logout = useLogout();
  useSessionGuard();

  return (
    <>
      <SkipLink />
      <header className="page-container flex h-16 items-center justify-between">
        <Logo />
        <Button
          variant="ghost"
          size="sm"
          disabled={logout.isPending}
          onClick={() => logout.mutate(undefined, { onSettled: () => router.replace("/") })}
        >
          Log out
        </Button>
      </header>
      <main id="main" className="page-container pb-16 pt-6 md:pt-10">
        {children}
      </main>
    </>
  );
}
