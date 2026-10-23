import type { SavedStatus } from "@/lib/api/schemas";

export const STATUS_LABEL: Record<SavedStatus, string> = {
  saved: "Saved",
  applied: "Applied",
  interview: "Interview",
  offer: "Offer",
  rejected: "Rejected",
};

export const STATUS_TONE: Record<SavedStatus, "neutral" | "primary" | "success" | "warning" | "danger"> = {
  saved: "neutral",
  applied: "primary",
  interview: "warning",
  offer: "success",
  rejected: "danger",
};

/** "Oct 3, 2026" in the visitor's locale. */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
