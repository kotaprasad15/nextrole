import { Hammer } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "./page-header";

/** Placeholder for pages built in later redesign milestones. Removed as each page lands. */
export function ComingSoon({ title, description, milestone }: { title: string; description: string; milestone: number }) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <EmptyState
        icon={<Hammer />}
        title="This page is being redesigned"
        description={`It arrives in redesign milestone ${milestone}. The navigation, sign-in and data layer around it already work.`}
      />
    </>
  );
}
