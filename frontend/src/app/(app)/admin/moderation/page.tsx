import type { Metadata } from "next";
import { ModerationPage } from "@/components/admin/moderation-page";

export const metadata: Metadata = { title: "Moderation", robots: { index: false, follow: false } };

export default function Page() {
  return <ModerationPage />;
}
