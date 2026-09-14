import { Cpu8088 } from "../../src/components/cpus/8088.js";
import type { Cpu8088State, Cpu8088Snapshot, Cpu8088StepRecord, Cpu8088ResetRecord } from "../../src/components/cpus/8088.js";
import type { Ram } from "../../src/components/memory/ram.js";
import { create8088Example } from "../../src/machines/generated/8088/example.js";
import { create8088TransfersExample } from "../../src/machines/generated/8088/transfers-example.js";
import { runCpu } from "../../src/runtime/run-cpu.js";
import type { CpuRunResult } from "../../src/runtime/run-cpu.js";

// Compiled, never called: preserve logical state, derived views, and concrete runner records.
export function check8088(ram: Ram, state: Cpu8088State, snapshot: Cpu8088Snapshot): void {
  const cpu = new Cpu8088(ram, state);
  new Cpu8088(ram, snapshot);
  // @ts-expect-error AX is stored; AL is a derived snapshot view.
  state.al;
  // @ts-expect-error PC is derived from CS:IP.
  state.pc;
  // @ts-expect-error All nine flags are Boolean.
  new Cpu8088(ram, { ...state, flags: { ...state.flags, if: 1 } });
  // @ts-expect-error No halt latch is modeled yet.
  state.halted;
  // @ts-expect-error Stored registers in snapshots are readonly.
  snapshot.ip = 0;
  // @ts-expect-error Derived registers in snapshots are readonly.
  snapshot.ah = 0;
  // @ts-expect-error Physical PC in snapshots is readonly.
  snapshot.pc = 0;
  // @ts-expect-error Snapshot flags are readonly.
  snapshot.flags.if = false;
  const machine: { cpu: Cpu8088; ram: Ram; endAddress: number } = create8088Example();
  const transfers: { cpu: Cpu8088; ram: Ram; endAddress: number } = create8088TransfersExample();
  const transferResult: CpuRunResult<Cpu8088StepRecord> = runCpu(transfers.cpu, { maxSteps: 12, endAddress: transfers.endAddress });
  const result: CpuRunResult<Cpu8088StepRecord> = runCpu(cpu, { maxSteps: 3, endAddress: machine.endAddress });
  if (result.records[0]) {
    const ip: number = result.records[0].before.ip;
    const pc: number = result.records[0].instruction.address;
    const al: number = result.records[0].after.al;
    // @ts-expect-error The runner preserves CPU-specific flags.
    result.records[0].after.flags.cy;
  }
}

export function check8088Records(record: Cpu8088StepRecord, reset: Cpu8088ResetRecord): void {
  if (record.outcome === "unsupported") {
    const reason: "opcode" = record.reason;
  } else {
    const outcome: "executed" = record.outcome;
    // @ts-expect-error Executed records have no rejection reason.
    record.reason;
  }
  // @ts-expect-error Instruction bytes are readonly.
  record.instruction.bytes.push(0);
  // @ts-expect-error Access lists are readonly.
  record.accesses.push({ kind: "read", address: 0, value: 0 });
  if (record.accesses[0]) {
    // @ts-expect-error Individual accesses are readonly.
    record.accesses[0].address = 0;
  }
  // @ts-expect-error Reset records have no instruction.
  reset.instruction;
  // @ts-expect-error Reset records have no step outcome.
  reset.outcome;
  // @ts-expect-error Reset snapshots are recursively readonly.
  reset.after.flags.if = false;
}
