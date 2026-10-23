import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { HOME_SECTIONS } from "@/lib/marketing/constants";

const ACCENT = { primary: "primary", startup: "startup", mid: "mid", mnc: "mnc" } as const;

/**
 * Shared frame for a story scene: copy on one side, a large glass STAGE with the visual on the other,
 * sized to fill the pinned viewport (no blank bands). On large screens the motion layer pins the
 * section for a short scroll and scrubs its timeline; everywhere else (and with reduced motion, or no
 * JS) it is just this static section, so content never depends on JS.
 *
 * Motion contract: the story targets `[data-scene="<id>"]` and the `[data-el]` elements inside it
 * (see lib/marketing/timelines.ts). Reveals target `[data-reveal]`.
 */
export function SceneShell({
  id,
  step,
  title,
  children,
  points,
  visual,
  flip = false,
  accent = "primary",
}: {
  id: string;
  step: string;
  title: ReactNode;
  children: ReactNode;
  /** Three short, true bullets under the copy (they also fill the column honestly). */
  points?: string[];
  visual: ReactNode;
  flip?: boolean;
  accent?: keyof typeof ACCENT;
}) {
  const c = ACCENT[accent];
  return (
    <section
      data-scene={id}
      data-section={HOME_SECTIONS[id as keyof typeof HOME_SECTIONS]}
      aria-labelledby={`${id}-title`}
      // `.scene` (globals.css): padding on ONE side only, so stacked scenes are separated by exactly one --scene-gap.
      // It becomes a viewport-tall pinned stage ONLY where the story actually pins (desktop, motion allowed);
      // with reduced motion or on small screens the scenes stay compact, with no blank bands between them.
      className="scene relative isolate flex items-center overflow-hidden"
    >
      {/* Soft colour for the glass to refract. Static (no animation) and low alpha: text contrast is tested. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className={cn("absolute -top-24 size-[32rem] rounded-full opacity-[0.14]", flip ? "-left-24" : "-right-24")} style={{ background: `radial-gradient(circle, var(--color-${c}), transparent 68%)` }} />
        <div className={cn("absolute -bottom-32 size-[28rem] rounded-full opacity-[0.12]", flip ? "-right-16" : "-left-16")} style={{ background: "radial-gradient(circle, var(--color-mid), transparent 68%)" }} />
      </div>

      <div
        className={cn(
          "marketing-container grid items-center gap-8 lg:gap-14",
          flip ? "lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]" : "lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]",
        )}
      >
        <div data-reveal className={cn("max-w-xl", flip && "lg:order-2")}>
          <p className="inline-flex rounded-full bg-primary-tint px-3 py-1 text-small font-medium text-primary">{step}</p>
          <h2 id={`${id}-title`} className="mt-4 font-display text-display-lg text-balance">{title}</h2>
          <div className="mt-5 space-y-4 text-body-lg text-muted">{children}</div>
          {points && (
            <ul className="mt-6 space-y-2.5">
              {points.map((p) => (
                <li key={p} className="flex items-start gap-2.5 text-body text-ink/85">
                  <span aria-hidden className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-success-tint text-success-ink">
                    <Check className="size-3.5" />
                  </span>
                  {p}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div
          data-reveal
          data-el="visual"
          className={cn(
            "glass relative grid place-items-center overflow-hidden rounded-[28px] p-5 sm:p-8",
            // Hugs its content but never shrinks below most of the pinned viewport, so the stage reads as full.
            "lg:min-h-[min(36rem,calc(100svh-var(--nav-h)-8rem))]",
            flip && "lg:order-1",
          )}
        >
          {visual}
        </div>
      </div>
    </section>
  );
}
