import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Badge, TierBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "./cn";

describe("cn understands the design tokens", () => {
  it("keeps a colour class when a custom font-size class is merged with it", () => {
    // Regression: this used to yield "bg-primary text-body" (white text lost on primary buttons).
    expect(cn("bg-primary text-on-primary", "text-body")).toBe("bg-primary text-on-primary text-body");
    expect(cn("text-small", "text-muted")).toBe("text-small text-muted");
    expect(cn("text-ink text-caption")).toBe("text-ink text-caption");
  });

  it("still resolves real conflicts, later wins", () => {
    expect(cn("text-small", "text-h3")).toBe("text-h3");
    expect(cn("text-ink", "text-muted")).toBe("text-muted");
    expect(cn("shadow-1", "shadow-2")).toBe("shadow-2");
    expect(cn("rounded-card", "rounded-control")).toBe("rounded-control");
    expect(cn("px-3", "px-5")).toBe("px-5");
  });
});

describe("rendered components keep their text colour and size", () => {
  it("primary button has white-on-indigo text AND its size class", () => {
    render(<Button>Apply</Button>);
    const cls = screen.getByRole("button", { name: "Apply" }).className;
    expect(cls).toContain("text-on-primary");
    expect(cls).toContain("text-body");
    expect(cls).toContain("bg-primary");
  });

  it("every button variant keeps a text colour class alongside its size", () => {
    const variants = ["primary", "secondary", "ghost", "danger", "startup", "mid", "mnc"] as const;
    for (const v of variants) {
      const { unmount } = render(<Button variant={v} size="sm">x-{v}</Button>);
      const cls = screen.getByRole("button", { name: `x-${v}` }).className;
      expect(cls, v).toMatch(/text-(on-primary|ink|white)/);
      expect(cls, v).toContain("text-small");
      unmount();
    }
  });

  it("badges keep both their colour and size", () => {
    render(<><Badge tone="success">ok</Badge><TierBadge tier="startup" /></>);
    expect(screen.getByText("ok").className).toMatch(/text-success-ink[\s\S]*text-caption|text-caption[\s\S]*text-success-ink/);
    expect(screen.getByText("Startups").className).toContain("text-startup-ink");
    expect(screen.getByText("Startups").className).toContain("text-caption");
  });
});
