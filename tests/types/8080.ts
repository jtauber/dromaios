import type { Cpu8080, Cpu8080StepRecord } from "../../src/components/cpus/8080.js";

// Compiled by npm test; never called. Each expected error guards the public API.
export function checkPublicTypes(cpu: Cpu8080, record: Cpu8080StepRecord): void {
  const snapshot = cpu.snapshot();
  // @ts-expect-error Snapshot registers are readonly.
  snapshot.a = 1;
  // @ts-expect-error The snapshot's flags object cannot be replaced.
  snapshot.flags = { s: false, z: false, ac: false, p: false, cy: false };
  // @ts-expect-error Nested snapshot flags are readonly too.
  snapshot.flags.cy = true;

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

export function checkOutcomes(record: Cpu8080StepRecord): readonly number[] {
  switch (record.outcome) {
    case "executed":
    case "unsupported":
      // Checking the outcome is enough to know an instruction exists.
      return record.instruction.bytes;
    case "halted":
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
  const invalidUnsupported: Cpu8080StepRecord = { ...common, outcome: "unsupported", instruction: null };

  // HLT carries an instruction; a call while already halted does not.
  return [
    { ...common, outcome: "halted", instruction: { address: 0, bytes: [0x76] } },
    { ...common, outcome: "halted", instruction: null },
  ];
}
