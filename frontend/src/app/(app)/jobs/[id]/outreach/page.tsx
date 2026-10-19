import type { Metadata } from "next";
import { ComingSoon } from "@/components/shell/coming-soon";

export const metadata: Metadata = { title: "Outreach draft" };

export default function Page() {
  return <ComingSoon title="Outreach draft" description="Edit, review and approve your outreach before you send it." milestone={5} />;
}
