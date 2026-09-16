import { capture, fetchByte, negative, readRegister, readSource, subtract, updateFlags, value, writeRegister, zero } from "./model.ts";
import type { Flag, FlagPolicy, Register, Statement, ValueSource, Width } from "./model.ts";
import type { InstructionDefinition } from "./model.ts";
import { opcodeTable } from "../opcodes.ts";
import type { OpcodeEntry } from "../opcodes.ts";

/** Check encoding collisions before making the generator's inventory of defined entries. */
export function instructionSet(entries: readonly OpcodeEntry<InstructionDefinition>[]): Readonly<Record<string, InstructionDefinition>> {
  opcodeTable(entries);
  return Object.freeze(Object.fromEntries(entries));
}

// Construction-time recipes return inspectable data; none reads live CPU state.
// Every source owns its captures. Only the yielded value enters the caller's scope.
export const immediateByte: ValueSource = {
  name: "immediate byte", width: 8,
  steps: [fetchByte("byte")], result: value("byte"),
};

export function registerSource(register: Register): ValueSource {
  return { name: `register ${register.field.toUpperCase()}`, width: register.width,
    steps: [readRegister("contents", register)], result: value("contents") };
}

export function negativeZeroPolicy(name: string, n: Flag, z: Flag, width: Width): FlagPolicy {
  return { name, parameters: { result: width }, unlisted: "preserve", updates: [
    { flag: n, value: negative(value("result")) }, { flag: z, value: zero(value("result")) },
  ] };
}

/** Finish all source effects before capturing the comparison register; never write it back. */
export function compare(register: Register, source: ValueSource, policy: FlagPolicy): readonly Statement[] {
  return [
    readSource("right", source),
    readRegister("left", register),
    capture("result", subtract(value("left"), value("right"))),
    updateFlags(policy, { left: value("left"), right: value("right"), result: value("result") }),
  ];
}

/** Capture the source once, write the destination, then optionally apply a policy parameterized by result. */
export function transfer(destination: Register, source: ValueSource, policy?: FlagPolicy): readonly Statement[] {
  const steps: Statement[] = [
    readSource("result", source),
    writeRegister(destination, value("result")),
  ];
  if (policy !== undefined) steps.push(updateFlags(policy, { result: value("result") }));
  return steps;
}
