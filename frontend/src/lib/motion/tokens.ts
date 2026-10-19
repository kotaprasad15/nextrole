/**
 * Motion tokens: the only place durations, easings and springs are defined.
 * Components import these instead of hard-coding numbers, so the feel of the whole app can be
 * tuned in one file. Animate transform/opacity only (compositor-friendly).
 */
export const duration = { fast: 0.15, base: 0.24, slow: 0.4, slower: 0.7 } as const;

export const ease = {
  /** Decelerating: elements arriving. */
  out: [0.22, 1, 0.36, 1],
  /** Symmetric: elements moving between states. */
  inOut: [0.65, 0, 0.35, 1],
} as const;

export const spring = {
  snappy: { type: "spring", stiffness: 420, damping: 32, mass: 0.7 },
  soft: { type: "spring", stiffness: 220, damping: 26, mass: 0.9 },
  /** For magnetic / follow effects. */
  follow: { stiffness: 220, damping: 18, mass: 0.4 },
} as const;

export const stagger = { tight: 0.04, base: 0.07, loose: 0.12 } as const;
