import type { ReactNode } from "react";
import { Logo } from "@/components/shell/logo";
import { SkipLink } from "@/components/shell/skip-link";

// Centered card layout for sign-in and sign-up. (The split-screen version lands in milestone 3.)
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SkipLink />
      <main id="main" className="page-container flex min-h-screen flex-col items-center justify-center gap-8 py-12">
        <Logo />
        <div className="w-full max-w-md">{children}</div>
      </main>
    </>
  );
}
