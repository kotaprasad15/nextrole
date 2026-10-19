"use client";

import { CheckCircle2, Info, TriangleAlert, X, XCircle } from "lucide-react";
import { Toast as ToastPrimitive } from "radix-ui";
import { useSyncExternalStore } from "react";
import { cn } from "@/lib/cn";

type Variant = "info" | "success" | "warning" | "error";
interface ToastItem {
  id: number;
  title: string;
  description?: string;
  variant: Variant;
}

// A tiny module-level store so `toast()` can be called from anywhere (event handlers, mutations).
let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function toast(title: string, opts: { description?: string; variant?: Variant } = {}) {
  items = [...items, { id: nextId++, title, description: opts.description, variant: opts.variant ?? "info" }];
  emit();
}

function dismiss(id: number) {
  items = items.filter((t) => t.id !== id);
  emit();
}

const ICONS = {
  info: <Info className="size-5 text-primary" aria-hidden />,
  success: <CheckCircle2 className="size-5 text-success-ink" aria-hidden />,
  warning: <TriangleAlert className="size-5 text-warning-ink" aria-hidden />,
  error: <XCircle className="size-5 text-danger" aria-hidden />,
};

/** Mount once near the root. Toasts are announced politely to screen readers (Radix). */
export function Toaster() {
  const list = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => items,
    () => items,
  );
  return (
    <ToastPrimitive.Provider duration={4500} swipeDirection="right">
      {list.map((t) => (
        <ToastPrimitive.Root
          key={t.id}
          onOpenChange={(open) => !open && dismiss(t.id)}
          className={cn(
            "flex items-start gap-3 rounded-card border border-border bg-surface p-4 shadow-3",
            "data-[state=open]:animate-[toast-in_240ms_cubic-bezier(0.22,1,0.36,1)]",
            "data-[state=closed]:animate-[fade-out_140ms_ease-in]",
          )}
        >
          {ICONS[t.variant]}
          <div className="flex-1">
            <ToastPrimitive.Title className="text-small font-semibold">{t.title}</ToastPrimitive.Title>
            {t.description && (
              <ToastPrimitive.Description className="mt-0.5 text-small text-muted">
                {t.description}
              </ToastPrimitive.Description>
            )}
          </div>
          <ToastPrimitive.Close aria-label="Dismiss notification" className="rounded-full p-1 text-muted hover:bg-ink/5">
            <X className="size-4" aria-hidden />
          </ToastPrimitive.Close>
        </ToastPrimitive.Root>
      ))}
      <ToastPrimitive.Viewport className="fixed bottom-4 right-4 z-[60] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2 outline-none" />
    </ToastPrimitive.Provider>
  );
}
