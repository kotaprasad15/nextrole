"use client";

import { motion } from "framer-motion";
import { Activity, Bookmark, FileCheck2, LayoutGrid, LogOut, Mail, Menu, Settings, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { useLogout } from "@/lib/api/queries";
import { cn } from "@/lib/cn";
import { useReducedMotion } from "@/lib/motion/hooks";
import { spring } from "@/lib/motion/tokens";
import { AlertsBell } from "./alerts-bell";
import { Logo } from "./logo";
import { ThemeToggle } from "./theme-toggle";

export const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutGrid },
  { href: "/saved", label: "Saved", icon: Bookmark },
  { href: "/outreach", label: "Outreach", icon: Mail },
  { href: "/ats", label: "ATS check", icon: FileCheck2 },
  { href: "/activity", label: "Activity", icon: Activity },
  { href: "/profile", label: "Profile", icon: UserRound },
] as const;

/** A path counts as inside a nav section (`/jobs/abc` belongs to the dashboard). */
export function isActive(pathname: string, href: string) {
  if (href === "/dashboard") return pathname === href || pathname.startsWith("/jobs");
  return pathname === href || pathname.startsWith(`${href}/`);
}

function initials(email: string) {
  return email.split("@")[0].split(/[._-]/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("") || "?";
}

/** Static stand-in with the nav's exact height, shown while the pathname-aware nav streams in. */
export function NavFallback() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-bg/85 backdrop-blur-md">
      <div className="page-container flex h-16 items-center justify-between gap-4">
        <Logo href="/dashboard" />
        <Skeleton className="size-10 rounded-full" />
      </div>
    </header>
  );
}

export function AppNav({ email }: { email?: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const reduced = useReducedMotion();
  const [menuOpen, setMenuOpen] = useState(false);
  const logout = useLogout();

  const signOut = () =>
    logout.mutate(undefined, {
      onSettled: () => {
        setMenuOpen(false);
        toast("You have been signed out", { variant: "info" });
        router.replace("/");
      },
    });

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-bg/85 backdrop-blur-md">
      <div className="page-container flex h-16 items-center justify-between gap-4">
        <div className="flex items-center gap-8">
          <Logo href="/dashboard" />
          <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
            {NAV_ITEMS.map(({ href, label }) => {
              const active = isActive(pathname, href);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative rounded-control px-3.5 py-2 text-small font-medium transition-colors",
                    active ? "text-ink" : "text-muted hover:text-ink",
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="nav-pill"
                      aria-hidden
                      className="absolute inset-0 rounded-control bg-surface shadow-1 ring-1 ring-border"
                      transition={reduced ? { duration: 0 } : spring.snappy}
                    />
                  )}
                  <span className="relative">{label}</span>
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-2">
          <AlertsBell />
          <ThemeToggle />
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Account menu"
              className="grid size-10 place-items-center rounded-full border border-border bg-surface text-small font-semibold text-primary shadow-1 transition-shadow hover:shadow-2"
            >
              {email ? initials(email) : <Skeleton className="size-5 rounded-full" />}
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>
                Signed in as
                <span className="block truncate text-small font-medium text-ink">{email ?? "..."}</span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => router.push("/profile")}>
                <UserRound aria-hidden /> Profile
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => router.push("/settings")}>
                <Settings aria-hidden /> Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={signOut}>
                <LogOut aria-hidden /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <button
            type="button"
            aria-label="Open navigation menu"
            onClick={() => setMenuOpen(true)}
            className="grid size-10 place-items-center rounded-full border border-border bg-surface shadow-1 md:hidden"
          >
            <Menu className="size-5" aria-hidden />
          </button>
        </div>
      </div>

      <Sheet open={menuOpen} onOpenChange={setMenuOpen} side="right" title="Menu">
        <nav aria-label="Mobile" className="flex flex-col gap-1">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setMenuOpen(false)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-control px-3 py-3 text-body font-medium",
                  active ? "bg-primary-tint text-primary" : "text-ink hover:bg-ink/5",
                )}
              >
                <Icon className="size-5" aria-hidden /> {label}
              </Link>
            );
          })}
          <Link href="/settings" onClick={() => setMenuOpen(false)} className="flex items-center gap-3 rounded-control px-3 py-3 text-body font-medium hover:bg-ink/5">
            <Settings className="size-5" aria-hidden /> Settings
          </Link>
          <button type="button" onClick={signOut} className="flex items-center gap-3 rounded-control px-3 py-3 text-left text-body font-medium hover:bg-ink/5">
            <LogOut className="size-5" aria-hidden /> Sign out
          </button>
        </nav>
      </Sheet>
    </header>
  );
}
