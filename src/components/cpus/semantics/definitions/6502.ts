import { cpu6502StateDescription } from "../../state/6502.ts";
import { addWrap, borrow, concat, cpuSymbols, extend, literal, negative, not, value } from "../model.ts";
import type { FlagPolicy, InstructionDefinition, Statement, ValueSource } from "../model.ts";
import { compare, immediateByte, negativeZeroPolicy, registerSource, transfer } from "../builders.ts";
import { defineInstruction } from "../validate.ts";

const cpu = cpuSymbols("6502", cpu6502StateDescription);

// Operand sources include every read in order; comparison and load bodies share them.
const absolute: ValueSource = {
  name: "absolute byte, low address byte first", width: 8,
  steps: [
    { kind: "fetch-byte", name: "low" },
    { kind: "fetch-byte", name: "high" },
    { kind: "read-memory", name: "byte", address: concat(value("high"), value("low")) },
  ], result: value("byte"),
};

function zeroPage(index?: "x" | "y"): ValueSource {
  return { name: index ? `zero page indexed by ${index.toUpperCase()}` : "zero page", width: 8, steps: [
    { kind: "fetch-byte", name: "offset" },
    ...(index ? [
      { kind: "read-register", name: "index", register: cpu.register(index) },
      { kind: "capture", name: "address", value: extend(addWrap(value("offset"), value("index")), 16) },
    ] satisfies Statement[] : [{ kind: "capture", name: "address", value: extend(value("offset"), 16) }] satisfies Statement[]),
    { kind: "read-memory", name: "byte", address: value("address") },
  ], result: value("byte") };
}
function absoluteIndexed(register: "x" | "y"): ValueSource {
  return { name: `absolute indexed by ${register.toUpperCase()}`, width: 8, steps: [
    { kind: "fetch-byte", name: "low" }, { kind: "fetch-byte", name: "high" },
    { kind: "read-register", name: "index", register: cpu.register(register) },
    { kind: "read-memory", name: "byte", address: addWrap(concat(value("high"), value("low")), extend(value("index"), 16)) },
  ], result: value("byte") };
}
function indirect(mode: "indexed-indirect" | "indirect-indexed"): ValueSource {
  const indexFirst = mode === "indexed-indirect";
  return { name: indexFirst ? "indexed indirect (zero page,X)" : "indirect indexed (zero page),Y", width: 8, steps: [
    { kind: "fetch-byte", name: "offset" },
    ...(indexFirst ? [
      { kind: "read-register", name: "index", register: cpu.register("x") },
      { kind: "capture", name: "pointer", value: addWrap(value("offset"), value("index")) },
    ] satisfies Statement[] : [{ kind: "capture", name: "pointer", value: value("offset") }] satisfies Statement[]),
    { kind: "read-memory", name: "low", address: extend(value("pointer"), 16) },
    { kind: "read-memory", name: "high", address: extend(addWrap(value("pointer"), literal(8, 1)), 16) },
    { kind: "capture", name: "base", value: concat(value("high"), value("low")) },
    ...(!indexFirst ? [{ kind: "read-register", name: "index", register: cpu.register("y") }] satisfies Statement[] : []),
    { kind: "read-memory", name: "byte", address: indexFirst ? value("base") : addWrap(value("base"), extend(value("index"), 16)) },
  ], result: value("byte") };
}

const sources = {
  immediate: immediateByte,
  zeroPage: zeroPage(), zeroPageX: zeroPage("x"), zeroPageY: zeroPage("y"),
  absolute, absoluteX: absoluteIndexed("x"), absoluteY: absoluteIndexed("y"),
  indexedIndirect: indirect("indexed-indirect"), indirectIndexed: indirect("indirect-indexed"),
};

const resultNZ = negativeZeroPolicy("6502 result N/Z", cpu.flag("n"), cpu.flag("z"), 8);
const comparisonFlags: FlagPolicy = {
  ...resultNZ, name: "6502 comparison", parameters: { left: 8, right: 8, result: 8 },
  updates: [...resultNZ.updates, { flag: cpu.flag("c"), value: not(borrow(value("left"), value("right"))) }],
};

function comparison(register: "a" | "x" | "y", source: ValueSource, operand: string): InstructionDefinition {
  return defineInstruction({
    cpu: cpu.declaration, name: `${{ a: "CMP", x: "CPX", y: "CPY" }[register]} ${operand}`,
    explanation: "Read the source before the comparison register. Subtract without writing a destination. C "
      + "means no borrow; V, D, and I are preserved. Decimal mode does not change comparison.",
    steps: compare(cpu.register(register), source, comparisonFlags),
  });
}

function load(register: "a" | "x" | "y", source: ValueSource, operand: string): InstructionDefinition {
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

// Stable names bind generated methods to opcode tables; these descriptions contain no callbacks.
export const instructions6502 = {
  cmpImmediate: comparison("a", sources.immediate, "#byte"),
  cmpAbsolute: comparison("a", sources.absolute, "absolute"),
  cpxImmediate: comparison("x", sources.immediate, "#byte"),
  cpxAbsolute: comparison("x", sources.absolute, "absolute"),
  cpyImmediate: comparison("y", sources.immediate, "#byte"),
  cpyAbsolute: comparison("y", sources.absolute, "absolute"),
  cmpZeroPage: comparison("a", sources.zeroPage, "zero page"),
  cpxZeroPage: comparison("x", sources.zeroPage, "zero page"),
  cpyZeroPage: comparison("y", sources.zeroPage, "zero page"),
  cmpZeroPageX: comparison("a", sources.zeroPageX, "zero page,X"),
  cmpAbsoluteX: comparison("a", sources.absoluteX, "absolute,X"),
  cmpAbsoluteY: comparison("a", sources.absoluteY, "absolute,Y"),
  cmpIndexedIndirect: comparison("a", sources.indexedIndirect, "(zero page,X)"),
  cmpIndirectIndexed: comparison("a", sources.indirectIndexed, "(zero page),Y"),

  ldaImmediate: load("a", sources.immediate, "#byte"),
  ldaZeroPage: load("a", sources.zeroPage, "zero page"),
  ldaZeroPageX: load("a", sources.zeroPageX, "zero page,X"),
  ldaAbsolute: load("a", sources.absolute, "absolute"),
  ldaAbsoluteX: load("a", sources.absoluteX, "absolute,X"),
  ldaAbsoluteY: load("a", sources.absoluteY, "absolute,Y"),
  ldaIndexedIndirect: load("a", sources.indexedIndirect, "(zero page,X)"),
  ldaIndirectIndexed: load("a", sources.indirectIndexed, "(zero page),Y"),
  ldxImmediate: load("x", sources.immediate, "#byte"),
  ldxZeroPage: load("x", sources.zeroPage, "zero page"),
  ldxZeroPageY: load("x", sources.zeroPageY, "zero page,Y"),
  ldxAbsolute: load("x", sources.absolute, "absolute"),
  ldxAbsoluteY: load("x", sources.absoluteY, "absolute,Y"),
  ldyImmediate: load("y", sources.immediate, "#byte"),
  ldyZeroPage: load("y", sources.zeroPage, "zero page"),
  ldyZeroPageX: load("y", sources.zeroPageX, "zero page,X"),
  ldyAbsolute: load("y", sources.absolute, "absolute"),
  ldyAbsoluteX: load("y", sources.absoluteX, "absolute,X"),

  tax: registerTransfer("TAX", "a", "x", resultNZ),
  tay: registerTransfer("TAY", "a", "y", resultNZ),
  txa: registerTransfer("TXA", "x", "a", resultNZ),
  tya: registerTransfer("TYA", "y", "a", resultNZ),
  tsx: registerTransfer("TSX", "sp", "x", resultNZ),
  txs: registerTransfer("TXS", "x", "sp"), // No flag policy: preserve every flag.

  aslZeroPage: defineInstruction({
    cpu: cpu.declaration, name: "ASL zero page",
    explanation: "Resolve the address once. Read the original byte and write it back unchanged. Then compute "
      + "the shifted byte and apply C before the final write; N/Z follow only after that write "
      + "succeeds. A failed original write leaves flags unchanged; a failed final write retains the "
      + "new C and old N/Z. These are the existing model's host-error boundaries, not a cycle-level "
      + "hardware claim.",
    steps: [
      { kind: "fetch-byte", name: "offset" },
      { kind: "capture", name: "address", value: extend(value("offset"), 16) },
      { kind: "read-memory", name: "original", address: value("address") },
      { kind: "write-memory", address: value("address"), value: value("original") },
      { kind: "capture", name: "result", value: addWrap(value("original"), value("original")) },
      { kind: "update-flags", policy: {
        name: "6502 ASL carry", parameters: { original: 8 }, unlisted: "preserve",
        updates: [{ flag: cpu.flag("c"), value: negative(value("original")) }],
      }, arguments: { original: value("original") } },
      { kind: "write-memory", address: value("address"), value: value("result") },
      { kind: "update-flags", policy: resultNZ, arguments: { result: value("result") } },
    ],
  }),
};
