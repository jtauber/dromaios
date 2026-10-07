import type { Cpu6502StepRecord } from "../../src/components/cpus/generated/6502-cpu.js";
import type { InstructionCatalogue } from "./apple2-explorer.js";
import type { DebugLocation } from "./instruction-debugger.js";
import type { Apple2MemoryChange } from "./apple2-inspection.js";
import type { MemoryWatch } from "./apple2-watches.js";
import { memoryWatchIncludes } from "./apple2-watches.js";

export interface Apple2WatchAccess {
  readonly sequence: number;
  readonly caller: DebugLocation;
  readonly bytes: readonly number[];
  readonly address: number;
  readonly kind: "read" | "write";
  readonly value: number;
  /** A completed physical RAM write, including an unchanged or dummy store. */
  readonly storage?: Apple2MemoryChange;
}

/** Capture watched data transfers, independently of display refresh and stop choices. */
export function createApple2WatchHistory(instructions: InstructionCatalogue, capacity = 256) {
  if (!Number.isSafeInteger(capacity) || capacity < 1) throw new RangeError("Watch history capacity must be positive.");
  type Capture = { entries: Apple2WatchAccess[]; cursor: number; captured: number };
  const captures = new Map<number, Capture>();
  let sequence = 0, configured: readonly MemoryWatch[] | undefined;
  function configure(watches: readonly MemoryWatch[]): void {
    if (configured === watches) return;
    configured = watches;
    const addresses = new Set(watches.map(watch => watch.address));
    for (const address of captures.keys()) if (!addresses.has(address)) captures.delete(address);
    for (const address of addresses) {
      if (!captures.has(address)) captures.set(address, { entries: [], cursor: 0, captured: 0 });
    }
  }
  function clear(): void { captures.clear(); configured = undefined; }
  return {
    get capacity() { return capacity; },
    configure,
    counts(watch: Pick<MemoryWatch, "address">) {
      const captured = captures.get(watch.address)?.captured ?? 0;
      return { captured, discarded: Math.max(0, captured - capacity) };
    },
    /** Oldest first, preserving bus order within each instruction. */
    entries(watch: Pick<MemoryWatch, "address" | "bytes">): readonly Apple2WatchAccess[] {
      const capture = captures.get(watch.address);
      if (!capture) return [];
      const { entries, cursor } = capture;
      return Array.from({ length: entries.length }, (_, index) => entries[(cursor + index) % entries.length]!)
        .filter(entry => memoryWatchIncludes(watch, entry.address));
    },
    observe(record: Cpu6502StepRecord, caller: DebugLocation, watches: readonly MemoryWatch[], writes: readonly Apple2MemoryChange[]): void {
      if (record.outcome !== "executed") return;
      sequence++;
      configure(watches);
      const roles = instructions[record.instruction.bytes[0]!]?.accesses;
      let writeIndex = 0;
      for (const [index, access] of record.accesses.entries()) {
        let storage: Apple2MemoryChange | undefined;
        if (access.kind === "write" && writes[writeIndex]?.address === access.address && writes[writeIndex]?.after === access.value) {
          storage = writes[writeIndex++];
        }
        if (access.kind === "read" && roles?.[index] !== "read") continue;
        const matching = watches.filter(watch => memoryWatchIncludes(watch, access.address));
        if (!matching.length) continue;
        const entry: Apple2WatchAccess = { sequence, caller: { ...caller }, bytes: [...record.instruction.bytes], ...access,
          ...(storage && { storage: { ...storage } }) };
        // Overlapping watches share the captured event, once in each watch's independent ring.
        for (const watch of matching) {
          const capture = captures.get(watch.address)!;
          capture.entries[capture.cursor] = entry;
          capture.cursor = (capture.cursor + 1) % capacity; capture.captured++;
        }
      }
    },
    clear,
    reset(): void { clear(); sequence = 0; },
  };
}
