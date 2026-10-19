/** Company tiers. One definition, so labels and colours are identical on every screen. */
export type Tier = "startup" | "mid" | "mnc";

export const TIERS: Tier[] = ["startup", "mid", "mnc"];

export const TIER_META: Record<
  Tier,
  { label: string; short: string; blurb: string; swatch: string; text: string; tint: string; border: string; ring: string }
> = {
  startup: {
    label: "Startups",
    short: "Startup",
    blurb: "Under ~200 people. Fast, scrappy, broad scope.",
    swatch: "bg-startup",
    text: "text-startup-ink",
    tint: "bg-startup-tint",
    border: "border-startup/40",
    ring: "var(--color-startup)",
  },
  mid: {
    label: "Mid-size",
    short: "Mid-size",
    blurb: "200 to 5,000 people. Real structure, still moving.",
    swatch: "bg-mid",
    text: "text-mid-ink",
    tint: "bg-mid-tint",
    border: "border-mid/40",
    ring: "var(--color-mid)",
  },
  mnc: {
    label: "MNCs",
    short: "MNC",
    blurb: "Over 5,000 people. Established, global, specialised.",
    swatch: "bg-mnc",
    text: "text-mnc-ink",
    tint: "bg-mnc-tint",
    border: "border-mnc/40",
    ring: "var(--color-mnc)",
  },
};
