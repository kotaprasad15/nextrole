"use client";

import { clearAllVersions } from "./draft-versions";
import { clearSavedJobs } from "./saved-jobs";
import { clearTracker } from "./tracker";

/** Everything NextRole keeps only in this browser (not display preferences). Used by Settings. */
export function clearLocalData() {
  clearSavedJobs();
  clearTracker();
  clearAllVersions();
}
