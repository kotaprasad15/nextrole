"use client";

import { motion, useMotionValue, useSpring } from "framer-motion";
import type { ReactNode } from "react";
import { useRichMotion } from "./hooks";
import { spring } from "./tokens";

/**
 * Pulls its child gently toward the pointer. Only active on fine pointers with motion
 * allowed; otherwise it renders the child untouched. `strength` is the fraction of the
 * pointer offset applied (0.25 is subtle).
 */
export function Magnetic({
  children,
  strength = 0.25,
  className,
}: {
  children: ReactNode;
  strength?: number;
  className?: string;
}) {
  const rich = useRichMotion();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, spring.follow);
  const sy = useSpring(y, spring.follow);

  if (!rich) return <span className={className}>{children}</span>;

  return (
    <motion.span
      className={className}
      style={{ x: sx, y: sy, display: "inline-flex" }}
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        x.set((e.clientX - (r.left + r.width / 2)) * strength);
        y.set((e.clientY - (r.top + r.height / 2)) * strength);
      }}
      onPointerLeave={() => {
        x.set(0);
        y.set(0);
      }}
    >
      {children}
    </motion.span>
  );
}
