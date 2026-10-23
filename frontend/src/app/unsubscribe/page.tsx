import type { Metadata } from "next";
import { Unsubscribe } from "@/components/alerts/unsubscribe";

// A private action page reached from an email: keep it out of search results.
export const metadata: Metadata = { title: "Unsubscribe", robots: { index: false, follow: false } };

export default function Page() {
  return <Unsubscribe />;
}
