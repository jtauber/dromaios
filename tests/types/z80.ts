import { CpuZ80 } from "../../src/components/cpus/z80.js";
import type { CpuZ80State, CpuZ80Snapshot, CpuZ80StepRecord, CpuZ80ResetRecord } from "../../src/components/cpus/z80.js";
import type { Ram } from "../../src/components/memory/ram.js";
import { createZ80TransfersExample } from "../../src/machines/generated/z80/transfers-example.js";
import { runCpu } from "../../src/runtime/run-cpu.js";
import type { CpuRunResult } from "../../src/runtime/run-cpu.js";

export function checkZ80TransfersExample(): void {
  const machine: { cpu: CpuZ80; ram: Ram } = createZ80TransfersExample();
  const result: CpuRunResult<CpuZ80StepRecord> = runCpu(machine.cpu, { maxSteps: 23 });
  if (result.records[0]) {
    const pair: number = result.records[0].after.hl;
    const overflow: boolean = result.records[0].after.flags.pv;
    // @ts-expect-error The runner preserves Z80 flags rather than the 8080 flag set.
    result.records[0].after.flags.p;
  }
}

// Compiled, never called: keep the public state and record contracts precise.
export function checkZ80(ram: Ram, state: CpuZ80State, snapshot: CpuZ80Snapshot): void {
  new CpuZ80(ram, state);
  new CpuZ80(ram, snapshot);
  const im: 0 | 1 | 2 = snapshot.im;
  const alternatePair: number = snapshot.alternate.hl;
  // @ts-expect-error Interrupt modes are a closed set.
  state.im = 3;
  // @ts-expect-error Derived register pairs are absent from stored state.
  state.alternate.bc;
  // @ts-expect-error Pair views are not separate initialization fields.
  new CpuZ80(ram, { ...state, bc: 0 });
  // @ts-expect-error Both flag banks require Boolean values.
  new CpuZ80(ram, { ...state, alternate: { ...state.alternate, flags: { ...state.alternate.flags, pv: 1 } } });
  // @ts-expect-error Snapshots are recursively readonly.
  snapshot.a = 0;
  // @ts-expect-error Pair views are readonly.
  snapshot.hl = 0;
  // @ts-expect-error Nested banks are readonly.
  snapshot.alternate.b = 0;
  // @ts-expect-error Nested flags are readonly.
  snapshot.alternate.flags.pv = false;
  // @ts-expect-error Main flags are readonly.
  snapshot.flags.n = false;
  // @ts-expect-error The alternate bank cannot be replaced.
  snapshot.alternate = state.alternate;
}

export function checkZ80Records(record: CpuZ80StepRecord, reset: CpuZ80ResetRecord): void {
  if (record.outcome === "unsupported") {
    const reason: "opcode" = record.reason;
    const instruction: readonly number[] = record.instruction.bytes;
  } else {
    // @ts-expect-error Only unsupported records carry a reason.
    record.reason;
    if (record.outcome === "executed") {
      const bytes: readonly number[] = record.instruction.bytes;
    } else {
      // @ts-expect-error Already halted steps have no instruction.
      record.instruction.bytes;
    }
  }
  // @ts-expect-error The record cannot be changed.
  record.outcome = "halted";
  // @ts-expect-error Access arrays are readonly.
  record.accesses.push({ kind: "read", address: 0, value: 0 });
  if (record.accesses[0]) {
    // @ts-expect-error Access entries are readonly.
    record.accesses[0].value = 0;
  }
  if (record.instruction) {
    // @ts-expect-error Instruction bytes are readonly.
    record.instruction.bytes.push(0);
  }
  // @ts-expect-error Reset records do not acquire step outcomes.
  reset.outcome;
  // @ts-expect-error Reset records do not acquire an instruction.
  reset.instruction;
  // @ts-expect-error Reset snapshots remain recursively readonly.
  reset.after.alternate.flags.c = false;
}

// Sharing an internal family keeps the public CPU surface limited to its three operations.
const publicCpuMethods: Record<keyof CpuZ80, true> = { snapshot: true, reset: true, step: true };
