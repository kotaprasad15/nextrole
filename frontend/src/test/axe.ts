import axe from "axe-core";

/**
 * Run axe-core on a rendered subtree and return readable violation lines (empty = clean).
 * jsdom has no layout, so `color-contrast` cannot run here (contrast is enforced by
 * tokens.contrast.test.ts and Lighthouse); `region` is off because components render without the
 * page's landmarks, which the real layouts provide (checked by Lighthouse in the browser).
 */
export async function a11yViolations(node: Element): Promise<string[]> {
  const result = await axe.run(node, {
    rules: { "color-contrast": { enabled: false }, region: { enabled: false } },
    resultTypes: ["violations"],
  });
  return result.violations.map((v) => `${v.id} (${v.impact}): ${v.help} -> ${v.nodes.map((n) => n.html.slice(0, 120)).join(" | ")}`);
}
