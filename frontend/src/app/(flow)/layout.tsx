import type { ReactNode } from "react";
import { FlowShell } from "@/components/shell/flow-shell";

// Focused, signed-in flows (onboarding): guarded by proxy.ts, but no app navigation to wander off to.
export default function FlowLayout({ children }: { children: ReactNode }) {
  return <FlowShell>{children}</FlowShell>;
}
