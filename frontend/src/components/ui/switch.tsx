"use client";

import { Switch as SwitchPrimitive } from "radix-ui";
import { useId, type ReactNode } from "react";
import { cn } from "@/lib/cn";

interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  className?: string;
}

/** Labelled toggle row. The whole row is the label, so the hit target is large. */
export function Switch({ checked, onCheckedChange, label, description, className }: SwitchProps) {
  const id = useId();
  return (
    <div className={cn("flex items-start justify-between gap-4 rounded-control border border-border bg-surface p-4", className)}>
      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
        <span className="block font-medium">{label}</span>
        {description && <span className="mt-0.5 block text-small text-muted">{description}</span>}
      </label>
      <SwitchPrimitive.Root
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        className="relative h-7 w-12 shrink-0 rounded-full border border-border-strong bg-border transition-colors data-[state=checked]:border-primary data-[state=checked]:bg-primary"
      >
        <SwitchPrimitive.Thumb className="block size-5 translate-x-1 rounded-full bg-surface shadow-1 transition-transform duration-150 data-[state=checked]:translate-x-6" />
      </SwitchPrimitive.Root>
    </div>
  );
}
