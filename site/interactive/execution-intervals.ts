import type { DebugStop } from "./instruction-debugger.js";

export type MeasuredStep = "step" | "over" | "out";
interface Clock { readonly ticks: number }
interface IntervalResult { readonly clocks: number; readonly stop: DebugStop["kind"] }
export interface ExecutionInterval {
  readonly action: MeasuredStep;
  readonly clocks: number;
  readonly stop?: DebugStop["kind"];
}

/** Inspector measurements follow a stable machine clock; they are not hardware snapshot state. */
export function createExecutionIntervals(readClock: () => Clock) {
  let clock = readClock(), marker: number | undefined;
  let interval: { action: MeasuredStep; start: number; result?: IntervalResult } | undefined;
  function current(): number {
    const next = readClock();
    // Even restoring a later clock value starts a different execution history.
    if (next !== clock) { clock = next; marker = undefined; interval = undefined; }
    return clock.ticks;
  }
  return {
    mark(): void { marker = current(); },
    clearMarker(): void { current(); marker = undefined; },
    begin(action: MeasuredStep): void { const start = current(); interval = { action, start }; },
    clearStep(): void { current(); interval = undefined; },
    update(running: boolean, stop?: DebugStop["kind"]): {
      marker: { at: number; clocks: number } | undefined;
      interval: ExecutionInterval | undefined;
    } {
      const ticks = current();
      if (interval && !interval.result && !running) {
        interval.result = { clocks: ticks - interval.start, stop: stop ?? "pause" };
      }
      return {
        marker: marker === undefined ? undefined : { at: marker, clocks: ticks - marker },
        interval: interval && { action: interval.action, ...(interval.result ?? { clocks: ticks - interval.start }) },
      };
    },
  };
}

/** Keep completed steps distinct from a measured request stopped by another debugger event. */
export function executionIntervalText(interval: ExecutionInterval): string {
  const labels = { step: "Step", over: "Step over", out: "Step out" };
  const complete = interval.stop === interval.action || interval.action === "over" && interval.stop === "step";
  const status = interval.stop === undefined ? "running" : complete ? "complete"
    : interval.stop === "error" ? "failed" : "stopped";
  return `${labels[interval.action]}: ${interval.clocks.toLocaleString()} CPU clocks · ${status}`;
}
