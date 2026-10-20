import { describe, expect, it } from "vitest";
import { PAST_RUNS } from "@/lib/api/mock/data";
import { RunDetailSchema, type RunEvent } from "@/lib/api/schemas";
import { eventsUpTo, replayDelay } from "./replay";
import { buildTrace, formatCost, formatDuration, runDurationMs } from "./trace";

const ev = (seq: number, ts: number, type: RunEvent["type"], o: Partial<RunEvent> = {}): RunEvent => ({
  seq, ts, type, step: "", detail: "", latency_ms: 0, tokens: 0, cost_usd: 0, data: {}, ...o,
});

const RUN: RunEvent[] = [
  ev(0, 100, "run_started"),
  ev(1, 100, "plan", { data: { steps: ["research", "write", "critic"] } }),
  ev(2, 100.25, "step_started", { step: "research" }),
  ev(3, 105.25, "step_finished", { step: "research", detail: "6 facts", latency_ms: 5000, tokens: 1000, cost_usd: 0.004 }),
  ev(4, 105.5, "step_started", { step: "write", data: { attempt: 1 } }),
  ev(5, 112.5, "step_finished", { step: "write", detail: "118 words", latency_ms: 7000, tokens: 3000, cost_usd: 0.012, data: { attempt: 1 } }),
  ev(6, 112.75, "step_started", { step: "critic", data: { attempt: 1 } }),
  ev(7, 117.75, "step_finished", { step: "critic", detail: "score 70", latency_ms: 5000, tokens: 3500, cost_usd: 0.014, data: { attempt: 1 } }),
  ev(8, 118, "step_started", { step: "write", data: { attempt: 2 } }),
  ev(9, 124, "step_failed", { step: "write", detail: "timeout", latency_ms: 6000, tokens: 3500, cost_usd: 0.014, data: { attempt: 2 } }),
  ev(10, 124.1, "run_finished", { tokens: 3500, cost_usd: 0.014, data: { status: "failed", error: "timeout" } }),
];

describe("buildTrace", () => {
  const t = buildTrace(RUN);
  it("builds one row per step and attempt, in order", () => {
    expect(t.steps.map((s) => s.key)).toEqual(["research", "write", "critic", "write#2"]);
    expect(t.steps[3].label).toBe("Writing the draft (attempt 2)");
  });
  it("places each step on the timeline", () => {
    expect(t.steps[0]).toMatchObject({ status: "done", startMs: 250, durationMs: 5000, detail: "6 facts" });
    expect(t.steps[1].startMs).toBe(5500);
    expect(t.totalMs).toBeCloseTo(24100, 0);
  });
  it("attributes tokens and cost to each step from the cumulative totals", () => {
    expect(t.steps.map((s) => s.tokens)).toEqual([1000, 2000, 500, 0]);
    expect(t.steps[1].costUsd).toBeCloseTo(0.008, 6);
    expect(t.tokens).toBe(3500);
    expect(t.costUsd).toBeCloseTo(0.014, 6);
  });
  it("reports the outcome and marks the failed step", () => {
    expect(t.outcome).toBe("failed");
    expect(t.steps[3].status).toBe("failed");
  });
  it("handles a partial (live or replayed) stream: running and pending steps", () => {
    const part = buildTrace(eventsUpTo(RUN, 5));
    expect(part.outcome).toBe("running");
    expect(part.steps.map((s) => s.status)).toEqual(["done", "running", "pending"]);
    expect(part.steps[1].durationMs).toBe(0);
  });
  it("drops steps that never ran once the run has finished", () => {
    const done = [ev(0, 1, "run_started"), ev(1, 1, "plan", { data: { steps: ["a", "b"] } }), ev(2, 1.1, "step_started", { step: "a" }), ev(3, 2, "step_failed", { step: "a", latency_ms: 900 }), ev(4, 2, "run_finished", { data: { status: "failed" } })];
    expect(buildTrace(done).steps.map((s) => s.key)).toEqual(["a"]);
  });
  it("is empty for no events", () => {
    expect(buildTrace([])).toMatchObject({ steps: [], totalMs: 0, outcome: "running" });
  });
  it("parses the mock history through the real schema and traces a rewrite loop", () => {
    const outreach = RunDetailSchema.parse(PAST_RUNS[1]);
    const trace = buildTrace(outreach.events);
    expect(trace.outcome).toBe("completed");
    expect(trace.steps.map((s) => s.key)).toContain("write#2");
    expect(trace.totalMs).toBeGreaterThan(trace.steps.reduce((m, s) => Math.max(m, s.durationMs), 0));
  });
});

describe("replay", () => {
  it("keeps real gaps in proportion but clamped, and scales with speed", () => {
    expect(replayDelay(RUN, 0)).toBe(0);
    expect(replayDelay(RUN, 3)).toBe(1400); // a 5 s step is capped
    expect(replayDelay(RUN, 2)).toBe(250); // 0.25 s gap
    expect(replayDelay(RUN, 1)).toBe(160); // 0 s gap hits the minimum
    expect(replayDelay(RUN, 3, 4)).toBe(350);
    expect(replayDelay(RUN, 99)).toBe(0);
  });
  it("returns the prefix of events, safely clamped", () => {
    expect(eventsUpTo(RUN, 3)).toHaveLength(3);
    expect(eventsUpTo(RUN, -2)).toHaveLength(0);
    expect(eventsUpTo(RUN, 999)).toHaveLength(RUN.length);
  });
});

describe("formatting", () => {
  it("formats durations and costs", () => {
    expect(formatDuration(420)).toBe("420 ms");
    expect(formatDuration(7400)).toBe("7.4 s");
    expect(formatDuration(72_000)).toBe("1 min 12 s");
    expect(formatCost(0)).toBe("$0");
    expect(formatCost(0.0042)).toBe("$0.0042");
    expect(formatCost(1.5)).toBe("$1.50");
  });
  it("computes run duration from stored UTC timestamps", () => {
    expect(runDurationMs({ started_at: "2026-10-19 18:30:10", finished_at: "2026-10-19 18:31:22" })).toBe(72_000);
    expect(runDurationMs({ started_at: "2026-10-19 18:30:10", finished_at: null })).toBeNull();
  });
});
