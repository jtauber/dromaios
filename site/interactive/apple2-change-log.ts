import type { Cpu6502Snapshot, Cpu6502StepRecord } from "../../src/components/cpus/generated/6502-cpu.js";
import type { createApple2Session } from "./apple2-session.js";
import { hex } from "./apple2-explorer.js";
import { apple2RamRegions } from "./apple2-inspection.js";
import type { Apple2MemoryChange } from "./apple2-inspection.js";

type Machine = ReturnType<typeof createApple2Session>["machine"];
export type Apple2ChangeKind = "register" | "flag" | "memory" | "pc";

export interface Apple2Change {
  readonly kind: Apple2ChangeKind;
  readonly target: string;
  readonly before: number;
  readonly after: number;
  readonly width: number;
}

export interface Apple2InstructionChanges {
  readonly sequence: number;
  readonly instruction: Cpu6502StepRecord["instruction"];
  readonly outcome: Cpu6502StepRecord["outcome"] | "interrupted";
  readonly changes: readonly Apple2Change[];
}

function processorChanges(before: Cpu6502Snapshot, after: Cpu6502Snapshot): Apple2Change[] {
  const changes: Apple2Change[] = [];
  for (const name of ["a", "x", "y", "sp", "pc"] as const) {
    if (before[name] !== after[name]) changes.push({ kind: name === "pc" ? "pc" : "register", target: name.toUpperCase(),
      before: before[name], after: after[name], width: name === "pc" ? 4 : 2 });
  }
  for (const name of ["n", "v", "d", "i", "z", "c"] as const) {
    if (before.flags[name] !== after.flags[name]) changes.push({ kind: "flag", target: name.toUpperCase(),
      before: Number(before.flags[name]), after: Number(after.flags[name]), width: 1 });
  }
  return changes;
}

/** Bounded instruction history, observing physical storage rather than re-reading guest addresses. */
export function createApple2ChangeLog(machine: Machine, capacity = 500) {
  if (!Number.isSafeInteger(capacity) || capacity < 1) throw new RangeError("Change log capacity must be a positive integer.");
  const entries: Apple2InstructionChanges[] = [];
  let cursor = 0, sequence = 0, captured = 0, recording = true;
  let writes: Apple2MemoryChange[] | undefined;
  let latest: { readonly record: Cpu6502StepRecord | undefined; readonly writes: readonly Apple2MemoryChange[]; readonly changes: readonly Apple2MemoryChange[] } | undefined;
  const detach = apple2RamRegions.map(({ part, base }) => machine[part].observeWrites(({ address, before, after }) => {
    if (writes !== undefined) writes.push({ region: part, address: base + address, before, after });
  }));

  return {
    get capacity() { return capacity; },
    get recording() { return recording; },
    set recording(value: boolean) { recording = value; },
    get captured() { return captured; },
    get discarded() { return Math.max(0, captured - capacity); },
    /** Last-step observation remains live when history recording is paused or cleared. */
    memoryChanges(record: Cpu6502StepRecord | undefined): readonly Apple2MemoryChange[] {
      return record?.outcome === "executed" && latest?.record === record ? latest.changes : [];
    },
    /** All completed physical stores, including unchanged and read-modify-write dummy stores. */
    memoryWrites(record: Cpu6502StepRecord | undefined): readonly Apple2MemoryChange[] {
      return record?.outcome === "executed" && latest?.record === record ? latest.writes : [];
    },
    /** Newest instruction first; memory changes within it retain write order. */
    entries(): readonly Apple2InstructionChanges[] {
      return Array.from({ length: entries.length }, (_, index) => entries[(cursor - 1 - index + entries.length) % entries.length]!);
    },
    capture(step: () => Cpu6502StepRecord): Cpu6502StepRecord {
      sequence++;
      const before = recording ? machine.cpu.snapshot() : undefined;
      writes = [];
      let record: Cpu6502StepRecord | undefined;
      try { return record = step(); }
      finally {
        const changes = writes.filter(write => write.before !== write.after);
        latest = { record, writes, changes };
        writes = undefined;
        // Even a host error can follow completed writes. Keep those effects, explicitly marked incomplete.
        if (before !== undefined) {
          entries[cursor] = { sequence, instruction: record?.instruction ?? { address: before.pc, bytes: [] },
            outcome: record?.outcome ?? "interrupted",
            changes: [...processorChanges(before, record?.after ?? machine.cpu.snapshot()), ...changes.map(change => ({
              kind: "memory" as const, target: `${apple2RamRegions.find(region => region.part === change.region)!.label} $${hex(change.address)}`,
              before: change.before, after: change.after, width: 2,
            }))] };
          cursor = (cursor + 1) % capacity;
          captured++;
        }
      }
    },
    clear(): void { entries.length = 0; cursor = sequence = captured = 0; },
    dispose(): void { for (const remove of detach) remove(); recording = false; },
  };
}
