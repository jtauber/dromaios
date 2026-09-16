import { cpu6809StateDescription } from "../../state/6809.ts";
import { addWrap, borrow, capture, concat, cpuSymbols, fetchByte, literal, negative, overflow, readMemory, readRegister, updateFlags, value, writeRegister, xor } from "../model.ts";
import type { Flag, FlagPolicy, InstructionDefinition, ValueSource, Width } from "../model.ts";
import { compare, immediateByte, negativeZeroPolicy, shift } from "../builders.ts";
import { defineInstruction } from "../validate.ts";

const cpu = cpuSymbols("6809", cpu6809StateDescription);

const xPostincrement: ValueSource = {
  name: "word at old X, advance X by two", width: 16,
  steps: [
    readRegister("address", cpu.register("x")),
    writeRegister(cpu.register("x"), addWrap(value("address"), literal(16, 2))),
    readMemory("high", value("address")),
    readMemory("low", addWrap(value("address"), literal(16, 1))),
  ], result: concat(value("high"), value("low")),
};

const immediateWord: ValueSource = {
  name: "immediate word, high byte first", width: 16, steps: [
    fetchByte("high"), fetchByte("low"),
  ], result: concat(value("high"), value("low")),
};
function memoryWord(mode: "direct" | "extended"): ValueSource {
  const direct = mode === "direct";
  return { name: direct ? "direct word through DP" : "extended word", width: 16, steps: [
    ...(direct ? [
      fetchByte("addressLow"),
      readRegister("addressHigh", cpu.register("dp")),
    ] : [
      fetchByte("addressHigh"), fetchByte("addressLow"),
    ]),
    capture("address", concat(value("addressHigh"), value("addressLow"))),
    readMemory("high", value("address")),
    readMemory("low", addWrap(value("address"), literal(16, 1))),
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

function registerShifts(name: string, direction: "left" | "right", incoming: "zero" | "sign" | Flag = "zero") {
  const operation = shift(direction, incoming);
  const nz = negativeZeroPolicy(`6809 ${name}`, cpu.flag("n"), cpu.flag("z"), 8);
  const policy: FlagPolicy = {
    ...nz, parameters: { original: 8, result: 8 },
    updates: [
      ...nz.updates,
      { flag: cpu.flag("c"), value: operation.carry },
      ...(direction === "left" ? [{ flag: cpu.flag("v"), value: xor(negative(value("result")), operation.carry) }] : []),
    ],
  };
  return Object.fromEntries((["a", "b"] as const).map(register => [`${name.toLowerCase()}${register.toUpperCase()}`, defineInstruction({
    cpu: cpu.declaration, name: `${name}${register.toUpperCase()}`,
    explanation: `Capture ${register.toUpperCase()} and shift ${direction}, inserting `
      + (incoming === "zero" ? "zero" : incoming === "sign" ? "the original sign bit" : "the captured incoming C")
      + ". Update N/Z/C before writing the register. "
      + (direction === "left" ? "Replace V with N XOR C. " : "Preserve V. ")
      + "Preserve E/F/H/I; no data-memory access occurs.",
    steps: [
      readRegister("original", cpu.register(register)), ...operation.steps,
      updateFlags(policy, { original: value("original"), result: value("result") }),
      writeRegister(cpu.register(register), value("result")),
    ],
  })]));
}

export const instructions6809 = {
  // 010 r oooo: r selects A/B; oooo=0100/0110/0111/1000/1001 selects LSR/ROR/ASR/ASL/ROL.
  ...registerShifts("LSR", "right"), ...registerShifts("ROR", "right", cpu.flag("c")),
  ...registerShifts("ASR", "right", "sign"),
  ...registerShifts("ASL", "left"), ...registerShifts("ROL", "left", cpu.flag("c")),
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
