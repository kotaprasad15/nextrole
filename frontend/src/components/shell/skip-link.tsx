/** First focusable element on every page: lets keyboard users jump past the navigation. */
export function SkipLink() {
  return (
    <a
      href="#main"
      className="sr-only z-[70] rounded-control bg-ink px-4 py-2 text-small font-medium text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
    >
      Skip to main content
    </a>
  );
}
