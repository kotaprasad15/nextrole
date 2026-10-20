/** Split pasted/typed text on commas and newlines into trimmed, non-empty parts. */
export function splitTags(text: string): string[] {
  return text.split(/[,\n]/).map((t) => t.trim()).filter(Boolean);
}

/** Add tags, skipping case-insensitive duplicates and stopping at `max`. Returns a new array. */
export function addTags(current: string[], incoming: string[], max = 20): string[] {
  const out = [...current];
  const seen = new Set(out.map((t) => t.toLowerCase()));
  for (const t of incoming) {
    if (out.length >= max) break;
    const key = t.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(t);
    }
  }
  return out;
}
