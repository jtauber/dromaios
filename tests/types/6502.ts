import type { Cpu6502, Cpu6502ResetRecord, Cpu6502StepRecord, Cpu6502InterruptRecord } from "../../src/components/cpus/generated/6502-cpu.js";

// Compiled by npm test; never called. Each expected error guards the public API.
export function checkPublicTypes(cpu: Cpu6502, record: Cpu6502StepRecord): void {
  const snapshot = cpu.snapshot();
  // @ts-expect-error Snapshot registers are readonly.
  snapshot.a = 1;
  // @ts-expect-error The snapshot's flags object cannot be replaced.
  snapshot.flags = { n: false, v: false, d: false, i: true, z: false, c: true };
  // @ts-expect-error Nested snapshot flags are readonly too.
  snapshot.flags.c = true;
  // @ts-expect-error The 6502 has no synthetic halt state.
  snapshot.halted;

  // @ts-expect-error Record fields are readonly.
  record.outcome = "executed";
  // @ts-expect-error The instruction cannot be replaced.
  record.instruction = { address: 0, bytes: [0xa9, 2] };
  // @ts-expect-error The before snapshot cannot be replaced.
  record.before = snapshot;
  // @ts-expect-error Registers in the before snapshot are readonly.
  record.before.pc = 0;
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

  // @ts-expect-error Instruction addresses are readonly.
  record.instruction.address = 0;
  // @ts-expect-error Instruction bytes cannot be replaced.
  record.instruction.bytes = [];
  // @ts-expect-error Instruction byte arrays are readonly.
  record.instruction.bytes.push(0);
  // @ts-expect-error Individual instruction bytes are readonly.
  record.instruction.bytes[0] = 0;
}

export function checkOutcomes(record: Cpu6502StepRecord): readonly number[] {
  switch (record.outcome) {
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

export function checkRecordConstruction(cpu: Cpu6502): readonly Cpu6502StepRecord[] {
  const common = {
    before: cpu.snapshot(), after: cpu.snapshot(), accesses: [],
    instruction: { address: 0, bytes: [0xa9, 2] },
  };
  // @ts-expect-error Every attempted instruction carries an instruction record.
  const invalidExecuted: Cpu6502StepRecord = { ...common, outcome: "executed", instruction: null };
  // @ts-expect-error Unsupported records must carry a reason.
  const missingReason: Cpu6502StepRecord = { ...common, outcome: "unsupported" };
  // @ts-expect-error Executed records have no unsupported reason.
  const extraReason: Cpu6502StepRecord = { ...common, outcome: "executed", reason: "opcode" };
  // @ts-expect-error The CPU does not report lesson completion or a halt outcome.
  const invalidOutcome: Cpu6502StepRecord = { ...common, outcome: "halted" };
  // @ts-expect-error Decimal arithmetic is supported, not an unsupported outcome.
  const invalidReason: Cpu6502StepRecord = { ...common, outcome: "unsupported", reason: "decimal-mode" };

  return [
    { ...common, outcome: "executed" },
    { ...common, outcome: "unsupported", reason: "opcode" },
  ];
}

export function checkResetTypes(cpu: Cpu6502): Cpu6502ResetRecord {
  const record = cpu.reset();
  // @ts-expect-error Reset snapshots cannot be replaced.
  record.before = cpu.snapshot();
  // @ts-expect-error The after snapshot cannot be replaced either.
  record.after = cpu.snapshot();
  // @ts-expect-error Registers in reset snapshots are readonly.
  record.before.sp = 0;
  // @ts-expect-error Nested reset flags are readonly.
  record.after.flags.d = true;
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
  const step: Cpu6502StepRecord = record;
  return record;
}

export function checkInterruptTypes(cpu: Cpu6502, record: Cpu6502InterruptRecord): void {
  const irq: Cpu6502InterruptRecord = cpu.interrupt("irq");
  const nmi: Cpu6502InterruptRecord = cpu.interrupt("nmi");
  // @ts-expect-error BRK is an instruction, not an external interrupt source.
  cpu.interrupt("brk");
  // @ts-expect-error The request source is explicit.
  cpu.interrupt();
  // @ts-expect-error Vector entry accepts a source, never an acknowledgement callback.
  cpu.interrupt(() => 0);
  // @ts-expect-error The 6502 has no port access records.
  const port: Cpu6502InterruptRecord["accesses"][number] = { kind: "port-read", port: 0, value: 0 };
  const instruction: null = record.instruction;
  if (record.outcome === "ignored") {
    const source: "irq" = record.source;
    const reason: "masked" = record.reason;
  } else {
    const source: "irq" | "nmi" = record.source;
    // @ts-expect-error Accepted entries have no rejection reason.
    record.reason;
  }
  // @ts-expect-error External entry does not execute an opcode.
  const step: Cpu6502StepRecord = record;
  // @ts-expect-error Record fields and snapshots are readonly.
  record.after.pc = 0;
  // @ts-expect-error Nested flags remain readonly.
  record.before.flags.i = false;
  // @ts-expect-error Interrupt accesses remain readonly.
  record.accesses.push({ kind: "write", address: 0x100, value: 0 });
  // @ts-expect-error Source and outcome are readonly.
  record.source = "irq";
  if (record.accesses[0]) {
    // @ts-expect-error Access entries remain readonly.
    record.accesses[0].address = 0;
  }
  // @ts-expect-error An ignored record can only name IRQ.
  const ignoredNmi: Cpu6502InterruptRecord = { ...record, source: "nmi", outcome: "ignored", reason: "masked" };
}
