import type { ReactNode } from "react";
import { AuthShowcase } from "@/components/auth/auth-showcase";
import { Logo } from "@/components/shell/logo";
import { SkipLink } from "@/components/shell/skip-link";

// Split screen on large screens (brand panel + form); a single centered column on small ones.
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SkipLink />
      <div className="grid min-h-screen lg:grid-cols-2">
        <AuthShowcase />
        <main id="main" className="flex flex-col items-center justify-center gap-8 px-4 py-12 sm:px-8">
          <div className="lg:hidden">
            <Logo />
          </div>
          <div className="w-full max-w-sm">{children}</div>
        </main>
      </div>
    </>
  );
}
