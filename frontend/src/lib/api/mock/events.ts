/**
 * Simulated orchestrator runs for mock mode. A run emits the same event shapes the real backend
 * streams (run_started, plan, step_started/finished, run_finished), on timers, so the live UI,
 * timelines and history can be developed and demoed without any LLM call.
 */
import type { RunEvent, RunMode } from "../schemas";

const PLANS: Record<RunMode, [string, string, number][]> = {
  recommend: [
    ["discover", "1,284 openings from 40 boards", 1500], ["tier", "37 companies classified", 900],
    ["select", "40 candidates picked from 1,284 openings", 500], ["match", "scored 40 of 40 candidates", 2200], ["save", "saved 40 recommendations", 300],
  ],
  outreach: [
    ["research", "6 sourced facts about the company", 1700], ["facts", "26 facts available to the writer", 400],
    ["write", "draft attempt 1 (118 words)", 1800], ["critic", "score 90/100, passed", 1400], ["save", "draft saved (critic_passed)", 300],
  ],
  single_job: [
    ["ingest", "Backend Engineer at Initech", 1200], ["tier", "1 company classified", 700], ["match", "match score 78/100", 1100],
    ["pin", "added to your dashboard", 300], ["research", "5 sourced facts about Initech", 1600], ["facts", "24 facts available to the writer", 300],
    ["write", "draft attempt 1 (112 words)", 1800], ["critic", "score 88/100, passed", 1300], ["save", "draft saved (critic_passed)", 300],
  ],
};

type Listener = (e: RunEvent) => void;

class MockRun {
  events: RunEvent[] = [];
  listeners = new Set<Listener>();
  done = false;
  constructor(public id: string, public mode: RunMode, speed: number, onFinish: (run: MockRun) => void, failWith?: string, failAt = 1) {
    this.play(speed, onFinish, failWith, failAt);
  }
  private emit(type: RunEvent["type"], fields: Partial<RunEvent> = {}) {
    const e: RunEvent = { seq: this.events.length, ts: Date.now() / 1000, type, step: "", detail: "", latency_ms: 0, tokens: 0, cost_usd: 0, data: {}, ...fields };
    this.events.push(e);
    this.listeners.forEach((l) => l(e));
  }
  private async play(speed: number, onFinish: (run: MockRun) => void, failWith: string | undefined, failAt: number) {
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms * speed));
    const steps = PLANS[this.mode];
    let tokens = 0;
    this.emit("run_started", { data: { mode: this.mode } });
    this.emit("plan", { data: { steps: steps.map((s) => s[0]) } });
    for (let i = 0; i < steps.length; i++) {
      const [step, detail, ms] = steps[i];
      const attempt = step === "write" || step === "critic" ? { attempt: 1 } : {};
      await wait(250);
      this.emit("step_started", { step, data: attempt, tokens });
      await wait(ms);
      if (failWith && i === failAt) {
        this.emit("step_failed", { step, detail: failWith, latency_ms: ms, tokens, data: attempt });
        this.finish("failed", failWith, tokens, onFinish);
        return;
      }
      tokens += Math.round(900 + Math.random() * 2400);
      this.emit("step_finished", { step, detail, latency_ms: ms, tokens, cost_usd: tokens * 0.0000045, data: attempt });
    }
    this.finish("completed", null, tokens, onFinish);
  }
  private finish(status: "completed" | "failed", error: string | null, tokens: number, onFinish: (run: MockRun) => void) {
    this.done = true;
    onFinish(this);
    this.emit("run_finished", { detail: status, tokens, cost_usd: tokens * 0.0000045, data: { status, result: {}, error } });
  }
  subscribe(l: Listener) {
    this.events.forEach(l); // replay history first, like the real SSE endpoint
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  get running() {
    return !this.done;
  }
}

const runs = new Map<string, MockRun>();

export function startMockRun(mode: RunMode, onFinish: (run: MockRun) => void, opts: { speed?: number; failWith?: string; failAt?: number } = {}) {
  const id = Math.random().toString(16).slice(2, 14);
  runs.set(id, new MockRun(id, mode, opts.speed ?? 1, onFinish, opts.failWith, opts.failAt));
  return id;
}
export const getMockRun = (id: string) => runs.get(id);

/** Same surface the app uses from the browser EventSource: onmessage / onerror / close(). */
export class MockEventSource {
  onmessage: ((m: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  private off: (() => void) | null = null;
  constructor(runId: string) {
    const run = runs.get(runId);
    // Defer so callers can attach handlers first (as with a real EventSource).
    setTimeout(() => {
      if (!run) return void this.onerror?.();
      this.off = run.subscribe((e) => this.onmessage?.({ data: JSON.stringify(e) }));
    }, 0);
  }
  close() {
    this.off?.();
  }
}

export type { MockRun };
