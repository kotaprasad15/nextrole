import type { Metadata } from "next";
import { Suspense } from "react";
import { RunDetail } from "@/components/activity/run-detail";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Run details" };

async function Content({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  return <RunDetail runId={decodeURIComponent(runId)} />;
}

export default function Page({ params }: { params: Promise<{ runId: string }> }) {
  return (
    <Suspense fallback={<Skeleton className="h-96 rounded-card" />}>
      <Content params={params} />
    </Suspense>
  );
}
