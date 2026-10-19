import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Force mock mode so the hook uses the in-memory event source (no network, no backend).
vi.mock("./config", () => ({ IS_MOCK: true, API_BASE: "/api", SESSION_COOKIE: "nextrole_session" }));

import { mockFetch } from "./mock";
import { useRunEvents } from "./sse";

beforeEach(async () => {
  localStorage.clear();
  localStorage.setItem("nextrole_mock", JSON.stringify({ delay: 0, speed: 0.001 }));
  await mockFetch("/auth/login", { method: "POST", body: JSON.stringify({ email: "a@b.co", password: "password123" }) });
});

async function startRun(mode = "recommend") {
  const res = await mockFetch("/runs", { method: "POST", body: JSON.stringify({ mode }) });
  return (await res.json()).run_id as string;
}

describe("useRunEvents", () => {
  it("stays idle without a run id", () => {
    const { result } = renderHook(() => useRunEvents(null));
    expect(result.current).toMatchObject({ events: [], status: "idle", finished: null });
  });

  it("collects events in order, reports live then done, and exposes the final event", async () => {
    const id = await startRun();
    const { result } = renderHook(() => useRunEvents(id));
    await waitFor(() => expect(result.current.status).toBe("done"), { timeout: 4000 });
    const types = result.current.events.map((e) => e.type);
    expect(types[0]).toBe("run_started");
    expect(types.at(-1)).toBe("run_finished");
    expect(result.current.finished?.data.status).toBe("completed");
    const seqs = result.current.events.map((e) => e.seq);
    expect(new Set(seqs).size).toBe(seqs.length); // no duplicates
  });

  it("de-duplicates events when the stream replays history (reconnect)", async () => {
    const id = await startRun("outreach");
    const first = renderHook(() => useRunEvents(id));
    await waitFor(() => expect(first.result.current.status).toBe("done"), { timeout: 4000 });
    const again = renderHook(() => useRunEvents(id)); // new subscriber replays everything
    await waitFor(() => expect(again.result.current.status).toBe("done"), { timeout: 4000 });
    expect(again.result.current.events.length).toBe(first.result.current.events.length);
  });

  it("reports an error for an unknown run", async () => {
    const { result } = renderHook(() => useRunEvents("does-not-exist"));
    await waitFor(() => expect(result.current.status).toBe("error"));
  });

  it("resets when the run id changes", async () => {
    const a = await startRun();
    const b = await startRun("outreach");
    const { result, rerender } = renderHook(({ id }) => useRunEvents(id), { initialProps: { id: a } });
    await waitFor(() => expect(result.current.status).toBe("done"), { timeout: 4000 });
    rerender({ id: b });
    await waitFor(() => expect(result.current.events[1]?.data).toMatchObject({ steps: expect.arrayContaining(["research"]) }), { timeout: 4000 });
  });
});
