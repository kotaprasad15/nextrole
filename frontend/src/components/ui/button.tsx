"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { Magnetic } from "@/lib/motion/magnetic";

const buttonVariants = cva(
  [
    "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap font-medium",
    "rounded-control transition-[transform,background-color,box-shadow,border-color,color] duration-200",
    // Tap feedback for touch (and a subtle press on mouse): transform only.
    "active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50",
  ],
  {
    variants: {
      variant: {
        primary: "bg-primary text-on-primary shadow-1 hover:bg-primary-hover hover:shadow-2",
        secondary: "border border-border-strong bg-surface text-ink shadow-1 hover:border-ink/40 hover:shadow-2",
        ghost: "text-ink hover:bg-ink/5",
        danger: "bg-danger text-on-danger shadow-1 hover:brightness-95",
        // Tier fills use ink text: white on coral/teal fails WCAG AA.
        startup: "bg-startup text-on-startup shadow-1 hover:brightness-95",
        mid: "bg-mid text-on-mid shadow-1 hover:brightness-95",
        mnc: "bg-mnc text-white shadow-1 hover:brightness-95",
      },
      size: {
        sm: "h-9 px-3 text-small",
        md: "h-11 px-5 text-body",
        lg: "h-13 px-7 text-body-lg",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** Render the child element (e.g. a Link) with button styling. */
  asChild?: boolean;
  /** Gentle pull toward the pointer on fine-pointer devices. Use for primary CTAs. */
  magnetic?: boolean;
  /**
   * Marketing hover effects, OFF by default so the app UI keeps its calm buttons.
   * "glow": rotating gradient border, light sweep on hover, sliding arrow, 0.97 press (primary CTAs).
   * "outline": border draws itself and the fill slides in from the left (secondary CTAs).
   * Hover-only effects use hover media (fine pointers); reduced motion collapses all of it.
   */
  fx?: "glow" | "outline";
}

const FX_CLASS = {
  glow: "fx-border group active:scale-[0.97] hover:[&_.fx-arrow]:translate-x-1",
  outline: "fx-outline group relative overflow-hidden active:scale-[0.97] hover:[&_.fx-arrow]:translate-x-1",
} as const;

/** Decorative layers for the fx buttons: a light sweep (glow) or a sliding fill (outline). */
function FxLayers({ fx }: { fx: "glow" | "outline" }) {
  return fx === "glow" ? (
    <span aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]">
      <span className="absolute inset-y-0 -left-1/2 w-1/2 -translate-x-full -skew-x-12 bg-white/30 transition-transform duration-700 ease-out group-hover:translate-x-[400%]" />
    </span>
  ) : (
    <span aria-hidden className="pointer-events-none absolute inset-0 origin-left scale-x-0 bg-primary-tint transition-transform duration-300 ease-out group-hover:scale-x-100" />
  );
}

export function Button({ className, variant, size, asChild, magnetic, fx, type, children, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  // Slottable keeps the real child (e.g. a Link) as THE element and merges the extra layers into it. The
  // layers must be direct children of Comp (not wrapped in a fragment), or Slot cannot find the Slottable.
  const content = fx
    ? [
        fx === "outline" && <FxLayers key="fx-under" fx={fx} />,
        <Slot.Slottable key="child">{children}</Slot.Slottable>,
        fx === "glow" && <FxLayers key="fx-over" fx={fx} />,
      ]
    : children;
  const el = (
    <Comp
      className={cn(buttonVariants({ variant, size }), fx && FX_CLASS[fx], className)}
      type={asChild ? undefined : (type ?? "button")}
      {...props}
    >
      {content}
    </Comp>
  );
  return magnetic ? <Magnetic>{el}</Magnetic> : el;
}

export { buttonVariants };
