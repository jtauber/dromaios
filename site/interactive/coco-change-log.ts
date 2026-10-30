import { cpu6809StateDescription } from "../../src/components/cpus/generated/6809-cpu.js";
import type { Cpu6809Snapshot } from "../../src/components/cpus/generated/6809-cpu.js";
import type { RamWrite } from "../../src/components/memory/ram.js";
import type { Coco, stepCoco } from "../../src/machines/6809/coco/runtime.js";
import { createChangeLog } from "./change-log.js";
import { cocoDebugLocation } from "./coco-debugger.js";
import { cocoHex } from "./coco-inspection.js";

export function cocoBoundaryEvent(record: ReturnType<typeof stepCoco>): string | undefined {
  return record.instruction ? undefined : "source" in record ? record.source.toUpperCase() : "CPU waiting";
}

/** The CoCo supplies its physical RAM and 6809 boundary identity; history policy is shared. */
export function createCocoChangeLog(machine: Coco, capacity = 500) {
  return createChangeLog<Cpu6809Snapshot, ReturnType<typeof stepCoco>, RamWrite>({
    state: cpu6809StateDescription, snapshot: () => machine.cpu.snapshot(), location: state => cocoDebugLocation(machine, state.pc),
    event: cocoBoundaryEvent, observeWrites: listener => machine.ram.observeWrites(listener),
    memoryLabel: write => `RAM $${cocoHex(write.address)}`,
  }, capacity);
}
