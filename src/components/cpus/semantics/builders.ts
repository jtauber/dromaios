import { addWrap, borrow, capture, concat, fetchByte, flagLiteral, flagValue, highByte, lowByte, lowBit, negative, not, readFlag, readMemory, readRegister, readSource,
  shiftLeft, shiftRight, subtract, updateFlags, value, writeMemory, writeRegister, zero } from "./model.ts";
import type { AddressExpression, Flag, FlagExpression, FlagPolicy, NumberExpression, Register, Statement, ValueSource, Width } from "./model.ts";
import type { CpuDeclaration, InstructionDefinition } from "./model.ts";
import { opcodeTable } from "../opcodes.ts";
import type { OpcodeEntry } from "../opcodes.ts";

/** Stored accumulator and flags required by shared arithmetic/status construction. */
export interface AccumulatorCpu { readonly declaration: CpuDeclaration; register(field: "a"): Register; flag(field: string): Flag }

/** Check encoding collisions before making the generator's inventory of defined entries. */
export function instructionSet(entries: readonly OpcodeEntry<InstructionDefinition>[], width: 8 | 16 = 8): Readonly<Record<string, InstructionDefinition>> {
  opcodeTable(entries, width);
  return Object.freeze(Object.fromEntries(entries));
}

/** Encoding forms with the same body key share one definition, built from their first occurrence. */
export function instructionBodies<Form extends { readonly body: string }>(forms: readonly Form[], define: (form: Form) => InstructionDefinition): Readonly<Record<string, InstructionDefinition>> {
  const bodies = new Map<string, InstructionDefinition>();
  for (const form of forms) if (!bodies.has(form.body)) bodies.set(form.body, define(form));
  return Object.freeze(Object.fromEntries(bodies));
}

/** Unsigned comparison expressed through the existing subtraction-borrow fact. */
export const atLeast = (left: NumberExpression, right: NumberExpression): FlagExpression => not(borrow(left, right));

// Construction-time recipes return inspectable data; none reads live CPU state.
// Every source owns its captures. Only the yielded value enters the caller's scope.
export const immediateByte: ValueSource = {
  name: "immediate byte", width: 8,
  steps: [fetchByte("byte")], result: value("byte"),
};

export function registerSource(register: Register): ValueSource {
  return { name: `register ${register.bank === undefined ? "" : register.bank.toUpperCase() + "."}${register.field.toUpperCase()}`, width: register.width,
    steps: [readRegister("contents", register)], result: value("contents") };
}

/** Construction-time read/write view. Only its expanded sources and statements enter definitions. */
export interface RegisterView {
  readonly source: ValueSource;
  /** Give each write a distinct capture name when multiple byte views share a statement scope. */
  readonly write: (contents: NumberExpression, captureName?: string) => readonly Statement[];
}

export function registerView(register: Register, afterWrite: readonly Statement[] = []): RegisterView {
  return { source: registerSource(register), write: contents => [writeRegister(register, contents), ...afterWrite] };
}

/** A byte view of a stored word; capture the retained half at writeback, not at the earlier operand read. */
export function byteRegisterView(register: Register, half: "low" | "high"): RegisterView {
  if (register.width !== 16) throw new Error("A byte register view requires a stored word.");
  return {
    source: { name: `${half} byte of ${registerSource(register).name}`, width: 8,
      steps: [readRegister("word", register)], result: (half === "low" ? lowByte : highByte)(value("word")) },
    write: (contents, captureName = "preservedWord") => [readRegister(captureName, register), writeRegister(register, half === "low"
      ? concat(highByte(value(captureName)), contents) : concat(contents, lowByte(value(captureName))))],
  };
}

/** Resolve an address once, then read its byte. Stores and modifiers can use the address source alone. */
export function memorySource(address: ValueSource): ValueSource {
  return { name: `byte at ${address.name}`, width: 8,
    steps: [readSource("address", address), readMemory("byte", value("address"))], result: value("byte") };
}

/** Read in the supplied address order; return the complete word from the two captured bytes. */
export function readWord(order: "low-first" | "high-first", first: AddressExpression, second: AddressExpression, low = "low", high = "high") {
  const names = order === "low-first" ? [low, high] as const : [high, low] as const;
  return { steps: [readMemory(names[0], first), readMemory(names[1], second)], result: concat(value(high), value(low)) };
}

/** Split a captured word into two ordered writes. Address wrapping/projection belongs to the caller. */
export function writeWord(order: "low-first" | "high-first", first: AddressExpression, second: AddressExpression, contents: NumberExpression): readonly Statement[] {
  const bytes = order === "low-first" ? [lowByte, highByte] as const : [highByte, lowByte] as const;
  return [writeMemory(first, bytes[0](contents)), writeMemory(second, bytes[1](contents))];
}

export function negativeZeroPolicy(name: string, n: Flag, z: Flag, width: Width): FlagPolicy {
  return { name, parameters: { result: width }, unlisted: "preserve", updates: [
    { flag: n, value: negative(value("result")) }, { flag: z, value: zero(value("result")) },
  ] };
}

export type ShiftInput = "zero" | "sign" | "outgoing" | Flag | FlagExpression;

/** Consume "original", capture "result", and describe outgoing carry. The caller schedules flags and writeback. */
export function shift(direction: "left" | "right", incoming: ShiftInput = "zero") {
  const original = value("original"), carry = direction === "left" ? negative(original) : lowBit(original);
  const bit = typeof incoming === "string"
    ? { zero: flagLiteral(false), sign: negative(original), outgoing: carry }[incoming] : incoming.kind === "flag" ? flagValue("carry") : incoming;
  return { carry, steps: [
    ...(typeof incoming !== "string" && incoming.kind === "flag" ? [readFlag("carry", incoming)] : []),
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
