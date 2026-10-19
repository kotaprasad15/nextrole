import Link from "next/link";
import { cn } from "@/lib/cn";

/** Wordmark: serif "Next" + indigo "Role" with a small mark. Links home (or to `href`). */
export function Logo({ href = "/", className }: { href?: string; className?: string }) {
  return (
    <Link href={href} aria-label="NextRole home" data-cursor="link" className={cn("inline-flex items-center gap-2", className)}>
      <span aria-hidden className="grid size-7 place-items-center rounded-[9px] bg-primary text-on-primary">
        <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 19V5l14 14V5" />
        </svg>
      </span>
      <span className="font-display text-[1.4rem] leading-none tracking-tight">
        Next<span className="text-primary">Role</span>
      </span>
    </Link>
  );
}
