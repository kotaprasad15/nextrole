"use client";

import { Pause, Play, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { REPLAY_SPEEDS } from "@/lib/activity/replay";
import { cn } from "@/lib/cn";
import type { Replay } from "./use-replay";

/** Play, pause, restart, speed and a scrubber for a finished run. Keyboard: the slider takes arrow keys. */
export function ReplayControls({ replay }: { replay: Replay }) {
  const { shown, total, playing, speed } = replay;
  return (
    <div role="group" aria-label="Replay this run" className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-card border border-border bg-surface p-4">
      {playing ? (
        <Button size="sm" onClick={replay.pause}><Pause className="size-4" aria-hidden /> Pause</Button>
      ) : (
        <Button size="sm" onClick={replay.play}><Play className="size-4" aria-hidden /> {replay.replaying ? "Resume" : "Replay"}</Button>
      )}
      <Button size="sm" variant="ghost" onClick={replay.restart} aria-label="Restart replay"><RotateCcw className="size-4" aria-hidden /> Restart</Button>

      <div className="flex min-w-48 flex-1 items-center gap-3">
        <input
          type="range"
          min={0}
          max={total}
          value={shown}
          onChange={(e) => replay.seek(Number(e.target.value))}
          aria-label="Replay position"
          aria-valuetext={`Event ${shown} of ${total}`}
          className="h-2 w-full cursor-pointer accent-primary"
        />
        <output className="shrink-0 text-caption tabular-nums text-muted">{shown}/{total}</output>
      </div>

      <div role="group" aria-label="Replay speed" className="flex gap-1">
        {REPLAY_SPEEDS.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={speed === s}
            onClick={() => replay.setSpeed(s)}
            className={cn("h-8 rounded-full border px-3 text-caption font-medium transition-colors", speed === s ? "border-primary bg-primary-tint text-primary" : "border-border-strong hover:border-ink/40")}
          >
            {s}x
          </button>
        ))}
      </div>
      {replay.replaying && <button type="button" onClick={replay.showAll} className="text-small font-medium text-primary hover:underline">Show full run</button>}
    </div>
  );
}
