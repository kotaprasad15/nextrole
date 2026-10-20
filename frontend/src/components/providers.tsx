"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Cursor } from "@/components/ui/cursor";
import { DisplayPrefsEffect } from "@/components/display-prefs-effect";
import { Toaster } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ApiError } from "@/lib/api/client";

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        // Retrying cannot fix a 4xx (auth, not found, validation); only retry flaky network/5xx.
        retry: (failures, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && failures < 2,
      },
    },
  });
}

/** App-wide client providers: server-state cache, tooltips, toasts, the custom cursor and display preferences. */
export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(makeQueryClient);
  return (
    <QueryClientProvider client={client}>
      <TooltipProvider>
        {children}
        <Toaster />
        <Cursor />
        <DisplayPrefsEffect />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
