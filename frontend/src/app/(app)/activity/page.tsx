import type { Metadata } from "next";
import { ComingSoon } from "@/components/shell/coming-soon";

export const metadata: Metadata = { title: "Activity" };

export default function Page() {
  return <ComingSoon title="Activity" description="See which agents ran, how long they took and what they cost." milestone={8} />;
}
