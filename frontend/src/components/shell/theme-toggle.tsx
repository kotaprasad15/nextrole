"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/cn";

/**
 * Light/dark switch. Both icons are always rendered and CSS (`dark:`) picks one, so the server and
 * first client render are identical (the real theme is only known in the browser) and there is no
 * hydration mismatch or icon flash. The label is static for the same reason; Settings has the
 * full System / Light / Dark choice.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <button
      type="button"
      aria-label="Toggle light or dark theme"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      className={cn(
        "relative grid size-10 shrink-0 place-items-center rounded-full border border-border bg-surface text-ink shadow-1 transition-shadow hover:shadow-2",
        className,
      )}
    >
      <Sun aria-hidden className="size-[18px] dark:hidden" />
      <Moon aria-hidden className="hidden size-[18px] dark:block" />
    </button>
  );
}
