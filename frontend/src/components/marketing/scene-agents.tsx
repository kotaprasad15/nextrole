"use client";

import { Tooltip } from "@/components/ui/tooltip";
import { SceneShell } from "./scene-shell";

/** The real agents (see CLAUDE.md), placed on a ring around the orchestrator. */
export const AGENTS = [
  { id: "discover", name: "Discovery", text: "Reads company job boards (Greenhouse, Lever, Ashby) and keeps the real apply link." },
  { id: "tier", name: "Tiering", text: "Sorts each company into startup, mid-size or MNC." },
  { id: "match", name: "Matcher", text: "Scores each job 0 to 100 against your profile, with strengths and gaps." },
  { id: "research", name: "Researcher", text: "Looks the company up in public sources and cites every fact." },
  { id: "write", name: "Writer", text: "Drafts the message using only facts from your profile, the posting and that research." },
  { id: "critic", name: "Critic", text: "Checks the draft against rules and a rubric, and sends it back for a rewrite if needed." },
] as const;

const CX = 50;
const CY = 50;
const RX = 38;
const RY = 36;
const place = (i: number) => {
  const a = (-90 + i * 60) * (Math.PI / 180);
  return { x: CX + RX * Math.cos(a), y: CY + RY * Math.sin(a) };
};

/** Scene 2: the agent team. Nodes are real focusable buttons with tooltips; lines and pulses are decoration. */
export function SceneAgents() {
  return (
    <SceneShell
      id="agents"
      step="2. A small team of agents"
      title="Each agent has one job, and an orchestrator keeps them in line."
      flip
      accent="mid"
      points={["Plans each run and stops at cost or step limits", "Keeps whatever finished if a step fails", "Every step is visible on the Activity page"]}
      visual={
        <div className="relative aspect-square h-full max-h-[36rem] w-full max-w-[36rem]">
          <svg aria-hidden viewBox="0 0 100 100" className="absolute inset-0 size-full">
            {AGENTS.map((a, i) => {
              const p = place(i);
              return (
                <path key={a.id} data-el="line" pathLength={1} strokeDasharray={1} d={`M ${CX} ${CY} L ${p.x} ${p.y}`} fill="none" stroke="var(--color-border-strong)" strokeWidth={0.5} strokeLinecap="round" />
              );
            })}
          </svg>
          <div data-el="hub" className="absolute left-1/2 top-1/2 grid size-28 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-primary/30 bg-primary-tint text-center shadow-2 sm:size-32">
            <span className="text-small font-semibold text-primary">Orchestrator</span>
          </div>
          {AGENTS.map((a, i) => {
            const p = place(i);
            return (
              <div key={a.id} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${p.x}%`, top: `${p.y}%` }}>
                <Tooltip content={a.text}>
                  <button
                    type="button"
                    data-el="node"
                    data-cursor="link"
                    aria-label={`${a.name}: ${a.text}`}
                    className="relative grid h-14 w-24 place-items-center rounded-control border border-border bg-surface px-2 text-small font-semibold shadow-2 transition-shadow hover:shadow-3 sm:h-[4.25rem] sm:w-32 sm:text-body"
                  >
                    {a.name}
                    <span data-el="status" aria-hidden className="absolute -right-1 -top-1 size-3 rounded-full border-2 border-surface bg-success" />
                  </button>
                </Tooltip>
              </div>
            );
          })}
        </div>
      }
    >
      <p>Discovery finds openings, Tiering sorts the companies, the Matcher scores them, the Researcher checks facts, the Writer drafts and the Critic reviews.</p>
      <p>The orchestrator plans each run, stops it if it hits a cost or step limit, and keeps whatever finished. You can watch every step on the Activity page.</p>
    </SceneShell>
  );
}
