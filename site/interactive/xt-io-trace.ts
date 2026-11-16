import type { stepXtSessionCpu } from "./xt-session.js";
import type { DebugLocation } from "./instruction-debugger.js";
import { xtDebugLocation } from "./xt-inspection.js";
import { xtIoTransfers } from "./xt-io-events.js";
import type { XtIoTransfer } from "./xt-io-events.js";
export type { XtIoTransfer } from "./xt-io-events.js";

type Boundary = ReturnType<typeof stepXtSessionCpu>;
export interface XtIoEntry {
  readonly sequence: number;
  /** End of the completed CPU/board boundary, not a bus-cycle timestamp. */
  readonly ticks: number;
  readonly caller: DebugLocation;
  readonly bytes: readonly number[];
  readonly transfer: XtIoTransfer;
}

/** A bounded history of recorded transfers. Recording and rendering never execute device reads. */
export function createXtIoTrace(capacity = 1024) {
  if (!Number.isSafeInteger(capacity) || capacity < 1) throw new RangeError("Trace capacity must be positive.");
  const entries: XtIoEntry[] = [];
  let cursor = 0, total = 0, recording = false;
  return {
    get recording() { return recording; },
    set recording(value: boolean) { recording = value; },
    capacity,
    get captured() { return total; },
    get discarded() { return Math.max(0, total - capacity); },
    entries(): readonly XtIoEntry[] { return [...entries.slice(cursor), ...entries.slice(0, cursor)]; },
    clear(): void { entries.length = 0; cursor = 0; total = 0; },
    observe(record: Boundary, ticks: number): void {
      if (!recording || record.outcome !== "executed" && record.outcome !== "accepted") return;
      const transfers = xtIoTransfers(record), bytes = record.instruction?.bytes ?? [];
      if (!transfers.length) return;
      const caller = xtDebugLocation(record.before), capturedBytes = [...bytes];
      for (const transfer of transfers) {
        entries[cursor] = { sequence: ++total, ticks, caller, bytes: capturedBytes, transfer };
        cursor = (cursor + 1) % capacity;
      }
    },
  };
}
