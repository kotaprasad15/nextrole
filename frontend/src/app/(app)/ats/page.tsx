import type { Metadata } from "next";
import { AtsChecker } from "@/components/ats/ats-checker";
import { PageHeader } from "@/components/shell/page-header";

export const metadata: Metadata = { title: "ATS check" };

export default function Page() {
  return (
    <>
      <PageHeader
        eyebrow="ATS check"
        title="Will your resume get past the filter?"
        description="Compare your resume with a job description and see which keywords and formatting a parser would catch or miss. It runs entirely in your browser."
      />
      <AtsChecker />
    </>
  );
}
