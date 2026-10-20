import type { Metadata } from "next";
import { DraftsList } from "@/components/outreach/drafts-list";
import { PageHeader } from "@/components/shell/page-header";

export const metadata: Metadata = { title: "Outreach" };

export default function Page() {
  return (
    <>
      <PageHeader eyebrow="Outreach" title="Your drafts" description="Everything you have written, with its review status. Nothing here is ever sent for you." />
      <DraftsList />
    </>
  );
}
