import { cpu6502StateDescription } from "../../src/components/cpus/generated/6502-cpu.js";
import type { Cpu6502Snapshot, Cpu6502StepRecord } from "../../src/components/cpus/generated/6502-cpu.js";
import type { createApple2Session } from "./apple2-session.js";
import { createChangeLog } from "./change-log.js";
import { hex } from "./apple2-explorer.js";
import { apple2DebugLocation } from "./apple2-debugger.js";
import { apple2RamRegions } from "./apple2-inspection.js";
import type { Apple2MemoryChange } from "./apple2-inspection.js";

/** Apple II physical banks and processor state supplied to the shared recorder. */
export function createApple2ChangeLog(machine: ReturnType<typeof createApple2Session>["machine"], capacity = 500) {
  return createChangeLog<Cpu6502Snapshot, Cpu6502StepRecord, Apple2MemoryChange>({
    state: cpu6502StateDescription, snapshot: () => machine.cpu.snapshot(), location: state => apple2DebugLocation(machine, state.pc),
    event: () => undefined,
    observeWrites(listener) {
      const detach = apple2RamRegions.map(({ part, base }) => machine[part].observeWrites(write =>
        listener({ ...write, region: part, address: base + write.address })));
      return () => detach.forEach(remove => remove());
    },
    memoryLabel: write => `${apple2RamRegions.find(region => region.part === write.region)!.label} $${hex(write.address)}`,
  }, capacity);
}
