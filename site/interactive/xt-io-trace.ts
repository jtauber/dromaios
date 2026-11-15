import type { stepXtSessionCpu } from "./xt-session.js";
import type { DebugLocation } from "./instruction-debugger.js";
import { xtDebugLocation } from "./xt-debugger.js";
import { opcode8088Index } from "./8088-encoding.js";

type Boundary = ReturnType<typeof stepXtSessionCpu>;
export type XtIoTransfer = { readonly kind: "input" | "output"; readonly port: number; readonly value: number }
  | { readonly kind: "acknowledge"; readonly value: number }
  | { readonly kind: "interrupt"; readonly source: string; readonly vector: number; readonly target: DebugLocation }
  | { readonly kind: "iret"; readonly target: DebugLocation };
export interface XtIoEntry {
  readonly sequence: number;
  /** End of the completed CPU/board boundary, not a bus-cycle timestamp. */
  readonly ticks: number;
  readonly caller: DebugLocation;
  readonly bytes: readonly number[];
  readonly transfer: XtIoTransfer;
}

/** A bounded history of recorded transfers. Recording and rendering never execute device reads. */
export function createXtIoTrace(capacity = 500) {
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
      const transfers: XtIoTransfer[] = [];
      for (const access of record.accesses) {
        if (access.kind === "input" || access.kind === "output") transfers.push({ kind: access.kind, port: access.port, value: access.value });
        else if (access.kind === "acknowledge") transfers.push({ kind: access.kind, value: access.value });
      }
      const interrupt = record.outcome === "accepted" ? record : "interrupt" in record ? record.interrupt : undefined;
      if (interrupt) transfers.push({ kind: "interrupt", source: interrupt.source, vector: interrupt.vector, target: xtDebugLocation(record.after) });
      const bytes = record.instruction?.bytes ?? [];
      if (bytes[opcode8088Index(bytes)] === 0xcf) transfers.push({ kind: "iret", target: xtDebugLocation(record.after) });
      if (!transfers.length) return;
      const caller = xtDebugLocation(record.before), capturedBytes = [...bytes];
      for (const transfer of transfers) {
        entries[cursor] = { sequence: ++total, ticks, caller, bytes: capturedBytes, transfer };
        cursor = (cursor + 1) % capacity;
      }
    },
  };
}
