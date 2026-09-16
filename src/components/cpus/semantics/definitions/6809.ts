import { cpu6809StateDescription } from "../../state/6809.ts";
import { addWrap, borrow, concat, cpuSymbols, fetchByte, literal, overflow, readMemory, readRegister, value } from "../model.ts";
import type { FlagPolicy, InstructionDefinition, ValueSource, Width } from "../model.ts";
import { compare, immediateByte, negativeZeroPolicy } from "../builders.ts";
import { motorolaUnary } from "../motorola.ts";
import { defineInstruction } from "../validate.ts";

const cpu = cpuSymbols("6809", cpu6809StateDescription);

// D is a view, not an extra stored register. Read A then B only when comparison reaches its left operand.
const d: ValueSource = {
  name: "D from A:B", width: 16,
  steps: [readRegister("high", cpu.register("a")), readRegister("low", cpu.register("b"))],
  result: concat(value("high"), value("low")),
};

const immediateWord: ValueSource = {
  name: "immediate word, high byte first", width: 16, steps: [
    fetchByte("high"), fetchByte("low"),
  ], result: concat(value("high"), value("low")),
};

function comparisonFlags(width: Width): FlagPolicy {
  const resultFlags = negativeZeroPolicy("6809 comparison", cpu.flag("n"), cpu.flag("z"), width);
  return { ...resultFlags, parameters: { left: width, right: width, result: width }, updates: [
    ...resultFlags.updates,
    { flag: cpu.flag("v"), value: overflow(value("left"), value("right")) },
    { flag: cpu.flag("c"), value: borrow(value("left"), value("right")) },
  ] };
}

function comparison(register: "a" | "b" | "d" | "x" | "y" | "u" | "s", mode: "Immediate" | "Memory"): InstructionDefinition {
  const left = register === "d" ? d : cpu.register(register), word = left.width === 16, memory = mode === "Memory";
  const reads = word ? [readMemory("high", value("address")), readMemory("low", addWrap(value("address"), literal(16, 1)))]
    : [readMemory("byte", value("address"))];
  const right = memory ? (word ? concat(value("high"), value("low")) : value("byte")) : (word ? immediateWord : immediateByte);
  return defineInstruction({
    cpu: cpu.declaration, name: `CMP${register.toUpperCase()} ${memory ? "memory" : word ? "#word" : "#byte"}`,
    ...(memory ? { inputs: { address: 16 as const } } : {}),
    explanation: (memory ? "Entry is after successful direct/indexed/extended address resolution. Read the operand at that captured address. "
      : "Fetch the immediate operand. ") + (word ? "Read high byte then low byte, wrapping at FFFF. " : "")
      + "Only then read the comparison register" + (register === "d" ? " as A followed by B" : "") + ". "
      + "Apply N/Z/V/C from subtraction without writing a result, preserving H and control flags. C means borrow. "
      + "A failed read leaves flags unchanged; completed fetches and addressing effects remain.",
    steps: [...(memory ? reads : []), ...compare(left, right, comparisonFlags(left.width))],
  });
}

export const instructions6809 = {
  ...motorolaUnary(cpu, { clearReadsOperand: true, testClearsCarry: false, rightShiftSetsOverflow: false }),
  // Each memory body serves all three address modes; opcode pages and patterns remain in the CPU.
  ...Object.fromEntries((["a", "b", "d", "x", "y", "u", "s"] as const).flatMap(register =>
    (["Immediate", "Memory"] as const).map(mode => [`cmp${register}${mode}`, comparison(register, mode)]))),
};
