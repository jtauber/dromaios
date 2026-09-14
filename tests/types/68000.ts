import { Cpu68000 } from "../../src/components/cpus/68000.js";
import type { Cpu68000State, Cpu68000Snapshot, Cpu68000StepRecord, Cpu68000ResetRecord } from "../../src/components/cpus/68000.js";
import type { Ram } from "../../src/components/memory/ram.js";
import { create68000Example } from "../../src/machines/generated/68000/example.js";
import { runCpu } from "../../src/runtime/run-cpu.js";
import type { CpuRunResult } from "../../src/runtime/run-cpu.js";

// Compiled, never called: stored state, derived views, and concrete runner outcomes.
export function check68000(ram: Ram, state: Cpu68000State, snapshot: Cpu68000Snapshot): void {
  const cpu = new Cpu68000(ram, state);
  new Cpu68000(ram, snapshot);
  // @ts-expect-error A7 is derived from the two stored stack pointers and S.
  state.a7;
  // @ts-expect-error Physical PC is derived from the stored 32-bit PC.
  state.physicalPc;
  // @ts-expect-error Flags are Boolean.
  new Cpu68000(ram, { ...state, flags: { ...state.flags, x: 1 } });
  // @ts-expect-error Stored snapshot fields are readonly.
  snapshot.d0 = 0;
  // @ts-expect-error Derived snapshot views are readonly.
  snapshot.a7 = 0;
  // @ts-expect-error Nested flags are readonly.
  snapshot.flags.s = true;
  const machine: { cpu: Cpu68000; ram: Ram; endAddress: number } = create68000Example();
  const result: CpuRunResult<Cpu68000StepRecord> = runCpu(cpu, { maxSteps: 3, endAddress: machine.endAddress });
  if (result.records[0]) {
    const d0: number = result.records[0].after.d0;
    const a7: number = result.records[0].after.a7;
    // @ts-expect-error The runner retains CPU-specific flags.
    result.records[0].after.flags.cy;
  }
}

export function check68000Records(record: Cpu68000StepRecord, reset: Cpu68000ResetRecord): void {
  if (record.outcome === "executed") {
    const address: number = record.instruction.address;
    // @ts-expect-error Executed records have no rejection reason.
    record.reason;
  } else if (record.reason === "opcode") {
    const bytes: readonly number[] = record.instruction.bytes;
    // @ts-expect-error An unsupported opcode has no alignment fault.
    record.fault;
  } else {
    const operation: "fetch" | "write" = record.fault.operation;
    // @ts-expect-error Odd-PC attempts have no instruction.
    record.instruction.bytes;
    // @ts-expect-error Fault details are readonly.
    record.fault.address = 0;
  }
  // @ts-expect-error Access lists are readonly.
  record.accesses.push({ kind: "read", address: 0, value: 0 });
  // @ts-expect-error Instruction bytes are readonly.
  record.instruction?.bytes.push(0);
  // @ts-expect-error Reset records have no instruction.
  reset.instruction;
  // @ts-expect-error Reset records have no outcome.
  reset.outcome;
}
