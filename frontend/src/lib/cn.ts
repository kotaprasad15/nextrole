import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge must know our custom design-token utilities. Without this it cannot tell that
 * `text-body` / `text-small` are font SIZES, assumes they are text COLOURS, and then silently
 * drops a real colour class (e.g. `text-on-primary`) as a "conflict", or drops the size when a
 * colour follows it. Keep these lists in sync with the `--text-*`, `--radius-*` and `--shadow-*`
 * tokens in globals.css (cn.test.ts guards the important cases).
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["display-xl", "display-lg", "display", "h1", "h2", "h3", "body-lg", "body", "small", "caption"] }],
      rounded: [{ rounded: ["card", "control"] }],
      shadow: [{ shadow: ["1", "2", "3"] }],
    },
  },
});

/** Merge class names, resolving Tailwind conflicts (later wins). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
