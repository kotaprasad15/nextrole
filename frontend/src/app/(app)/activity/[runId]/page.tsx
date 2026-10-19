import type { Metadata } from "next";
import { ComingSoon } from "@/components/shell/coming-soon";

export const metadata: Metadata = { title: "Run details" };

export default function Page() {
  return <ComingSoon title="Run details" description="A step-by-step timeline of one run." milestone={8} />;
}
