import Link from "next/link";
import type { ReactNode } from "react";
import { MarketingNav } from "@/components/marketing/marketing-nav";
import { ScrollRing } from "@/components/marketing/scroll-ring";
import { Logo } from "@/components/shell/logo";
import { SkipLink } from "@/components/shell/skip-link";
import { Button } from "@/components/ui/button";

// Public marketing pages. Smooth scroll and the scroll story are added per page by <ScrollStory>.
export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SkipLink />
      <header className="sticky top-0 z-40 h-[var(--nav-h)] border-b border-border/70 bg-bg/80 backdrop-blur-md">
        <div className="marketing-container flex h-full items-center justify-between">
          <Logo />
          <MarketingNav />
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
      <ScrollRing />
      <footer className="border-t border-border pb-24 pt-10">
        <div className="marketing-container flex flex-wrap items-center justify-between gap-4 text-small text-muted">
          <Logo />
          <p>Drafts are never sent for you. You review, edit and send them yourself.</p>
        </div>
      </footer>
    </>
  );
}
