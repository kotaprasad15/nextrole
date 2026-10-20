import type { Metadata } from "next";
import { Suspense } from "react";
import { OutreachPage } from "@/components/outreach/outreach-page";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Outreach draft" };

async function Content({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OutreachPage jobId={decodeURIComponent(id)} />;
}

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<Skeleton className="h-96 rounded-card" />}>
      <Content params={params} />
    </Suspense>
  );
}
