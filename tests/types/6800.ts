import { Cpu6800 } from "../../src/components/cpus/6800.js";
import type { Cpu6800State, Cpu6800Snapshot, Cpu6800StepRecord, Cpu6800ResetRecord, Cpu6800InterruptRecord } from "../../src/components/cpus/6800.js";
import type { Ram } from "../../src/components/memory/ram.js";
import { create6800Example } from "../../src/machines/generated/6800/example.js";
import { create6800StackExample } from "../../src/machines/generated/6800/stack-example.js";
import { create6800LogicExample } from "../../src/machines/generated/6800/logic-example.js";
import { create6800AddressingExample } from "../../src/machines/generated/6800/addressing-example.js";
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
  // @ts-expect-error WAI has its own waiting latch, not the external HALT input.
  state.halted;
  const waiting: boolean = snapshot.waiting;
  // @ts-expect-error Waiting is Boolean.
  new Cpu6800(ram, { ...state, waiting: 1 });
  // @ts-expect-error Waiting is required, including when false.
  new Cpu6800(ram, { a: 0, b: 0, x: 0, sp: 0, pc: 0, flags: state.flags });
  // @ts-expect-error The waiting snapshot field is readonly.
  snapshot.waiting = false;
  const entry: Cpu6800InterruptRecord = cpu.interrupt("nmi");
  cpu.interrupt("irq");
  // @ts-expect-error Only the original 6800's external sources are accepted.
  cpu.interrupt("firq");
  // @ts-expect-error Snapshots are readonly.
  snapshot.sp = 0;
  // @ts-expect-error Snapshot flags are readonly.
  snapshot.flags.i = false;
  const machine: { cpu: Cpu6800; ram: Ram; endAddress: number } = create6800Example();
  const stack: { cpu: Cpu6800; ram: Ram; endAddress: number } = create6800StackExample();
  const stackResult: CpuRunResult<Cpu6800StepRecord> = runCpu(stack.cpu, { maxSteps: 14, endAddress: stack.endAddress });
  const logic: { cpu: Cpu6800; ram: Ram; endAddress: number } = create6800LogicExample();
  const logicResult: CpuRunResult<Cpu6800StepRecord> = runCpu(logic.cpu, { maxSteps: 20, endAddress: logic.endAddress });
  const addressing: { cpu: Cpu6800; ram: Ram; endAddress: number } = create6800AddressingExample();
  const addressingResult: CpuRunResult<Cpu6800StepRecord> = runCpu(addressing.cpu, { maxSteps: 19, endAddress: addressing.endAddress });
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
    const bytes: readonly number[] = record.instruction.bytes;
  } else if (record.outcome === "waiting") {
    // @ts-expect-error Already waiting steps have no fetched instruction.
    record.instruction.bytes;
    const bytes: readonly number[] | undefined = record.instruction?.bytes;
    // @ts-expect-error Waiting is a supported outcome, without an unsupported reason.
    record.reason;
  } else {
    const outcome: "executed" = record.outcome;
    const bytes: readonly number[] = record.instruction.bytes;
    // @ts-expect-error Only unsupported attempts have a reason.
    record.reason;
  }
  // @ts-expect-error Step records are readonly.
  record.outcome = "executed";
  // @ts-expect-error Fetched bytes are readonly.
  record.instruction?.bytes.push(0);
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

export function check6800Interrupt(record: Cpu6800InterruptRecord): void {
  const instruction: null = record.instruction;
  if (record.outcome === "ignored") {
    const source: "irq" = record.source;
    const reason: "masked" = record.reason;
  } else {
    const source: "irq" | "nmi" = record.source;
    // @ts-expect-error Accepted entry has no rejection reason.
    record.reason;
  }
  // @ts-expect-error Interrupt records and their state are readonly.
  record.after.waiting = false;
  // @ts-expect-error Accesses remain readonly.
  record.accesses.push({ kind: "read", address: 0, value: 0 });
  // @ts-expect-error Accepted/ignored delivery is distinct from an instruction step.
  const step: Cpu6800StepRecord = record;
}
