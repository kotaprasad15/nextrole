"use client";

import { X } from "lucide-react";
import { Dialog } from "radix-ui";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Accessible modal (Radix Dialog): focus is trapped and restored, Escape closes, the title and
 * description are announced. Enter/exit use CSS keyframes (opacity + transform only).
 */
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-[2px] data-[state=open]:animate-[fade-in_180ms_ease-out] data-[state=closed]:animate-[fade-out_140ms_ease-in]" />
        <Dialog.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2",
            "rounded-card border border-border bg-surface p-6 shadow-3 focus:outline-none",
            "data-[state=open]:animate-[modal-in_220ms_cubic-bezier(0.22,1,0.36,1)]",
            "data-[state=closed]:animate-[fade-out_140ms_ease-in]",
            className,
          )}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <Dialog.Title className="text-h3 font-semibold tracking-tight">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="text-small text-muted">{description}</Dialog.Description>
              ) : (
                <Dialog.Description className="sr-only">{title}</Dialog.Description>
              )}
            </div>
            <Dialog.Close
              aria-label="Close dialog"
              className="-mr-2 -mt-2 rounded-full p-2 text-muted transition-colors hover:bg-ink/5 hover:text-ink"
            >
              <X className="size-5" aria-hidden />
            </Dialog.Close>
          </div>
          {children && <div className="mt-5">{children}</div>}
          {footer && <div className="mt-6 flex flex-wrap justify-end gap-3">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
