import type { Metadata } from "next";
import { ExperienceForm } from "@/components/interviews/experience-form";

export const metadata: Metadata = { title: "Share an interview experience" };

export default function Page() {
  return <ExperienceForm />;
}
