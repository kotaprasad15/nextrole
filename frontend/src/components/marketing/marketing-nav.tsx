"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/cn";
import { useActiveSection } from "@/lib/marketing/active-section";
import { HOME_SECTIONS } from "@/lib/marketing/constants";
import { useReducedMotion } from "@/lib/motion/hooks";
import { spring } from "@/lib/motion/tokens";

const LINKS = [
  { href: "#how-it-works", label: "How it works", sections: [HOME_SECTIONS.resume, HOME_SECTIONS.agents, HOME_SECTIONS.jobs, HOME_SECTIONS.outreach, HOME_SECTIONS.ats] as string[] },
  { href: "#faq", label: "FAQ", sections: [HOME_SECTIONS.faq] as string[] },
];

/** In-page links with a sliding pill on the section in view (same pattern as the app nav) and an underline reveal on hover. */
export function MarketingNav() {
  const section = useActiveSection();
  const reduced = useReducedMotion();
  return (
    <nav aria-label="On this page" className="hidden items-center gap-1 md:flex">
      {LINKS.map((l) => {
        const active = l.sections.includes(section);
        return (
          <a
            key={l.href}
            href={l.href}
            data-cursor="link"
            aria-current={active ? "location" : undefined}
            className={cn("relative rounded-full px-4 py-2 text-small font-medium transition-colors", active ? "text-ink" : "text-muted hover:text-ink")}
          >
            {active && (
              <motion.span layoutId="home-nav-pill" aria-hidden className="absolute inset-0 rounded-full bg-surface shadow-1" transition={reduced ? { duration: 0 } : spring.snappy} />
            )}
            <span className="link-underline relative">{l.label}</span>
          </a>
        );
      })}
    </nav>
  );
}
