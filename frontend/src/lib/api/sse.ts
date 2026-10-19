"use client";

import { useEffect, useState } from "react";
import { API_BASE, IS_MOCK } from "./config";
import { RunEventSchema, type RunEvent } from "./schemas";

export type StreamStatus = "idle" | "connecting" | "live" | "done" | "error";

interface Source {
  onmessage: ((m: { data: string }) => void) | null;
  onerror: (() => void) | null;
  close: () => void;
}

async function openSource(runId: string): Promise<Source> {
  if (IS_MOCK) return new (await import("./mock/events")).MockEventSource(runId);
  const es = new EventSource(`${API_BASE}/runs/${encodeURIComponent(runId)}/events`, { withCredentials: true });
  // Thin adapter so the real EventSource and the mock share one small interface.
  return {
    set onmessage(fn: ((m: { data: string }) => void) | null) {
      es.onmessage = fn ? (e) => fn({ data: String(e.data) }) : null;
    },
    get onmessage() {
      return null;
    },
    set onerror(fn: (() => void) | null) {
      es.onerror = fn;
    },
    get onerror() {
      return null;
    },
    close: () => es.close(),
  };
}

/**
 * Follow a run's live steps (Server-Sent Events). The backend replays history on connect, and a
 * browser EventSource also reconnects by itself, so events are de-duplicated by `seq`. The stream
 * closes itself on `run_finished`. Pass `null` to stay idle.
 */
export function useRunEvents(runId: string | null) {
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [status, setStatus] = useState<StreamStatus>("idle");

  useEffect(() => {
    if (!runId) return;
    let source: Source | null = null;
    let cancelled = false;
    const seen = new Set<number>();
    // Reset when a new run starts; scheduled so state is never set synchronously in the effect.
    queueMicrotask(() => {
      if (cancelled) return;
      setEvents([]);
      setStatus("connecting");
    });

    openSource(runId).then((src) => {
      if (cancelled) return src.close();
      source = src;
      src.onmessage = (m) => {
        const parsed = RunEventSchema.safeParse(JSON.parse(m.data));
        if (!parsed.success || seen.has(parsed.data.seq)) return;
        seen.add(parsed.data.seq);
        setEvents((prev) => [...prev, parsed.data]);
        if (parsed.data.type === "run_finished") {
          setStatus("done");
          src.close();
        } else setStatus("live");
      };
      // EventSource retries on network blips by itself; only report a hard failure.
      src.onerror = () => setStatus((s) => (s === "done" ? s : "error"));
    });
    return () => {
      cancelled = true;
      source?.close();
    };
  }, [runId]);

  const finished = events.find((e) => e.type === "run_finished") ?? null;
  return { events, status, finished };
}
