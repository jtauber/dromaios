import { Cpu6809 } from "../../src/components/cpus/6809.js";
import type {
  Cpu6809ResetRecord,
  Cpu6809Snapshot,
  Cpu6809State,
  Cpu6809StepRecord,
} from "../../src/components/cpus/6809.js";
import type { Ram } from "../../src/components/memory/ram.js";

// Compiled by npm test; never called. Each expected error guards the public API.
export function checkPublicTypes(cpu: Cpu6809, record: Cpu6809StepRecord): void {
  const snapshot = cpu.snapshot();
  const d: number = snapshot.d;
  // @ts-expect-error Snapshot registers are readonly.
  snapshot.a = 1;
  // @ts-expect-error Derived D is readonly too.
  snapshot.d = d;
  // @ts-expect-error The snapshot's flags object cannot be replaced.
  snapshot.flags = { e: false, f: true, h: false, i: true, n: false, z: false, v: false, c: false };
  // @ts-expect-error Nested snapshot flags are readonly too.
  snapshot.flags.h = true;
  // @ts-expect-error The 6809 has no synthetic halt state.
  snapshot.halted;

  // @ts-expect-error Record fields are readonly.
  record.outcome = "executed";
  // @ts-expect-error The instruction cannot be replaced.
  record.instruction = { address: 0, bytes: [0x86, 2] };
  // @ts-expect-error The before snapshot cannot be replaced.
  record.before = snapshot;
  // @ts-expect-error The after snapshot cannot be replaced either.
  record.after = snapshot;
  // @ts-expect-error Registers in the before snapshot are readonly.
  record.before.pc = 0;
  // @ts-expect-error Derived D in the after snapshot is readonly.
  record.after.d = 0;
  // @ts-expect-error Flags in the after snapshot are readonly.
  record.after.flags.z = true;
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

export function checkInitialization(ram: Ram, state: Cpu6809State, snapshot: Cpu6809Snapshot): Cpu6809[] {
  // @ts-expect-error Stored state has no separate D register.
  state.d;
  // @ts-expect-error D is not a separate initialization input.
  new Cpu6809(ram, { ...state, d: 0x1234 });
  // @ts-expect-error Chapter choices retain their literal string union.
  new Cpu6809(ram, { ...state, waitMode: "halted" });
  return [new Cpu6809(ram, state), new Cpu6809(ram, snapshot)];
}

export function checkOutcomes(record: Cpu6809StepRecord): readonly number[] {
  switch (record.outcome) {
    case "waiting":
      // @ts-expect-error An already waiting step need not have fetched an instruction.
      record.instruction.bytes;
      return record.instruction?.bytes ?? [];
    case "executed":
      // @ts-expect-error Executed records have no unsupported reason.
      record.reason;
      return record.instruction.bytes;
    case "unsupported": {
      const reason: "opcode" = record.reason;
      // @ts-expect-error Unsupported reasons are readonly.
      record.reason = reason;
      return record.instruction.bytes;
    }
  }
}

export function checkRecordConstruction(cpu: Cpu6809): readonly Cpu6809StepRecord[] {
  const common = {
    before: cpu.snapshot(), after: cpu.snapshot(), accesses: [],
    instruction: { address: 0, bytes: [0x86, 2] },
  };
  // @ts-expect-error Every attempted instruction carries an instruction record.
  const invalidExecuted: Cpu6809StepRecord = { ...common, outcome: "executed", instruction: null };
  // @ts-expect-error Unsupported records must carry a reason.
  const missingReason: Cpu6809StepRecord = { ...common, outcome: "unsupported" };
  // @ts-expect-error Executed records have no unsupported reason.
  const extraReason: Cpu6809StepRecord = { ...common, outcome: "executed", reason: "opcode" };
  // @ts-expect-error The 6809 has no decimal-mode rejection.
  const invalidReason: Cpu6809StepRecord = { ...common, outcome: "unsupported", reason: "decimal-mode" };
  // @ts-expect-error The CPU does not report lesson completion or a halt outcome.
  const invalidOutcome: Cpu6809StepRecord = { ...common, outcome: "halted" };

  return [
    { ...common, outcome: "waiting" },
    { ...common, outcome: "waiting", instruction: null },
    { ...common, outcome: "executed" },
    { ...common, outcome: "unsupported", reason: "opcode" },
  ];
}

export function checkResetTypes(cpu: Cpu6809): Cpu6809ResetRecord {
  const record = cpu.reset();
  // @ts-expect-error Reset snapshots cannot be replaced.
  record.before = cpu.snapshot();
  // @ts-expect-error The after snapshot cannot be replaced either.
  record.after = cpu.snapshot();
  // @ts-expect-error Registers in reset snapshots are readonly.
  record.before.s = 0;
  // @ts-expect-error Derived D in reset snapshots is readonly.
  record.after.d = 0;
  // @ts-expect-error Nested reset flags are readonly.
  record.after.flags.f = false;
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
  const step: Cpu6809StepRecord = record;
  return record;
}

export function checkInterruptTypes(cpu: Cpu6809): void {
  const waitMode: "none" | "sync" | "cwai" = cpu.snapshot().waitMode;
  const nmiArmed: boolean = cpu.snapshot().nmiArmed;
  // @ts-expect-error Wait state is readonly.
  cpu.snapshot().waitMode = waitMode;
  // @ts-expect-error NMI state is readonly.
  cpu.snapshot().nmiArmed = nmiArmed;
  // @ts-expect-error Software interrupts are instructions, not external offers.
  cpu.interrupt("swi");
  const entry = cpu.interrupt("firq");
  const instruction: null = entry.instruction;
  if (entry.outcome === "accepted") {
    // @ts-expect-error Accepted entries have no rejection reason.
    entry.reason;
  } else if (entry.outcome === "resumed") {
    const source: "irq" | "firq" = entry.source;
    const reason: "masked" = entry.reason;
  } else if (entry.reason === "unarmed") {
    const source: "nmi" = entry.source;
  }
  // @ts-expect-error Interrupt records are readonly.
  entry.source = "nmi";
}
