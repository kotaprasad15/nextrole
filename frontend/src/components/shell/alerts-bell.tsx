"use client";

import { Bell } from "lucide-react";
import Link from "next/link";
import { useAlertSummary } from "@/lib/api/queries";

/** Bell with the unread count (refreshes every minute). Links to /alerts; the count is also in the label. */
export function AlertsBell() {
  const unread = useAlertSummary().data?.unread ?? 0;
  return (
    <Link
      href="/alerts"
      aria-label={unread ? `Alerts, ${unread} unread` : "Alerts"}
      className="relative grid size-10 shrink-0 place-items-center rounded-full border border-border bg-surface text-ink shadow-1 transition-shadow hover:shadow-2"
    >
      <Bell aria-hidden className="size-[18px]" />
      {unread > 0 && (
        <span aria-hidden className="absolute -right-1 -top-1 grid min-w-5 place-items-center rounded-full bg-primary px-1 text-caption font-semibold leading-5 text-on-primary">
          {unread > 9 ? "9+" : unread}
        </span>
      )}
    </Link>
  );
}
