import type { Metadata } from "next";
import { ComingSoon } from "@/components/shell/coming-soon";

export const metadata: Metadata = { title: "Onboarding" };

export default function Page() {
  return <ComingSoon title="Onboarding" description="Tell us what you are looking for and upload your resume." milestone={3} />;
}
