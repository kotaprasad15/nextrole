/**
 * Which cursor look applies over an element. Pure, so it is unit-tested without a pointer.
 * `data-cursor="view|link|none"` on any ancestor wins (nearest first); otherwise native
 * interactive elements count as links, and text-entry elements keep the real caret/cursor.
 */
export type CursorState = "default" | "link" | "view" | "text";

const TEXT_ENTRY = 'textarea, select, [contenteditable="true"], input:not([type="range"], [type="checkbox"], [type="radio"], [type="file"], [type="button"], [type="submit"])';
const INTERACTIVE = 'a[href], button, summary, label, [role="button"], [role="tab"], [role="menuitem"], [role="switch"], [role="radio"], input[type="range"], input[type="checkbox"], input[type="radio"], input[type="file"], input[type="button"], input[type="submit"]';

export function cursorStateFor(el: Element | null): CursorState {
  if (!el) return "default";
  if (el.closest(TEXT_ENTRY)) return "text";
  const marked = el.closest<HTMLElement>("[data-cursor]");
  const mark = marked?.dataset.cursor;
  if (mark === "none") return "text"; // opt-out keeps the native cursor
  if (mark === "view" || mark === "link") {
    // An interactive element INSIDE a "view" area (but not the marked element itself) is still a link.
    const inner = el.closest(INTERACTIVE);
    if (mark === "view" && inner && inner !== marked && marked!.contains(inner)) return "link";
    return mark;
  }
  return el.closest(INTERACTIVE) ? "link" : "default";
}
