"use client";

import { useRef, type ReactNode } from "react";
import { useRichMotion } from "./hooks";

/**
 * Subtle 3D tilt toward the pointer (max ~4 degrees), with an optional specular highlight that
 * follows the cursor and a small lift on hover. Fine pointers with motion allowed only; everywhere
 * else it is a plain wrapper. Transform and opacity only, coalesced to one write per frame. The
 * highlight is a soft white disc MOVED with `transform` (not a re-painted gradient).
 */
export function Tilt({
  children,
  max = 4,
  className,
  glare = false,
  lift = 0,
}: {
  children: ReactNode;
  max?: number;
  className?: string;
  glare?: boolean;
  /** Pixels the card rises while hovered. */
  lift?: number;
}) {
  const rich = useRichMotion();
  const ref = useRef<HTMLDivElement>(null);
  const shine = useRef<HTMLSpanElement>(null);
  const frame = useRef(0);
  const hovering = useRef(false);

  if (!rich) return <div className={className}>{children}</div>;

  const apply = (tiltX: number, tiltY: number, glareXY?: { x: number; y: number }) => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      const rise = hovering.current ? -lift : 0;
      el.style.transform = `perspective(900px) translateY(${rise}px) rotateX(${tiltX.toFixed(2)}deg) rotateY(${tiltY.toFixed(2)}deg)`;
      if (shine.current) {
        shine.current.style.opacity = hovering.current ? "1" : "0";
        if (glareXY) shine.current.style.transform = `translate3d(${glareXY.x.toFixed(0)}px, ${glareXY.y.toFixed(0)}px, 0)`;
      }
    });
  };

  return (
    <div
      ref={ref}
      className={className}
      style={{ transition: "transform 180ms ease-out", willChange: "transform", position: "relative" }}
      onPointerEnter={(e) => {
        if (e.pointerType === "mouse") hovering.current = true;
      }}
      onPointerMove={(e) => {
        if (e.pointerType !== "mouse") return;
        const r = e.currentTarget.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width - 0.5;
        const py = (e.clientY - r.top) / r.height - 0.5;
        // The highlight disc is 60% of the card wide; centre it on the pointer.
        apply(-py * 2 * max, px * 2 * max, { x: e.clientX - r.left - r.width * 0.3, y: e.clientY - r.top - r.width * 0.3 });
      }}
      onPointerLeave={() => {
        hovering.current = false;
        apply(0, 0);
      }}
    >
      {children}
      {glare && (
        <span aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]">
          <span
            ref={shine}
            className="absolute left-0 top-0 block aspect-square w-[60%] rounded-full opacity-0 transition-opacity duration-200"
            style={{ background: "radial-gradient(circle, rgb(255 255 255 / 0.55), rgb(255 255 255 / 0) 62%)" }}
          />
        </span>
      )}
    </div>
  );
}
