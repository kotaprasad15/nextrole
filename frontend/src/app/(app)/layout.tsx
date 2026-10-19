import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/app-shell";

// Everything under (app) is the signed-in product: guarded by proxy.ts, wrapped in the shell.
export default function AppLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
