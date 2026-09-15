import { Cpu8080 } from "../../src/components/cpus/8080.js";
import type {
  Cpu8080ResetRecord,
  Cpu8080Snapshot,
  Cpu8080State,
  Cpu8080StepRecord,
  Cpu8080InterruptRecord,
} from "../../src/components/cpus/8080.js";
import type { Ram } from "../../src/components/memory/ram.js";
import type { BytePorts, PortAccess } from "../../src/components/cpus/port-access.js";

// Compiled by npm test; never called. Each expected error guards the public API.
export function checkPublicTypes(cpu: Cpu8080, record: Cpu8080StepRecord): void {
  const snapshot = cpu.snapshot();
  // @ts-expect-error Snapshot registers are readonly.
  snapshot.a = 1;
  // @ts-expect-error The EI delay is part of the readonly snapshot.
  snapshot.interruptDeferred = false;
  // @ts-expect-error The snapshot's flags object cannot be replaced.
  snapshot.flags = { s: false, z: false, ac: false, p: false, cy: false };
  // @ts-expect-error Nested snapshot flags are readonly too.
  snapshot.flags.cy = true;
  // @ts-expect-error Derived BC is readonly.
  snapshot.bc = 0;
  // @ts-expect-error Derived DE is readonly.
  snapshot.de = 0;
  // @ts-expect-error Derived HL is readonly.
  snapshot.hl = 0;

  // @ts-expect-error Record fields are readonly.
  record.outcome = "halted";
  // @ts-expect-error The instruction cannot be replaced.
  record.instruction = { address: 0, bytes: [0x3e, 2] };
  // @ts-expect-error The before snapshot cannot be replaced.
  record.before = snapshot;
  // @ts-expect-error Registers in the before snapshot are readonly.
  record.before.pc = 0;
  // @ts-expect-error Flags in the after snapshot are readonly.
  record.after.flags.z = true;
  // @ts-expect-error Derived views in instruction records are readonly.
  record.after.hl = 0;
  // @ts-expect-error Access arrays cannot be replaced.
  record.accesses = [];
  // @ts-expect-error Access arrays are readonly.
  record.accesses.push({ kind: "read", address: 0, value: 0 });
  if (record.accesses[0]) {
    // @ts-expect-error Access entries are readonly too.
    record.accesses[0].value = 0;
  }

  if (record.instruction) {
    // @ts-expect-error Instruction addresses are readonly.
    record.instruction.address = 0;
    // @ts-expect-error Instruction bytes cannot be replaced.
    record.instruction.bytes = [];
    // @ts-expect-error Instruction byte arrays are readonly.
    record.instruction.bytes.push(0);
    // @ts-expect-error Individual instruction bytes are readonly.
    record.instruction.bytes[0] = 0;
  }
}

export function checkInitialization(ram: Ram, state: Cpu8080State, snapshot: Cpu8080Snapshot): Cpu8080[] {
  // @ts-expect-error Stored state has no separate BC register.
  state.bc;
  // @ts-expect-error Stored state has no separate DE register.
  state.de;
  // @ts-expect-error Stored state has no separate HL register.
  state.hl;
  // @ts-expect-error BC is not a separate initialization input.
  new Cpu8080(ram, { ...state, bc: 0x1234 });
  // @ts-expect-error DE is not a separate initialization input.
  new Cpu8080(ram, { ...state, de: 0x1234 });
  // @ts-expect-error HL is not a separate initialization input.
  new Cpu8080(ram, { ...state, hl: 0x1234 });
  return [new Cpu8080(ram, state), new Cpu8080(ram, snapshot)];
}

export function checkOutcomes(record: Cpu8080StepRecord): readonly number[] {
  switch (record.outcome) {
    case "executed":
      // @ts-expect-error Executed records have no unsupported reason.
      record.reason;
      // Checking the outcome is enough to know an instruction exists.
      return record.instruction.bytes;
    case "unsupported": {
      const reason: "opcode" = record.reason;
      // @ts-expect-error Unsupported reasons are readonly.
      record.reason = reason;
      return record.instruction.bytes;
    }
    case "halted":
      // @ts-expect-error Halted records have no unsupported reason.
      record.reason;
      // @ts-expect-error Halted records may have no instruction.
      record.instruction.bytes;
      return record.instruction?.bytes ?? [];
  }
}

export function checkRecordConstruction(cpu: Cpu8080): readonly Cpu8080StepRecord[] {
  const common = { before: cpu.snapshot(), after: cpu.snapshot(), accesses: [] };
  // @ts-expect-error Executed records must carry an instruction.
  const invalidExecuted: Cpu8080StepRecord = { ...common, outcome: "executed", instruction: null };
  // @ts-expect-error Unsupported records must carry an instruction.
  const invalidUnsupported: Cpu8080StepRecord = { ...common, outcome: "unsupported", instruction: null, reason: "opcode" };
  const attempted = { ...common, instruction: { address: 0, bytes: [0x00] } };
  // @ts-expect-error Unsupported records must carry a reason.
  const missingReason: Cpu8080StepRecord = { ...attempted, outcome: "unsupported" };
  // @ts-expect-error Executed records have no unsupported reason.
  const extraExecutedReason: Cpu8080StepRecord = { ...attempted, outcome: "executed", reason: "opcode" };
  // @ts-expect-error Halted records have no unsupported reason.
  const extraHaltedReason: Cpu8080StepRecord = { ...attempted, outcome: "halted", reason: "opcode" };
  // @ts-expect-error The 8080 has no decimal-mode rejection.
  const invalidReason: Cpu8080StepRecord = { ...attempted, outcome: "unsupported", reason: "decimal-mode" };

  // HLT carries an instruction; a call while already halted does not.
  return [
    { ...common, outcome: "halted", instruction: { address: 0, bytes: [0x76] } },
    { ...common, outcome: "halted", instruction: null },
    { ...attempted, outcome: "unsupported", reason: "opcode" },
  ];
}

export function checkResetTypes(cpu: Cpu8080): Cpu8080ResetRecord {
  const record = cpu.reset();
  // @ts-expect-error Reset snapshots cannot be replaced.
  record.before = cpu.snapshot();
  // @ts-expect-error The after snapshot cannot be replaced either.
  record.after = cpu.snapshot();
  // @ts-expect-error Registers in reset snapshots are readonly.
  record.before.pc = 0;
  // @ts-expect-error Control latches in reset snapshots are readonly.
  record.after.halted = true;
  // @ts-expect-error Nested reset flags are readonly.
  record.after.flags.cy = false;
  // @ts-expect-error Derived views in reset records are readonly.
  record.after.bc = 0;
  // @ts-expect-error Reset access arrays cannot be replaced.
  record.accesses = [];
  // @ts-expect-error Reset access arrays are readonly.
  record.accesses.push({ kind: "read", address: 0, value: 0 });
  if (record.accesses[0]) {
    // @ts-expect-error Reset access entries are readonly.
    record.accesses[0].address = 0;
  }
  // @ts-expect-error Reset is not an instruction attempt.
  record.instruction;
  // @ts-expect-error Reset has no step outcome.
  record.outcome;
  // @ts-expect-error Reset has no unsupported reason.
  record.reason;
  // @ts-expect-error A reset record cannot serve as an instruction step record.
  const step: Cpu8080StepRecord = record;
  return record;
}

// Interrupt delivery is an explicit boundary operation, independent of ordinary stepping.
const publicCpuMethods: Record<keyof Cpu8080, true> = { snapshot: true, reset: true, step: true, interrupt: true };

export function checkInterrupt(cpu: Cpu8080, record: Cpu8080InterruptRecord): void {
  const result: Cpu8080InterruptRecord = cpu.interrupt(() => 0xff);
  // @ts-expect-error Acknowledgement supplies a byte, not an instruction array.
  cpu.interrupt(() => [0xcd, 0, 0]);
  // @ts-expect-error Interrupt records are distinct from ordinary memory-fetched steps.
  const step: Cpu8080StepRecord = result;
  // @ts-expect-error Record arrays are readonly.
  record.accesses.push({ kind: "acknowledge", value: 0 });
  // @ts-expect-error Control snapshots are readonly.
  record.after.interruptEnabled = true;
  if (record.outcome === "ignored") {
    const reason: "disabled" | "deferred" = record.reason;
    const instruction: null = record.instruction;
  } else {
    const source: "interrupt" = record.instruction.source;
    // @ts-expect-error External instructions have no memory fetch address.
    record.instruction.address;
    // @ts-expect-error Acknowledged bytes are readonly.
    record.instruction.bytes.push(0);
    if (record.outcome === "unsupported") {
      const reason: "opcode" = record.reason;
    } else {
      // @ts-expect-error Successful interrupt execution has no rejection reason.
      record.reason;
    }
  }
  for (const access of record.accesses) {
    if (access.kind === "acknowledge") {
      // @ts-expect-error Acknowledgement values are readonly.
      access.value = 0;
      // @ts-expect-error Acknowledgement is not a RAM read.
      access.address;
      // @ts-expect-error Acknowledgement is not port input.
      access.port;
    }
  }
}

export function checkPorts(ram: Ram, state: Cpu8080State, ports: BytePorts, record: Cpu8080StepRecord): void {
  new Cpu8080(ram, state, ports);
  // @ts-expect-error A port connection requires both directions.
  new Cpu8080(ram, state, { readPort: () => 0 });
  // @ts-expect-error Port callbacks are readonly.
  ports.readPort = () => 0;
  for (const access of record.accesses) {
    if (access.kind === "input" || access.kind === "output") {
      const port: PortAccess = access;
      // @ts-expect-error Port accesses use a port number, not a memory address.
      access.address;
      // @ts-expect-error Port addresses in records are readonly.
      access.port = 0;
    } else if (access.kind === "read" || access.kind === "write") {
      const address: number = access.address;
      // @ts-expect-error Memory accesses have no port number.
      access.port;
    }
  }
}
