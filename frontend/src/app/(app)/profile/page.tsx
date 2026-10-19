import type { Metadata } from "next";
import { ComingSoon } from "@/components/shell/coming-soon";

export const metadata: Metadata = { title: "Profile" };

export default function Page() {
  return <ComingSoon title="Profile" description="Your parsed resume, preferences, saved jobs and application tracker." milestone={7} />;
}
