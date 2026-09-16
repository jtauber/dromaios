import { cpu6809StateDescription } from "../../state/6809.ts";
import { addWrap, borrow, concat, cpuSymbols, literal, overflow, value } from "../model.ts";
import type { FlagPolicy, InstructionDefinition, Statement, ValueSource, Width } from "../model.ts";
import { compare, immediateByte, negativeZeroPolicy } from "../builders.ts";
import { defineInstruction } from "../validate.ts";

const cpu = cpuSymbols("6809", cpu6809StateDescription);

const xPostincrement: ValueSource = {
  name: "word at old X, advance X by two", width: 16,
  steps: [
    { kind: "read-register", name: "address", register: cpu.register("x") },
    { kind: "write-register", register: cpu.register("x"), value: addWrap(value("address"), literal(16, 2)) },
    { kind: "read-memory", name: "high", address: value("address") },
    { kind: "read-memory", name: "low", address: addWrap(value("address"), literal(16, 1)) },
  ], result: concat(value("high"), value("low")),
};

const immediateWord: ValueSource = {
  name: "immediate word, high byte first", width: 16, steps: [
    { kind: "fetch-byte", name: "high" }, { kind: "fetch-byte", name: "low" },
  ], result: concat(value("high"), value("low")),
};
function memoryWord(mode: "direct" | "extended"): ValueSource {
  const direct = mode === "direct";
  return { name: direct ? "direct word through DP" : "extended word", width: 16, steps: [
    ...(direct ? [
      { kind: "fetch-byte", name: "addressLow" },
      { kind: "read-register", name: "addressHigh", register: cpu.register("dp") },
    ] satisfies Statement[] : [
      { kind: "fetch-byte", name: "addressHigh" }, { kind: "fetch-byte", name: "addressLow" },
    ] satisfies Statement[]),
    { kind: "capture", name: "address", value: concat(value("addressHigh"), value("addressLow")) },
    { kind: "read-memory", name: "high", address: value("address") },
    { kind: "read-memory", name: "low", address: addWrap(value("address"), literal(16, 1)) },
  ], result: concat(value("high"), value("low")) };
}

function comparisonFlags(width: Width): FlagPolicy {
  const resultFlags = negativeZeroPolicy("6809 comparison", cpu.flag("n"), cpu.flag("z"), width);
  return { ...resultFlags, parameters: { left: width, right: width, result: width }, updates: [
    ...resultFlags.updates,
    { flag: cpu.flag("v"), value: overflow(value("left"), value("right")) },
    { flag: cpu.flag("c"), value: borrow(value("left"), value("right")) },
  ] };
}

function comparison(register: "a" | "b" | "x", source: ValueSource, operand: string): InstructionDefinition {
  return defineInstruction({
    cpu: cpu.declaration, name: `CMP${register.toUpperCase()} ${operand}`,
    explanation: "Read the source before the comparison register. Apply N/Z/V/C from subtraction, retaining "
      + "the compared register and preserving H and control flags. C means borrow.",
    steps: compare(cpu.register(register), source, comparisonFlags(source.width)),
  });
}

export const instructions6809 = {
  cmpaImmediate: comparison("a", immediateByte, "#byte"),
  cmpbImmediate: comparison("b", immediateByte, "#byte"),
  cmpxImmediate: comparison("x", immediateWord, "#word"),
  cmpxDirect: comparison("x", memoryWord("direct"), "direct"),
  cmpxExtended: comparison("x", memoryWord("extended"), "extended"),
  cmpxPostincrement: defineInstruction({
    cpu: cpu.declaration, name: "CMPX ,X++",
    explanation: "Entry is after the opcode and postbyte 81 have selected this form. Capture old X, "
      + "increment stored X, then read both source bytes high first. Only then capture X for "
      + "comparison. If either memory read fails, the increment survives and comparison flags "
      + "remain unchanged. Other postbytes are outside this sample.",
    steps: compare(cpu.register("x"), xPostincrement, comparisonFlags(16)),
  }),
};
