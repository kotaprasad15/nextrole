/**
 * Saved jobs and the tracker used to live only in this browser (`nextrole_saved_jobs`,
 * `nextrole_tracker`). They are on the server now; this reads whatever an older version left behind so
 * the Saved page can offer a one-time move to the account. Nothing here ever WRITES new data in the
 * old format. Every storage access is guarded (storage can be blocked, full or corrupt).
 */
import { SAVED_STATUSES, type SavedStatus } from "@/lib/api/schemas";

const SAVED_KEY = "nextrole_saved_jobs";
const TRACKER_KEY = "nextrole_tracker";

export interface LegacyItem {
  job_id: string;
  status: SavedStatus;
  notes: string;
}

function readJson(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
}

export function readLegacySaves(): LegacyItem[] {
  const items = new Map<string, LegacyItem>();
  const saved = readJson(SAVED_KEY) as { v?: number; ids?: unknown } | null;
  if (saved?.v === 1 && Array.isArray(saved.ids)) {
    for (const id of saved.ids) if (typeof id === "string") items.set(id, { job_id: id, status: "saved", notes: "" });
  }
  const tracker = readJson(TRACKER_KEY) as { v?: number; jobs?: unknown } | null;
  if (tracker?.v === 1 && Array.isArray(tracker.jobs)) {
    for (const j of tracker.jobs as { id?: unknown; status?: unknown; note?: unknown }[]) {
      if (typeof j?.id !== "string") continue;
      const status = (SAVED_STATUSES as readonly unknown[]).includes(j.status) ? (j.status as SavedStatus) : "saved";
      items.set(j.id, { job_id: j.id, status, notes: typeof j.note === "string" ? j.note.slice(0, 2000) : "" });
    }
  }
  return [...items.values()];
}

/** Drop the given jobs from the old stores (called for the ones that moved), removing empty stores. */
export function removeLegacy(jobIds: string[]) {
  const gone = new Set(jobIds);
  try {
    const saved = readJson(SAVED_KEY) as { v?: number; ids?: string[] } | null;
    if (saved?.ids) {
      const ids = saved.ids.filter((id) => !gone.has(id));
      if (ids.length) localStorage.setItem(SAVED_KEY, JSON.stringify({ v: 1, ids }));
      else localStorage.removeItem(SAVED_KEY);
    }
    const tracker = readJson(TRACKER_KEY) as { v?: number; jobs?: { id?: string }[] } | null;
    if (tracker?.jobs) {
      const jobs = tracker.jobs.filter((j) => typeof j.id === "string" && !gone.has(j.id)); // junk entries are dropped too
      if (jobs.length) localStorage.setItem(TRACKER_KEY, JSON.stringify({ ...tracker, jobs }));
      else localStorage.removeItem(TRACKER_KEY);
    }
  } catch {
    /* storage unavailable: nothing to clean */
  }
}

export function clearLegacySaves() {
  try {
    localStorage.removeItem(SAVED_KEY);
    localStorage.removeItem(TRACKER_KEY);
  } catch {
    /* ignore */
  }
}
