import type { ExecutionPacing } from "./execution-controller.js";

/** Limit Run by completed CPU clocks, carrying whole-instruction overshoot forward. */
export function createClockPacing({ ticks, hertz, now }: {
  readonly ticks: () => number;
  readonly hertz: number;
  readonly now: () => number;
}): ExecutionPacing {
  if (!Number.isFinite(hertz) || hertz <= 0) throw new RangeError("Run pacing requires a positive clock frequency.");
  // Retain at most one frame of work after a late callback or a slow inspector.
  const maximumLag = hertz * 0.016;
  let previousTime = 0, target = 0;
  return {
    restart() { previousTime = now(); target = ticks(); },
    beginBatch() {
      const time = now();
      target = Math.min(target + Math.max(0, time - previousTime) * hertz / 1000, ticks() + maximumLag);
      previousTime = time;
    },
    canStep: () => ticks() < target,
  };
}
