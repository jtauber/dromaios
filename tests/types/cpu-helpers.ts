import { flagRegister } from "../../src/components/cpus/flags.js";
import type { InstructionStep, HaltedStep } from "../../src/components/cpus/execution-records.js";
import type { ReadonlyState } from "../../src/components/cpus/state.js";

// Compiled, never called: helper abstractions preserve concrete names and recursive readonly state.
export function checkCpuHelpers(record: InstructionStep<{ readonly pc: number }> | HaltedStep<{ readonly pc: number }>): void {
  const flags = flagRegister({ n: 7, z: 6, c: 0 });
  const decoded = flags.decode(0xff);
  const negative: boolean = decoded.n;
  // @ts-expect-error Decoding preserves declared names; it does not invent flags.
  decoded.v;
  // @ts-expect-error Every declared flag is required when encoding.
  flags.encode({ n: true, z: false });
  const state: ReadonlyState<{ registers: [number, number]; alternate: { flags: { c: boolean } } }> = {
    registers: [0, 1], alternate: { flags: { c: false } },
  };
  const count: 2 = state.registers.length;
  // @ts-expect-error Nested flags remain readonly.
  state.alternate.flags.c = true;
  // @ts-expect-error Register tuples remain readonly.
  state.registers[0] = 2;
  if (record.outcome !== "halted") {
    const address: number = record.instruction.address;
    // @ts-expect-error Instruction bytes remain readonly.
    record.instruction.bytes.push(0);
  }
  if (record.outcome === "unsupported") { const reason: "opcode" = record.reason; }
}
