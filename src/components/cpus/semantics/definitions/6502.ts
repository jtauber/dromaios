import { cpu6502StateDescription } from "../../state/6502.ts";
import { opcodeFamily, opcodePattern } from "../../opcodes.ts";
import { addWrap, borrow, capture, concat, cpuSymbols, extend, fetchByte, literal, negative, not,
  readMemory, readRegister, updateFlags, value, writeMemory } from "../model.ts";
import type { FlagPolicy, InstructionDefinition, ValueSource } from "../model.ts";
import { compare, immediateByte, instructionSet, negativeZeroPolicy, registerSource, transfer } from "../builders.ts";
import { defineInstruction } from "../validate.ts";

const cpu = cpuSymbols("6502", cpu6502StateDescription);
type Operand = readonly [name: string, source: ValueSource];

// Operand sources include every read in order; comparison and load bodies share them.
const absolute: ValueSource = {
  name: "absolute byte, low address byte first", width: 8, steps: [
    fetchByte("low"), fetchByte("high"),
    readMemory("byte", concat(value("high"), value("low"))),
  ], result: value("byte"),
};
function zeroPage(index?: "x" | "y"): ValueSource {
  return { name: index ? `zero page indexed by ${index.toUpperCase()}` : "zero page", width: 8, steps: [
    fetchByte("offset"),
    ...(index ? [
      readRegister("index", cpu.register(index)),
      capture("address", extend(addWrap(value("offset"), value("index")), 16)),
    ] : [capture("address", extend(value("offset"), 16))]),
    readMemory("byte", value("address")),
  ], result: value("byte") };
}
function absoluteIndexed(register: "x" | "y"): ValueSource {
  return { name: `absolute indexed by ${register.toUpperCase()}`, width: 8, steps: [
    fetchByte("low"), fetchByte("high"),
    readRegister("index", cpu.register(register)),
    readMemory("byte", addWrap(concat(value("high"), value("low")), extend(value("index"), 16))),
  ], result: value("byte") };
}
function indirect(mode: "indexed-indirect" | "indirect-indexed"): ValueSource {
  const indexFirst = mode === "indexed-indirect";
  return { name: indexFirst ? "indexed indirect (zero page,X)" : "indirect indexed (zero page),Y", width: 8, steps: [
    fetchByte("offset"),
    ...(indexFirst ? [
      readRegister("index", cpu.register("x")),
      capture("pointer", addWrap(value("offset"), value("index"))),
    ] : [capture("pointer", value("offset"))]),
    readMemory("low", extend(value("pointer"), 16)),
    readMemory("high", extend(addWrap(value("pointer"), literal(8, 1)), 16)),
    capture("base", concat(value("high"), value("low"))),
    ...(!indexFirst ? [readRegister("index", cpu.register("y"))] : []),
    readMemory("byte", indexFirst ? value("base") : addWrap(value("base"), extend(value("index"), 16))),
  ], result: value("byte") };
}

const resultNZ = negativeZeroPolicy("6502 result N/Z", cpu.flag("n"), cpu.flag("z"), 8);
const comparisonFlags: FlagPolicy = {
  ...resultNZ, name: "6502 comparison", parameters: { left: 8, right: 8, result: 8 },
  updates: [...resultNZ.updates, { flag: cpu.flag("c"), value: not(borrow(value("left"), value("right"))) }],
};

function comparison(register: "a" | "x" | "y", [operand, source]: Operand): InstructionDefinition {
  return defineInstruction({
    cpu: cpu.declaration, name: `${{ a: "CMP", x: "CPX", y: "CPY" }[register]} ${operand}`,
    explanation: "Read the source before the comparison register. Subtract without writing a destination. C "
      + "means no borrow; V, D, and I are preserved. Decimal mode does not change comparison.",
    steps: compare(cpu.register(register), source, comparisonFlags),
  });
}
function load(register: "a" | "x" | "y", [operand, source]: Operand): InstructionDefinition {
  return defineInstruction({
    cpu: cpu.declaration, name: `LD${register.toUpperCase()} ${operand}`,
    explanation: "Finish the source reads before writing the destination, then set N/Z from the captured byte. "
      + "Preserve V, D, I, and C. A failed source read leaves the destination and every flag unchanged.",
    steps: transfer(cpu.register(register), source, resultNZ),
  });
}
function registerTransfer(name: string, from: "a" | "x" | "y" | "sp", to: "a" | "x" | "y" | "sp", policy?: FlagPolicy): InstructionDefinition {
  return defineInstruction({
    cpu: cpu.declaration, name,
    explanation: `Capture ${from.toUpperCase()} and write ${to.toUpperCase()}. `
      + (policy === undefined ? "Preserve every flag." : `Then apply ${policy.name}, preserving unlisted flags.`)
      + " No data memory or stack access occurs, including transfers involving SP.",
    steps: transfer(cpu.register(to), registerSource(cpu.register(from)), policy),
  });
}

// aaa bbb cc: cc=01 selects accumulator operations; aaa=101/110 selects LDA/CMP.
// bbb selects the source below, in numeric order. Both families use this same list.
const accumulatorOperands: readonly Operand[] = [
  ["(zero page,X)", indirect("indexed-indirect")], ["zero page", zeroPage()],
  ["#byte", immediateByte], ["absolute", absolute],
  ["(zero page),Y", indirect("indirect-indexed")], ["zero page,X", zeroPage("x")],
  ["absolute,Y", absoluteIndexed("y")], ["absolute,X", absoluteIndexed("x")],
];
const indexRegisters = ["y", "x"] as const;
const otherIndex = { x: "y", y: "x" } as const;

// These patterns generate both instruction bodies and their execution bindings.
export const instructions6502 = instructionSet([
  ...opcodeFamily("101 bbb 01", { b: accumulatorOperands }, ({ b }) => load("a", b)),
  ...opcodeFamily("110 bbb 01", { b: accumulatorOperands }, ({ b }) => comparison("a", b)),
  // 11r bbb 00: r selects Y/X; bbb=000/001/011 selects immediate/zero page/absolute.
  ...opcodeFamily("11r 000 00", { r: indexRegisters }, ({ r }) => comparison(r, ["#byte", immediateByte])),
  ...opcodeFamily("11r 001 00", { r: indexRegisters }, ({ r }) => comparison(r, ["zero page", zeroPage()])),
  ...opcodeFamily("11r 011 00", { r: indexRegisters }, ({ r }) => comparison(r, ["absolute", absolute])),
  // 101 bbb r0: r selects Y/X; indexed loads use the OTHER register as the index.
  ...opcodeFamily("101 000 r0", { r: indexRegisters }, ({ r }) => load(r, ["#byte", immediateByte])),
  ...opcodeFamily("101 001 r0", { r: indexRegisters }, ({ r }) => load(r, ["zero page", zeroPage()])),
  ...opcodeFamily("101 011 r0", { r: indexRegisters }, ({ r }) => load(r, ["absolute", absolute])),
  ...opcodeFamily("101 101 r0", { r: indexRegisters }, ({ r }) => load(r, [`zero page,${otherIndex[r].toUpperCase()}`, zeroPage(otherIndex[r])])),
  ...opcodeFamily("101 111 r0", { r: indexRegisters }, ({ r }) => load(r, [`absolute,${otherIndex[r].toUpperCase()}`, absoluteIndexed(otherIndex[r])])),
  // Register transfers occupy bbb=010/110; TXS alone preserves every flag.
  ...opcodePattern("101 010 00", registerTransfer("TAY", "a", "y", resultNZ)),
  ...opcodePattern("100 110 00", registerTransfer("TYA", "y", "a", resultNZ)),
  ...opcodePattern("100 010 10", registerTransfer("TXA", "x", "a", resultNZ)),
  ...opcodePattern("101 010 10", registerTransfer("TAX", "a", "x", resultNZ)),
  ...opcodePattern("100 110 10", registerTransfer("TXS", "x", "sp")),
  ...opcodePattern("101 110 10", registerTransfer("TSX", "sp", "x", resultNZ)),
  // 0ss bbb 10: ss=00 selects ASL; bbb=001 selects zero page.
  ...opcodePattern("000 001 10", defineInstruction({
    cpu: cpu.declaration, name: "ASL zero page",
    explanation: "Resolve the address once. Read the original byte and write it back unchanged. Then compute "
      + "the shifted byte and apply C before the final write; N/Z follow only after that write "
      + "succeeds. A failed original write leaves flags unchanged; a failed final write retains the "
      + "new C and old N/Z. These are the existing model's host-error boundaries, not a cycle-level "
      + "hardware claim.",
    steps: [
      fetchByte("offset"),
      capture("address", extend(value("offset"), 16)),
      readMemory("original", value("address")),
      writeMemory(value("address"), value("original")),
      capture("result", addWrap(value("original"), value("original"))),
      updateFlags({ name: "6502 ASL carry", parameters: { original: 8 }, unlisted: "preserve",
        updates: [{ flag: cpu.flag("c"), value: negative(value("original")) }],
      }, { original: value("original") }),
      writeMemory(value("address"), value("result")),
      updateFlags(resultNZ, { result: value("result") }),
    ],
  })),
]);
