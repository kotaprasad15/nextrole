import { Badge } from "@/components/ui/badge";
import type { OutreachStatus } from "@/lib/api/schemas";
import { DRAFT_STATUS_LABEL } from "@/lib/outreach";

const TONE = { draft: "warning", critic_passed: "primary", user_approved: "success" } as const;

/** Draft status as a labelled badge (text, not just colour). */
export function DraftStatusBadge({ status }: { status: OutreachStatus }) {
  return <Badge tone={TONE[status]}>{DRAFT_STATUS_LABEL[status]}</Badge>;
}
