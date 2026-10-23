import type { Metadata } from "next";
import { SavedPage } from "@/components/saved/saved-page";

export const metadata: Metadata = { title: "Saved jobs" };

export default function Page() {
  return <SavedPage />;
}
