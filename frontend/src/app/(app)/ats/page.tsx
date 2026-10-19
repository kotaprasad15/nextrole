import type { Metadata } from "next";
import { ComingSoon } from "@/components/shell/coming-soon";

export const metadata: Metadata = { title: "ATS check" };

export default function Page() {
  return <ComingSoon title="ATS check" description="Check how well your resume matches a job description." milestone={6} />;
}
