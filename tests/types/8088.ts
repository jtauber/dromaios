import { Cpu8088 } from "../../src/components/cpus/8088.js";
import type { Cpu8088State, Cpu8088Snapshot, Cpu8088StepRecord, Cpu8088ResetRecord, Cpu8088Access, Cpu8088MemoryAccess } from "../../src/components/cpus/8088.js";
import type { BytePorts } from "../../src/components/cpus/port-access.ts";
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
  const halted: boolean = state.halted;
  // @ts-expect-error Snapshot halt latches are readonly.
  snapshot.halted = true;
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
    const pc: number | undefined = result.records[0].instruction?.address;
    const al: number = result.records[0].after.al;
    // @ts-expect-error The runner preserves CPU-specific flags.
    result.records[0].after.flags.cy;
  }
}

export function check8088Records(record: Cpu8088StepRecord, reset: Cpu8088ResetRecord): void {
  if (record.outcome === "unsupported") {
    const reason: "opcode" = record.reason;
    const bytes: readonly number[] = record.instruction.bytes;
  } else if (record.outcome === "executed") {
    const outcome: "executed" = record.outcome;
    // @ts-expect-error Executed records have no rejection reason.
    record.reason;
  } else {
    const halted: "halted" = record.outcome;
    const instruction: Cpu8088StepRecord["instruction"] = record.instruction;
  }
  if (record.instruction) {
    // @ts-expect-error Instruction bytes are readonly.
    record.instruction.bytes.push(0);
  }
  // @ts-expect-error Access lists are readonly.
  record.accesses.push({ kind: "read", address: 0, value: 0 });
  const access = record.accesses[0];
  if (access && (access.kind === "read" || access.kind === "write")) {
    // @ts-expect-error Individual accesses are readonly.
    access.address = 0;
  }
  // @ts-expect-error Reset records have no instruction.
  reset.instruction;
  // @ts-expect-error Reset records have no step outcome.
  reset.outcome;
  // @ts-expect-error Reset snapshots are recursively readonly.
  reset.after.flags.if = false;
}

export function check8088Ports(ram: Ram, state: Cpu8088State, ports: BytePorts, access: Cpu8088Access): void {
  const cpu = new Cpu8088(ram, state, ports);
  const result: CpuRunResult<Cpu8088StepRecord> = runCpu(cpu, { maxSteps: 1 });
  const memory: Cpu8088MemoryAccess = { kind: "read", address: 0xfffff, value: 0x34 };
  if (access.kind === "input" || access.kind === "output") {
    const port: number = access.port;
    const value: number = access.value;
    // @ts-expect-error Port accesses do not carry a memory address.
    access.address;
    // @ts-expect-error Individual port accesses are readonly.
    access.port = 0;
  }
  // @ts-expect-error Connected inputs return numbers.
  new Cpu8088(ram, state, { readPort: () => "00", writePort: () => {} });
  // @ts-expect-error Connections must provide both byte transfer callbacks.
  new Cpu8088(ram, state, { readPort: () => 0 });
}

export function check8088Interrupts(cpu: Cpu8088, state: Cpu8088State, snapshot: Cpu8088Snapshot): void {
  cpu.interrupt("nmi");
  const record = cpu.interrupt("intr", () => 0x20);
  // @ts-expect-error INTR must supply a vector callback.
  cpu.interrupt("intr");
  // @ts-expect-error NMI takes its fixed vector without a callback.
  cpu.interrupt("nmi", () => 2);
  // @ts-expect-error Only the native INTR/NMI source names are accepted.
  cpu.interrupt("irq", () => 0);
  // @ts-expect-error A supplied vector is a number.
  cpu.interrupt("intr", () => "20");
  if (record.outcome === "accepted") {
    const vector: number = record.vector;
    // @ts-expect-error Accepted interrupts have no rejection reason.
    record.reason;
  } else {
    const reason: "masked" | "deferred" = record.reason;
    // @ts-expect-error Ignored requests do not obtain a vector.
    record.vector;
  }
  const access = record.accesses[0];
  if (access?.kind === "acknowledge") {
    const value: number = access.value;
    // @ts-expect-error Acknowledge transfers have no memory address.
    access.address;
  }
  // @ts-expect-error Snapshot trap state is readonly.
  snapshot.trapPending = true;
  // @ts-expect-error Inhibition is a Boolean latch.
  state.segmentDeferred = 1;
  // @ts-expect-error All inhibition latches are required for restoration.
  const incomplete: Cpu8088State = { ...state, interruptDeferred: undefined };
  const step = cpu.step();
  if (step.instruction === null && step.outcome === "executed") {
    const source: "trap" = step.interrupt.source;
    const vector: 1 = step.interrupt.vector;
  }
}
