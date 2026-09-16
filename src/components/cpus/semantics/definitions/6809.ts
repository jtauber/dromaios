import { cpu6809StateDescription } from "../../state/6809.ts";
import { addWrap, borrow, capture, concat, cpuSymbols, fetchByte, flagLiteral, literal, negative, overflow, readMemory, readRegister, subtract, updateFlags, value, writeMemory, writeRegister, xor, zero } from "../model.ts";
import type { Flag, FlagPolicy, InstructionDefinition, NumberExpression, Statement, ValueSource, Width } from "../model.ts";
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

// Every unary form reads once, applies its flags, then optionally writes. Even CLR reads memory; TST never writes.
function unary(name: string, calculation: NumberExpression | readonly Statement[], updates: FlagPolicy["updates"], explanation: string, writeBack = true) {
  const nz = negativeZeroPolicy(`6809 ${name}`, cpu.flag("n"), cpu.flag("z"), 8);
  const policy: FlagPolicy = { ...nz, parameters: { original: 8, result: 8 }, updates: [...nz.updates, ...updates] };
  return Object.fromEntries((["a", "b", "memory"] as const).map(target => {
    const memory = target === "memory", suffix = memory ? "Memory" : target.toUpperCase();
    return [`${name.toLowerCase()}${suffix}`, defineInstruction({
      cpu: cpu.declaration, name: memory ? `${name} memory` : `${name}${suffix}`,
      ...(memory ? { inputs: { address: 16 as const } } : {}),
      explanation: (memory ? "Entry is after successful direct/indexed/extended address resolution. Read the byte at that captured address. "
        : `Capture ${suffix}. `) + explanation + " Apply the declared flags, preserving E/F/H/I. "
        + (writeBack ? "Then write the result once, even if unchanged. " : "Do not write a result. ")
        + (memory ? "A failed read preserves flags and completed addressing effects."
          + (writeBack ? " A failed write retains their updates and completed addressing effects." : "")
          : "No data-memory access occurs."),
      steps: [
        memory ? readMemory("original", value("address")) : readRegister("original", cpu.register(target)),
        ...("kind" in calculation ? [capture("result", calculation)] : calculation),
        updateFlags(policy, { original: value("original"), result: value("result") }),
        ...(writeBack ? [memory ? writeMemory(value("address"), value("result")) : writeRegister(cpu.register(target), value("result"))] : []),
      ],
    })];
  }));
}

function shifts(name: string, direction: "left" | "right", incoming: "zero" | "sign" | Flag = "zero") {
  const operation = shift(direction, incoming);
  return unary(name, operation.steps, [
    { flag: cpu.flag("c"), value: operation.carry },
    ...(direction === "left" ? [{ flag: cpu.flag("v"), value: xor(negative(value("result")), operation.carry) }] : []),
  ], `Shift ${direction}, inserting `
    + (incoming === "zero" ? "zero" : incoming === "sign" ? "the original sign bit" : "the captured incoming C")
    + ". Set C from the outgoing bit. " + (direction === "left" ? "Set V to N XOR C." : "Preserve V."));
}

export const instructions6809 = {
  // 010r oooo selects A/B; 0000/0110/0111 oooo selects direct/indexed/extended memory.
  // The CPU table maps oooo to these operations; each policy applies to every target.
  ...unary("NEG", subtract(literal(8, 0), value("original")), [
    { flag: cpu.flag("v"), value: overflow(literal(8, 0), value("original")) },
    { flag: cpu.flag("c"), value: borrow(literal(8, 0), value("original")) },
  ], "Negate the byte modulo 256. V marks original 80; C marks a nonzero original."),
  ...unary("COM", subtract(literal(8, 0xff), value("original")), [
    { flag: cpu.flag("v"), value: flagLiteral(false) }, { flag: cpu.flag("c"), value: flagLiteral(true) },
  ], "Take the byte's ones' complement: FF minus the original. Clear V and set C."),
  ...shifts("LSR", "right"), ...shifts("ROR", "right", cpu.flag("c")),
  ...shifts("ASR", "right", "sign"),
  ...shifts("ASL", "left"), ...shifts("ROL", "left", cpu.flag("c")),
  ...unary("DEC", subtract(value("original"), literal(8, 1)), [
    { flag: cpu.flag("v"), value: zero(subtract(value("original"), literal(8, 0x80))) },
  ], "Decrement modulo 256. V marks original 80; preserve C."),
  ...unary("INC", addWrap(value("original"), literal(8, 1)), [
    { flag: cpu.flag("v"), value: zero(subtract(value("original"), literal(8, 0x7f))) },
  ], "Increment modulo 256. V marks original 7F; preserve C."),
  ...unary("TST", value("original"), [{ flag: cpu.flag("v"), value: flagLiteral(false) }], "Test the original byte, clearing V and preserving C.", false),
  ...unary("CLR", literal(8, 0), [
    { flag: cpu.flag("c"), value: flagLiteral(false) }, { flag: cpu.flag("v"), value: flagLiteral(false) },
  ], "Clear the byte. Set Z; clear N/C/V. The original read still occurs."),
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
