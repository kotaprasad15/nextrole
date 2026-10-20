"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { useReducedMotion } from "@/lib/motion/hooks";
import { duration, ease } from "@/lib/motion/tokens";

/**
 * Page transition for the signed-in app: an ENTER-only fade and short rise (a template remounts
 * on every navigation). Exit animations are unreliable in the App Router, so there are none.
 * Skipped with reduced motion; the wrapper ends at `transform: none`, so it never traps
 * fixed or sticky descendants.
 */
export default function Template({ children }: { children: ReactNode }) {
  const reduced = useReducedMotion();
  return (
    <motion.div initial={reduced ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: duration.base, ease: ease.out }}>
      {children}
    </motion.div>
  );
}
