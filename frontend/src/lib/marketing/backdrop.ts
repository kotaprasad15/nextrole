/**
 * Hero backdrop constants, shared by the component and the contrast test so the test checks the
 * values that actually ship. Alphas are deliberately low: text sits on top of these layers.
 */
export const ORBS = [
  { token: "startup", alpha: 0.1, size: "34rem", at: "-left-32 -top-32", depth: 22, drift: "18s" },
  { token: "mid", alpha: 0.09, size: "30rem", at: "left-1/3 top-1/2", depth: -16, drift: "22s" },
  { token: "primary", alpha: 0.08, size: "32rem", at: "-right-24 -top-16", depth: 30, drift: "20s" },
] as const;

/** Three keyframes of one organic shape: identical command structure, so the browser can interpolate `d`. */
export const BLOB_PATHS = [
  "M420 80 C560 40 700 130 720 270 C740 410 640 520 480 530 C320 540 160 480 110 340 C60 200 280 120 420 80 Z",
  "M400 100 C540 60 690 170 700 300 C710 430 600 540 450 520 C300 500 140 450 120 320 C100 190 260 140 400 100 Z",
  "M440 70 C590 90 730 200 700 330 C670 460 560 510 420 540 C280 570 130 440 130 300 C130 160 290 50 440 70 Z",
] as const;

/** The two morphing blobs: gradient from `from` to `to`, each stop at its own alpha. */
export const BLOBS = [
  { from: "startup", to: "primary", fromAlpha: 0.09, toAlpha: 0.075 },
  { from: "mid", to: "mnc", fromAlpha: 0.08, toAlpha: 0.06 },
] as const;

/**
 * Every layer that can sit behind text, as [colour token, alpha]. The contrast test composites ALL of
 * them over the page background (the worst case: they never all overlap at full strength, but they
 * might) and requires AA for the text colours used on the hero.
 */
export const WORST_CASE_LAYERS: [string, number][] = [
  ...ORBS.map((o) => [o.token, o.alpha] as [string, number]),
  ...BLOBS.map((b) => [b.from, b.fromAlpha] as [string, number]),
];
