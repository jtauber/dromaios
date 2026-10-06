import type { Cpu6502StepRecord } from "../../src/components/cpus/generated/6502-cpu.js";
import type { DebugLocation } from "./instruction-debugger.js";
import type { InstructionCatalogue } from "./apple2-explorer.js";

export interface Apple2DeviceEvent {
  readonly first: number;
  readonly last: number;
  readonly count: number;
  readonly caller: DebugLocation;
  readonly bytes: readonly number[];
  readonly address: number;
  readonly kind: "read" | "write";
  readonly role: "fetch" | "read" | "write";
  readonly value: number;
}

/** Observed CPU transfers only. Consecutive identical polls coalesce without losing their count. */
export function createApple2DeviceHistory(instructions: InstructionCatalogue, capacity = 128) {
  if (!Number.isSafeInteger(capacity) || capacity < 1) throw new RangeError("Device history capacity must be positive.");
  const entries: Apple2DeviceEvent[] = [];
  let sequence = 0, accesses = 0, discarded = 0;
  return {
    get capacity() { return capacity; },
    get accesses() { return accesses; },
    get discarded() { return discarded; },
    entries(): readonly Apple2DeviceEvent[] { return [...entries].reverse(); },
    observe(record: Cpu6502StepRecord, caller: DebugLocation): void {
      if (record.outcome !== "executed") return;
      sequence++;
      const roles = instructions[record.instruction.bytes[0]!]?.accesses;
      for (const [index, access] of record.accesses.entries()) {
        if (access.address < 0xc000 || access.address >= 0xd000) continue;
        accesses++;
        const event: Apple2DeviceEvent = { first: sequence, last: sequence, count: 1, caller: { ...caller }, bytes: [...record.instruction.bytes],
          ...access, role: roles?.[index] ?? access.kind };
        const previous = entries.at(-1);
        if (previous && previous.caller.address === caller.address && previous.caller.space === caller.space
          && previous.address === event.address && previous.kind === event.kind && previous.role === event.role && previous.value === event.value
          && previous.bytes.length === event.bytes.length && previous.bytes.every((byte, i) => byte === event.bytes[i])) {
          entries[entries.length - 1] = { ...previous, last: sequence, count: previous.count + 1 };
        } else {
          entries.push(event);
          if (entries.length > capacity) discarded += entries.shift()!.count;
        }
      }
    },
    clear(): void { entries.length = 0; accesses = discarded = 0; },
    reset(): void { entries.length = 0; sequence = accesses = discarded = 0; },
  };
}
