import type { Metadata } from "next";
import { ComingSoon } from "@/components/shell/coming-soon";

export const metadata: Metadata = { title: "Job" };

export default function Page() {
  return <ComingSoon title="Job" description="Strengths, gaps, company research and outreach for one opening." milestone={5} />;
}
