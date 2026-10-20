import type { Metadata } from "next";
import { ActivityList } from "@/components/activity/activity-list";
import { PageHeader } from "@/components/shell/page-header";

export const metadata: Metadata = { title: "Activity" };

export default function Page() {
  return (
    <>
      <PageHeader eyebrow="Activity" title="What the agents did" description="Every search and draft is a run. Open one to see each step, how long it took, and what it cost." />
      <ActivityList />
    </>
  );
}
