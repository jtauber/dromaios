import { addWrap, capture, fetchByte, flagLiteral, flagValue, lowBit, negative, readFlag, readMemory, readRegister, readSource,
  shiftLeft, shiftRight, subtract, updateFlags, value, writeRegister, zero } from "./model.ts";
import type { Flag, FlagExpression, FlagPolicy, NumberExpression, Register, Statement, ValueSource, Width } from "./model.ts";
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

/** Resolve an address once, then read its byte. Stores and modifiers can use the address source alone. */
export function memorySource(address: ValueSource): ValueSource {
  return { name: `byte at ${address.name}`, width: 8,
    steps: [readSource("address", address), readMemory("byte", value("address"))], result: value("byte") };
}

export function negativeZeroPolicy(name: string, n: Flag, z: Flag, width: Width): FlagPolicy {
  return { name, parameters: { result: width }, unlisted: "preserve", updates: [
    { flag: n, value: negative(value("result")) }, { flag: z, value: zero(value("result")) },
  ] };
}

export type ShiftInput = "zero" | "sign" | "outgoing" | Flag;

/** Consume "original", capture "result", and describe outgoing carry. The caller schedules flags and writeback. */
export function shift(direction: "left" | "right", incoming: ShiftInput = "zero") {
  const original = value("original"), carry = direction === "left" ? negative(original) : lowBit(original);
  const bit = typeof incoming === "string"
    ? { zero: flagLiteral(false), sign: negative(original), outgoing: carry }[incoming] : flagValue("carry");
  return { carry, steps: [
    ...(typeof incoming === "string" ? [] : [readFlag("carry", incoming)]),
    capture("result", (direction === "left" ? shiftLeft : shiftRight)(original, bit)),
  ] };
}

/** Capture the right source or expression before reading the left register or view; never write it back. */
export function compare(left: Register | ValueSource, right: ValueSource | NumberExpression, policy: FlagPolicy): readonly Statement[] {
  return [
    "kind" in right ? capture("right", right) : readSource("right", right),
    "kind" in left ? readRegister("left", left) : readSource("left", left),
    capture("result", subtract(value("left"), value("right"))),
    updateFlags(policy, { left: value("left"), right: value("right"), result: value("result") }),
  ];
}

/** Capture "result" once, write the register or explicit destination steps, then optionally apply flags. */
export function transfer(destination: Register | readonly Statement[], source: ValueSource | NumberExpression, policy?: FlagPolicy): readonly Statement[] {
  const steps: Statement[] = [
    "kind" in source ? capture("result", source) : readSource("result", source),
    ...("kind" in destination ? [writeRegister(destination, value("result"))] : destination),
  ];
  if (policy !== undefined) steps.push(updateFlags(policy, { result: value("result") }));
  return steps;
}

/** Read the operand before the accumulator; optionally write the result, then apply its flag policy. */
export function logical(register: Register, source: ValueSource | NumberExpression,
  operation: (left: NumberExpression, right: NumberExpression) => NumberExpression, policy: FlagPolicy, writeBack = true): readonly Statement[] {
  return [
    "kind" in source ? capture("operand", source) : readSource("operand", source),
    readRegister("accumulator", register), capture("result", operation(value("accumulator"), value("operand"))),
    ...(writeBack ? [writeRegister(register, value("result"))] : []),
    updateFlags(policy, { result: value("result") }),
  ];
}

/** Consume captured left/right and optional carry, then compute the result and flags. Reads and writeback are separate. */
export function arithmetic(operation: "add" | "subtract", policy: FlagPolicy, incoming?: FlagExpression): readonly Statement[] {
  const left = value("left"), right = value("right");
  return [
    capture("result", (operation === "add" ? addWrap : subtract)(left, right, incoming)),
    updateFlags(policy, { left, right, result: value("result"), ...(incoming === undefined ? {} : { carry: incoming }) }),
  ];
}
