"use client";

import { motion } from "framer-motion";
import { Tabs as TabsPrimitive } from "radix-ui";
import { createContext, useContext, useId, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { useReducedMotion } from "@/lib/motion/hooks";
import { spring } from "@/lib/motion/tokens";
import { TIER_META, type Tier } from "@/lib/tier";

const Ctx = createContext<{ value: string; pillId: string } | null>(null);

/**
 * Segmented tabs with a sliding active pill (shared-layout animation, transform only).
 * Works controlled (`value` + `onValueChange`) or uncontrolled (`defaultValue`).
 * Keyboard: arrow keys move between tabs, Home/End jump (Radix).
 */
export function Tabs({
  value,
  defaultValue,
  onValueChange,
  children,
  className,
}: {
  value?: string;
  defaultValue?: string;
  onValueChange?: (v: string) => void;
  children: ReactNode;
  className?: string;
}) {
  const [internal, setInternal] = useState(defaultValue ?? "");
  const current = value ?? internal;
  const pillId = useId();
  return (
    <Ctx.Provider value={{ value: current, pillId }}>
      <TabsPrimitive.Root
        value={current}
        onValueChange={(v) => {
          setInternal(v);
          onValueChange?.(v);
        }}
        className={className}
      >
        {children}
      </TabsPrimitive.Root>
    </Ctx.Provider>
  );
}

export function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn("inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-[14px] bg-ink/5 p-1", className)}
      {...props}
    />
  );
}

export function TabsTrigger({
  value,
  children,
  accent,
  className,
}: {
  value: string;
  children: ReactNode;
  /** Tier whose colour appears as a dot and under-line accent when active. */
  accent?: Tier;
  className?: string;
}) {
  const ctx = useContext(Ctx);
  const reduced = useReducedMotion();
  const active = ctx?.value === value;
  return (
    <TabsPrimitive.Trigger
      value={value}
      className={cn(
        "relative inline-flex h-9 shrink-0 items-center gap-2 rounded-[10px] px-3.5 text-small font-medium",
        "text-muted transition-colors hover:text-ink data-[state=active]:text-ink",
        className,
      )}
    >
      {active && ctx && (
        <motion.span
          layoutId={`${ctx.pillId}-pill`}
          aria-hidden
          className="absolute inset-0 rounded-[10px] bg-surface shadow-1"
          transition={reduced ? { duration: 0 } : spring.snappy}
        />
      )}
      {accent && (
        <span aria-hidden className={cn("relative size-2 rounded-full", TIER_META[accent].swatch)} />
      )}
      <span className="relative">{children}</span>
    </TabsPrimitive.Trigger>
  );
}

export function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn("mt-6 focus-visible:outline-offset-8", className)} {...props} />;
}
