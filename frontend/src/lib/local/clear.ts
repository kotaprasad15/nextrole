"use client";

import { clearAllVersions } from "./draft-versions";
import { clearLegacySaves } from "./legacy-saves";

/** Everything NextRole keeps only in this browser (not display preferences). Used by Settings.
 * Saved jobs live in the account now; this also removes any older browser-only copy. */
export function clearLocalData() {
  clearLegacySaves();
  clearAllVersions();
}
