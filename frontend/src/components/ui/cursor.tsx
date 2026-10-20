"use client";

import { useEffect, useRef } from "react";
import { cursorStateFor, type CursorState } from "@/lib/motion/cursor-state";
import { useCustomCursor } from "@/lib/motion/hooks";

const RING_LERP = 0.2;

/**
 * Custom cursor: an exact-follow dot and a ring that eases after it. It renders nothing unless the
 * device has a fine pointer, motion is allowed and the user has not turned it off in Settings
 * (touch devices get tap feedback from the buttons instead). One delegated `pointerover` listener
 * picks the look from the element under the pointer (see cursor-state.ts), so no component needs
 * its own hover handlers. Only transform and opacity change; the loop pauses when the pointer is
 * still and when the tab is hidden. Text fields keep the real cursor.
 */
export function Cursor() {
  const enabled = useCustomCursor();
  return enabled ? <CursorLayer /> : null;
}

function CursorLayer() {
  const dot = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  const shape = useRef<HTMLDivElement>(null);
  const label = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    document.documentElement.classList.add("cursor-custom");
    const target = { x: -100, y: -100 };
    const pos = { x: -100, y: -100 };
    let raf = 0;
    let visible = false;
    let state: CursorState = "default";
    let pressed = false;

    const paint = () => {
      const s = shape.current;
      if (!s) return;
      s.dataset.state = visible ? (pressed ? `${state}-press` : state) : "hidden";
      if (label.current) label.current.style.opacity = visible && state === "view" ? "1" : "0";
    };

    const tick = () => {
      pos.x += (target.x - pos.x) * RING_LERP;
      pos.y += (target.y - pos.y) * RING_LERP;
      if (ring.current) ring.current.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0)`;
      raf = Math.abs(target.x - pos.x) + Math.abs(target.y - pos.y) > 0.1 ? requestAnimationFrame(tick) : 0;
    };
    const wake = () => {
      if (!raf && !document.hidden) raf = requestAnimationFrame(tick);
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      target.x = e.clientX;
      target.y = e.clientY;
      if (!visible) {
        visible = true;
        pos.x = target.x; // appear in place instead of flying in from the corner
        pos.y = target.y;
        paint();
      }
      if (dot.current) dot.current.style.transform = `translate3d(${e.clientX}px, ${e.clientY}px, 0)`;
      wake();
    };
    const onOver = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const next = cursorStateFor(e.target as Element | null);
      if (next !== state) {
        state = next;
        paint();
      }
    };
    const onDown = () => ((pressed = true), paint());
    const onUp = () => ((pressed = false), paint());
    const onLeave = (e: MouseEvent) => {
      if (e.relatedTarget === null) {
        visible = false;
        paint();
      }
    };

    document.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerover", onOver, { passive: true });
    document.addEventListener("pointerdown", onDown, { passive: true });
    document.addEventListener("pointerup", onUp, { passive: true });
    document.addEventListener("mouseout", onLeave);
    document.addEventListener("visibilitychange", wake);
    return () => {
      cancelAnimationFrame(raf);
      document.documentElement.classList.remove("cursor-custom");
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("mouseout", onLeave);
      document.removeEventListener("visibilitychange", wake);
    };
  }, []);

  return (
    <div aria-hidden className="pointer-events-none fixed left-0 top-0 z-[100]">
      <div ref={ring} className="absolute left-0 top-0 will-change-transform">
        <div
          ref={shape}
          data-state="hidden"
          className={[
            "-ml-4 -mt-4 grid size-8 place-items-center rounded-full border-[1.5px] border-ink/45",
            "transition-[transform,opacity,background-color,border-color] duration-200 ease-out",
            "data-[state=hidden]:opacity-0 data-[state=text]:opacity-0",
            "data-[state=link]:scale-[1.6] data-[state=link]:border-primary data-[state=link]:bg-primary/10",
            "data-[state=view]:scale-[2.4] data-[state=view]:border-primary data-[state=view]:bg-primary-tint",
            "data-[state=default-press]:scale-75 data-[state=link-press]:scale-100 data-[state=view-press]:scale-[2]",
          ].join(" ")}
        >
          {/* Pre-scaled font: the ring grows 2.4x in the "view" state, which brings this to about 12px. */}
          <span ref={label} className="text-[0.3rem] font-semibold uppercase tracking-wide text-primary opacity-0 transition-opacity duration-150">View</span>
        </div>
      </div>
      <div ref={dot} className="absolute left-0 top-0 will-change-transform">
        <div className="-ml-[3px] -mt-[3px] size-1.5 rounded-full bg-ink" />
      </div>
    </div>
  );
}
