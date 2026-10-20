"use client";

import { useRef, type ReactNode } from "react";
import { useRichMotion } from "./hooks";

/**
 * Subtle 3D tilt toward the pointer (max ~4 degrees). Fine pointers with motion allowed only;
 * everywhere else it is a plain wrapper. Transform only, coalesced to one write per frame.
 */
export function Tilt({ children, max = 4, className }: { children: ReactNode; max?: number; className?: string }) {
  const rich = useRichMotion();
  const ref = useRef<HTMLDivElement>(null);
  const frame = useRef(0);

  if (!rich) return <div className={className}>{children}</div>;

  const apply = (transform: string) => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      if (ref.current) ref.current.style.transform = transform;
    });
  };

  return (
    <div
      ref={ref}
      className={className}
      style={{ transition: "transform 160ms ease-out", willChange: "transform" }}
      onPointerMove={(e) => {
        if (e.pointerType !== "mouse") return;
        const r = e.currentTarget.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width - 0.5;
        const py = (e.clientY - r.top) / r.height - 0.5;
        apply(`perspective(900px) rotateX(${(-py * 2 * max).toFixed(2)}deg) rotateY(${(px * 2 * max).toFixed(2)}deg)`);
      }}
      onPointerLeave={() => apply("perspective(900px) rotateX(0deg) rotateY(0deg)")}
    >
      {children}
    </div>
  );
}
