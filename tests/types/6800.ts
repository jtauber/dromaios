import { Cpu6800 } from "../../src/components/cpus/6800.js";
import type { Cpu6800State, Cpu6800Snapshot, Cpu6800StepRecord, Cpu6800ResetRecord } from "../../src/components/cpus/6800.js";
import type { Ram } from "../../src/components/memory/ram.js";
import { create6800Example } from "../../src/machines/generated/6800/example.js";
import { create6800StackExample } from "../../src/machines/generated/6800/stack-example.js";
import { create6800LogicExample } from "../../src/machines/generated/6800/logic-example.js";
import { runCpu } from "../../src/runtime/run-cpu.js";
import type { CpuRunResult } from "../../src/runtime/run-cpu.js";

// Compiled, never called: preserve the CPU-specific state and readonly record contracts.
export function check6800(ram: Ram, state: Cpu6800State, snapshot: Cpu6800Snapshot): void {
  const cpu = new Cpu6800(ram, state);
  new Cpu6800(ram, snapshot);
  // @ts-expect-error Every flag is Boolean.
  new Cpu6800(ram, { ...state, flags: { ...state.flags, h: 1 } });
  // @ts-expect-error The 6800 has no D register.
  snapshot.d;
  // @ts-expect-error The 6800 has no direct-page register.
  state.dp;
  // @ts-expect-error SP is the single stack pointer; there is no 6809 U register.
  state.u;
  // @ts-expect-error No halt latch is exposed in this slice.
  state.halted;
  // @ts-expect-error Snapshots are readonly.
  snapshot.sp = 0;
  // @ts-expect-error Snapshot flags are readonly.
  snapshot.flags.i = false;
  const machine: { cpu: Cpu6800; ram: Ram; endAddress: number } = create6800Example();
  const stack: { cpu: Cpu6800; ram: Ram; endAddress: number } = create6800StackExample();
  const stackResult: CpuRunResult<Cpu6800StepRecord> = runCpu(stack.cpu, { maxSteps: 14, endAddress: stack.endAddress });
  const logic: { cpu: Cpu6800; ram: Ram; endAddress: number } = create6800LogicExample();
  const logicResult: CpuRunResult<Cpu6800StepRecord> = runCpu(logic.cpu, { maxSteps: 20, endAddress: logic.endAddress });
  const result: CpuRunResult<Cpu6800StepRecord> = runCpu(cpu, { maxSteps: 3, endAddress: machine.endAddress });
  if (result.records[0]) {
    const i: boolean = result.records[0].after.flags.i;
    // @ts-expect-error The runner preserves the concrete CPU flags.
    result.records[0].after.flags.f;
  }
}

export function check6800Records(record: Cpu6800StepRecord, reset: Cpu6800ResetRecord): void {
  if (record.outcome === "unsupported") {
    const reason: "opcode" = record.reason;
  } else {
    const outcome: "executed" = record.outcome;
    // @ts-expect-error Only unsupported attempts have a reason.
    record.reason;
  }
  const bytes: readonly number[] = record.instruction.bytes;
  // @ts-expect-error Step records are readonly.
  record.outcome = "executed";
  // @ts-expect-error Fetched bytes are readonly.
  record.instruction.bytes.push(0);
  // @ts-expect-error Access lists are readonly.
  record.accesses.push({ kind: "read", address: 0, value: 0 });
  if (record.accesses[0]) {
    // @ts-expect-error Access values are readonly.
    record.accesses[0].value = 0;
  }
  // @ts-expect-error Reset is distinct from an instruction step.
  reset.instruction;
  // @ts-expect-error Reset has no step outcome.
  reset.outcome;
  // @ts-expect-error Reset snapshots are recursively readonly.
  reset.after.flags.i = false;
}
