import type { Metadata } from "next";
import { ComingSoon } from "@/components/shell/coming-soon";

export const metadata: Metadata = { title: "Outreach" };

export default function Page() {
  return <ComingSoon title="Outreach" description="All of your drafts in one place." milestone={5} />;
}
