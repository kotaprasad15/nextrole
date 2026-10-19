import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/shell/logo";
import { SkipLink } from "@/components/shell/skip-link";
import { Button } from "@/components/ui/button";

// Public marketing pages. (Smooth scroll and the scrollytelling story join this group in milestone 9.)
export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SkipLink />
      <header className="sticky top-0 z-40 border-b border-border/70 bg-bg/80 backdrop-blur-md">
        <div className="page-container flex h-16 items-center justify-between">
          <Logo />
          <nav aria-label="Account" className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link href="/login">Log in</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/signup">Get started</Link>
            </Button>
          </nav>
        </div>
      </header>
      {children}
      <footer className="border-t border-border py-10">
        <div className="page-container flex flex-wrap items-center justify-between gap-4 text-small text-muted">
          <Logo />
          <p>Drafts are never sent for you. You review, edit and send them yourself.</p>
        </div>
      </footer>
    </>
  );
}
