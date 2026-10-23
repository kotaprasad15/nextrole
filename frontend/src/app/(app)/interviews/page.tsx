import type { Metadata } from "next";
import { InterviewsPage } from "@/components/interviews/interviews-page";

export const metadata: Metadata = { title: "Interview experiences" };

export default function Page() {
  return <InterviewsPage />;
}
