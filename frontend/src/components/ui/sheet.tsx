"use client";

import { X } from "lucide-react";
import { Dialog } from "radix-ui";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

const SIDES = {
  left: "left-0 top-0 h-full w-[min(88vw,20rem)] data-[state=open]:animate-[slide-in-left_240ms_cubic-bezier(0.22,1,0.36,1)]",
  right: "right-0 top-0 h-full w-[min(88vw,24rem)] data-[state=open]:animate-[slide-in-right_240ms_cubic-bezier(0.22,1,0.36,1)]",
};

/** Side panel (mobile navigation, filters). Same a11y behaviour as Modal. */
export function Sheet({
  open,
  onOpenChange,
  side = "left",
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  side?: "left" | "right";
  title: string;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-ink/40 data-[state=open]:animate-[fade-in_180ms_ease-out]" />
        <Dialog.Content
          className={cn(
            "fixed z-50 flex flex-col gap-6 border-border bg-surface p-6 shadow-3 focus:outline-none",
            side === "left" ? "border-r" : "border-l",
            SIDES[side],
          )}
        >
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-h3 font-semibold">{title}</Dialog.Title>
            <Dialog.Close aria-label="Close" className="rounded-full p-2 text-muted hover:bg-ink/5 hover:text-ink">
              <X className="size-5" aria-hidden />
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">{title}</Dialog.Description>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
