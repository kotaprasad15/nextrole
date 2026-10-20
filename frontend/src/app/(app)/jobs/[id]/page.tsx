import type { Metadata } from "next";
import { Suspense } from "react";
import { JobDetail } from "@/components/jobs/job-detail";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Job" };

// params is a Promise in this Next version; it is awaited inside Suspense (Cache Components).
async function Content({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <JobDetail jobId={decodeURIComponent(id)} />;
}

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<Skeleton className="h-64 rounded-card" />}>
      <Content params={params} />
    </Suspense>
  );
}
