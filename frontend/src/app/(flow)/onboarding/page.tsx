import type { Metadata } from "next";
import { OnboardingWizard } from "@/components/onboarding/wizard";

export const metadata: Metadata = { title: "Set up your profile" };

export default function Page() {
  return <OnboardingWizard />;
}
