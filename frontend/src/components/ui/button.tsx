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
        danger: "bg-danger text-white shadow-1 hover:brightness-95",
        // Tier fills use ink text: white on coral/teal fails WCAG AA.
        startup: "bg-startup text-ink shadow-1 hover:brightness-95",
        mid: "bg-mid text-ink shadow-1 hover:brightness-95",
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
}

export function Button({ className, variant, size, asChild, magnetic, type, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  const el = (
    <Comp
      data-cursor="link"
      className={cn(buttonVariants({ variant, size }), className)}
      type={asChild ? undefined : (type ?? "button")}
      {...props}
    />
  );
  return magnetic ? <Magnetic>{el}</Magnetic> : el;
}

export { buttonVariants };
