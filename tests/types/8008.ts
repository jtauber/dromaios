import { Cpu8008 } from "../../src/components/cpus/8008.js";
import type { Cpu8008State, Cpu8008Snapshot, Cpu8008StepRecord, Cpu8008ResetRecord } from "../../src/components/cpus/8008.js";
import type { Ram } from "../../src/components/memory/ram.js";
import { runCpu } from "../../src/runtime/run-cpu.js";
import type { CpuRunResult } from "../../src/runtime/run-cpu.js";
import { create8008Example } from "../../src/machines/generated/8008/example.js";
import { create8008TransfersExample } from "../../src/machines/generated/8008/transfers-example.js";
import { create8008AluExample } from "../../src/machines/generated/8008/alu-example.js";
import { create8008ControlFlowExample } from "../../src/machines/generated/8008/control-flow-example.js";

// Compiled, never called: preserve concrete CPU types and recursively readonly records.
export function check8008(ram: Ram, state: Cpu8008State, snapshot: Cpu8008Snapshot): void {
  const cpu = new Cpu8008(ram, state);
  new Cpu8008(ram, snapshot);
  const pc: number = snapshot.pc;
  const address: number = snapshot.addressStack[7];
  // @ts-expect-error Caller-supplied address registers remain readonly too.
  state.addressStack[0] = 0;
  // @ts-expect-error The address stack has exactly eight registers.
  new Cpu8008(ram, { ...state, addressStack: [0, 0, 0, 0, 0, 0, 0] });
  // @ts-expect-error PC is derived, not independently initialized.
  new Cpu8008(ram, { ...state, pc: 0 });
  // @ts-expect-error The 8008 has no RAM stack pointer.
  state.sp;
  // @ts-expect-error Derived PC is readonly.
  snapshot.pc = 0;
  // @ts-expect-error Address registers are readonly in snapshots.
  snapshot.addressStack[0] = 0;
  // @ts-expect-error Address stack cannot change size.
  snapshot.addressStack.push(0);
  // @ts-expect-error Flags remain recursively readonly.
  snapshot.flags.c = false;
  // @ts-expect-error The 8008 has no auxiliary carry flag.
  snapshot.flags.ac;
  const result: CpuRunResult<Cpu8008StepRecord> = runCpu(cpu, { maxSteps: 6 });
  const machine: { cpu: Cpu8008; ram: Ram } = create8008Example();
  const transfers: { cpu: Cpu8008; ram: Ram } = create8008TransfersExample();
  const transferResult: CpuRunResult<Cpu8008StepRecord> = runCpu(transfers.cpu, { maxSteps: 14 });
  const alu: { cpu: Cpu8008; ram: Ram } = create8008AluExample();
  const aluResult: CpuRunResult<Cpu8008StepRecord> = runCpu(alu.cpu, { maxSteps: 28 });
  const controlFlow: { cpu: Cpu8008; ram: Ram } = create8008ControlFlowExample();
  const controlFlowResult: CpuRunResult<Cpu8008StepRecord> = runCpu(controlFlow.cpu, { maxSteps: 46 });
  // @ts-expect-error The control-flow example has no caller endpoint.
  create8008ControlFlowExample().endAddress;
  // @ts-expect-error The ALU example stops with HLT rather than a caller endpoint.
  create8008AluExample().endAddress;
  // @ts-expect-error The transfer example stops with HLT rather than a caller endpoint.
  create8008TransfersExample().endAddress;
  // @ts-expect-error This example has no caller endpoint.
  create8008Example().endAddress;
  if (result.records[0]) {
    const pc: number = result.records[0].after.pc;
    // @ts-expect-error The runner preserves readonly nested state.
    result.records[0].after.addressStack[3] = 0;
  }
}

export function check8008Records(record: Cpu8008StepRecord, reset: Cpu8008ResetRecord): void {
  if (record.outcome === "unsupported") {
    const reason: "opcode" = record.reason;
    const bytes: readonly number[] = record.instruction.bytes;
  } else {
    // @ts-expect-error Only unsupported records have a reason.
    record.reason;
    if (record.outcome === "executed") {
      const bytes: readonly number[] = record.instruction.bytes;
    } else {
      // @ts-expect-error Already stopped steps have no instruction.
      record.instruction.bytes;
    }
  }
  // @ts-expect-error Step records are readonly.
  record.outcome = "halted";
  // @ts-expect-error Access lists are readonly.
  record.accesses.push({ kind: "read", address: 0, value: 0 });
  if (record.accesses[0]) {
    // @ts-expect-error Access entries are readonly.
    record.accesses[0].value = 0;
  }
  if (record.instruction) {
    // @ts-expect-error Instruction bytes are readonly.
    record.instruction.bytes.push(0);
  }
  // @ts-expect-error Reset records are distinct from step records.
  reset.outcome;
  // @ts-expect-error Reset does not execute an instruction.
  reset.instruction;
  // @ts-expect-error Reset snapshots remain readonly.
  reset.after.addressStack[0] = 0;
}
