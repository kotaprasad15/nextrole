import type { Metadata } from "next";
import { DashboardPreview } from "@/components/dashboard/dashboard-preview";
import { PageHeader } from "@/components/shell/page-header";

export const metadata: Metadata = { title: "Dashboard" };

// Temporary data check; the real dashboard (tabs, filters, job cards) is milestone 4.
export default function DashboardPage() {
  return (
    <>
      <PageHeader eyebrow="Dashboard" title="Your matches" description="Openings scored against your profile, sorted by company type." />
      <DashboardPreview />
    </>
  );
}
