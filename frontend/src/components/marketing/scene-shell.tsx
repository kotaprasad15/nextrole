import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Shared frame for a story scene: copy on one side, a visual on the other. On large screens the
 * motion layer pins the section for a short scroll and scrubs its timeline; everywhere else (and
 * with reduced motion, or no JS) it is just this static section, so content never depends on JS.
 *
 * Motion contract: the story targets `[data-scene="<id>"]` and the `[data-el]` elements inside it
 * (see lib/marketing/timelines.ts). Reveal on small screens targets `[data-reveal]`.
 */
export function SceneShell({
  id,
  step,
  title,
  children,
  visual,
  flip = false,
}: {
  id: string;
  step: string;
  title: ReactNode;
  children: ReactNode;
  visual: ReactNode;
  flip?: boolean;
}) {
  return (
    <section data-scene={id} aria-labelledby={`${id}-title`} className="relative flex items-center py-16 lg:min-h-screen lg:py-0 lg:pt-16">
      <div className="page-container grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
        <div data-reveal className={cn("max-w-lg", flip && "lg:order-2")}>
          <p className="text-small font-medium text-primary">{step}</p>
          <h2 id={`${id}-title`} className="mt-3 font-display text-display-lg text-balance">{title}</h2>
          <div className="mt-5 space-y-4 text-body-lg text-muted">{children}</div>
        </div>
        <div data-reveal data-el="visual" className={cn("relative", flip && "lg:order-1")}>
          {visual}
        </div>
      </div>
    </section>
  );
}
