import { cpu6502StateDescription } from "../state/6502.ts";
import { cpu8080StateDescription } from "../state/8080.ts";
import { cpu6809StateDescription } from "../state/6809.ts";
import { addWrap, borrow, concat, cpuSymbols, evenParity, extend, halfBorrow, literal, negative, not, overflow, subtract, value, zero } from "./model.ts";
import type { Flag, FlagPolicy, InstructionDefinition, Register, Statement, ValueSource, Width } from "./model.ts";
import { defineInstruction } from "./validate.ts";

const mos = cpuSymbols("6502", cpu6502StateDescription);
const intel = cpuSymbols("8080", cpu8080StateDescription);
const motorola = cpuSymbols("6809", cpu6809StateDescription);

// Every source owns its captures. Only the yielded value enters the caller's scope.
const immediate: ValueSource = {
  name: "immediate byte", width: 8,
  steps: [{ kind: "fetch-byte", name: "byte" }], result: value("byte"),
};
function fromRegister(register: Register): ValueSource {
  return { name: `register ${register.field.toUpperCase()}`, width: register.width,
    steps: [{ kind: "read-register", name: "byte", register }], result: value("byte") };
}
const absolute6502: ValueSource = {
  name: "absolute byte, low address byte first", width: 8,
  steps: [
    { kind: "fetch-byte", name: "low" },
    { kind: "fetch-byte", name: "high" },
    { kind: "read-memory", name: "byte", address: concat(value("high"), value("low")) },
  ], result: value("byte"),
};
const throughHL: ValueSource = {
  name: "memory through HL", width: 8,
  steps: [
    { kind: "read-register", name: "high", register: intel.register("h") },
    { kind: "read-register", name: "low", register: intel.register("l") },
    { kind: "read-memory", name: "byte", address: concat(value("high"), value("low")) },
  ], result: value("byte"),
};
const xPostincrement: ValueSource = {
  name: "word at old X, advance X by two", width: 16,
  steps: [
    { kind: "read-register", name: "address", register: motorola.register("x") },
    { kind: "write-register", register: motorola.register("x"), value: addWrap(value("address"), literal(16, 2)) },
    { kind: "read-memory", name: "high", address: value("address") },
    { kind: "read-memory", name: "low", address: addWrap(value("address"), literal(16, 1)) },
  ], result: concat(value("high"), value("low")),
};

// The additional 6502 sources keep the whole comparison family on one semantic definition.
function zeroPage6502(index?: "x"): ValueSource {
  return { name: index ? "zero page indexed by X" : "zero page", width: 8, steps: [
    { kind: "fetch-byte", name: "offset" },
    ...(index ? [
      { kind: "read-register", name: "index", register: mos.register("x") },
      { kind: "capture", name: "address", value: extend(addWrap(value("offset"), value("index")), 16) },
    ] satisfies Statement[] : [{ kind: "capture", name: "address", value: extend(value("offset"), 16) }] satisfies Statement[]),
    { kind: "read-memory", name: "byte", address: value("address") },
  ], result: value("byte") };
}
function absoluteIndexed6502(register: "x" | "y"): ValueSource {
  return { name: `absolute indexed by ${register.toUpperCase()}`, width: 8, steps: [
    { kind: "fetch-byte", name: "low" }, { kind: "fetch-byte", name: "high" },
    { kind: "read-register", name: "index", register: mos.register(register) },
    { kind: "read-memory", name: "byte", address: addWrap(concat(value("high"), value("low")), extend(value("index"), 16)) },
  ], result: value("byte") };
}
function indirect6502(mode: "indexed-indirect" | "indirect-indexed"): ValueSource {
  const indexFirst = mode === "indexed-indirect";
  return { name: indexFirst ? "indexed indirect (zero page,X)" : "indirect indexed (zero page),Y", width: 8, steps: [
    { kind: "fetch-byte", name: "offset" },
    ...(indexFirst ? [
      { kind: "read-register", name: "index", register: mos.register("x") },
      { kind: "capture", name: "pointer", value: addWrap(value("offset"), value("index")) },
    ] satisfies Statement[] : [{ kind: "capture", name: "pointer", value: value("offset") }] satisfies Statement[]),
    { kind: "read-memory", name: "low", address: extend(value("pointer"), 16) },
    { kind: "read-memory", name: "high", address: extend(addWrap(value("pointer"), literal(8, 1)), 16) },
    { kind: "capture", name: "base", value: concat(value("high"), value("low")) },
    ...(!indexFirst ? [{ kind: "read-register", name: "index", register: mos.register("y") }] satisfies Statement[] : []),
    { kind: "read-memory", name: "byte", address: indexFirst ? value("base") : addWrap(value("base"), extend(value("index"), 16)) },
  ], result: value("byte") };
}
const immediateWord6809: ValueSource = {
  name: "immediate word, high byte first", width: 16, steps: [
    { kind: "fetch-byte", name: "high" }, { kind: "fetch-byte", name: "low" },
  ], result: concat(value("high"), value("low")),
};
function memoryWord6809(mode: "direct" | "extended"): ValueSource {
  const direct = mode === "direct";
  return { name: direct ? "direct word through DP" : "extended word", width: 16, steps: [
    ...(direct ? [
      { kind: "fetch-byte", name: "addressLow" },
      { kind: "read-register", name: "addressHigh", register: motorola.register("dp") },
    ] satisfies Statement[] : [
      { kind: "fetch-byte", name: "addressHigh" }, { kind: "fetch-byte", name: "addressLow" },
    ] satisfies Statement[]),
    { kind: "capture", name: "address", value: concat(value("addressHigh"), value("addressLow")) },
    { kind: "read-memory", name: "high", address: value("address") },
    { kind: "read-memory", name: "low", address: addWrap(value("address"), literal(16, 1)) },
  ], result: concat(value("high"), value("low")) };
}

function nz(name: string, n: Flag, z: Flag, width: Width): FlagPolicy {
  return { name, parameters: { result: width }, unlisted: "preserve", updates: [
    { flag: n, value: negative(value("result")) }, { flag: z, value: zero(value("result")) },
  ] };
}
const mosNZ = nz("6502 result N/Z", mos.flag("n"), mos.flag("z"), 8);
const mosCompare: FlagPolicy = {
  ...mosNZ, name: "6502 comparison", parameters: { left: 8, right: 8, result: 8 },
  updates: [...mosNZ.updates, { flag: mos.flag("c"), value: not(borrow(value("left"), value("right"))) }],
};
const intelCompare: FlagPolicy = {
  name: "8080 comparison", parameters: { left: 8, right: 8, result: 8 }, unlisted: "preserve",
  updates: [
    { flag: intel.flag("s"), value: negative(value("result")) },
    { flag: intel.flag("z"), value: zero(value("result")) },
    { flag: intel.flag("p"), value: evenParity(value("result")) },
    { flag: intel.flag("cy"), value: borrow(value("left"), value("right")) },
    { flag: intel.flag("ac"), value: not(halfBorrow(value("left"), value("right"))) },
  ],
};
function motorolaCompare(width: Width): FlagPolicy {
  const resultFlags = nz("6809 comparison", motorola.flag("n"), motorola.flag("z"), width);
  return { ...resultFlags, parameters: { left: width, right: width, result: width }, updates: [
    ...resultFlags.updates,
    { flag: motorola.flag("v"), value: overflow(value("left"), value("right")) },
    { flag: motorola.flag("c"), value: borrow(value("left"), value("right")) },
  ] };
}

/** Construction-time sharing: all source effects finish before the comparison register is read. */
function compare(register: Register, source: ValueSource, policy: FlagPolicy): readonly Statement[] {
  return [
    { kind: "read-source", name: "right", source },
    { kind: "read-register", name: "left", register },
    { kind: "capture", name: "result", value: subtract(value("left"), value("right")) },
    { kind: "update-flags", policy, arguments: { left: value("left"), right: value("right"), result: value("result") } },
  ]; // Deliberately no destination write, including a write of the original register value.
}

function mosComparison(register: "a" | "x" | "y", source: ValueSource, operand: string): InstructionDefinition {
  return defineInstruction({
    cpu: mos.declaration, name: `${{ a: "CMP", x: "CPX", y: "CPY" }[register]} ${operand}`,
    explanation: "Read the source before the comparison register. Subtract without writing a destination. C "
      + "means no borrow; V, D, and I are preserved. Decimal mode does not change comparison.",
    steps: compare(mos.register(register), source, mosCompare),
  });
}
function intelComparison(source: ValueSource, name: string): InstructionDefinition {
  return defineInstruction({
    cpu: intel.declaration, name,
    explanation: "Retain A without a destination write. S/Z describe the byte result, P its even parity, "
      + "CY the borrow, and AC the inverse borrow at the low-nibble boundary.",
    steps: compare(intel.register("a"), source, intelCompare),
  });
}
function motorolaComparison(register: "a" | "b" | "x", source: ValueSource, operand: string): InstructionDefinition {
  return defineInstruction({
    cpu: motorola.declaration, name: `CMP${register.toUpperCase()} ${operand}`,
    explanation: "Read the source before the comparison register. Apply N/Z/V/C from subtraction, retaining "
      + "the compared register and preserving H and control flags. C means borrow.",
    steps: compare(motorola.register(register), source, motorolaCompare(source.width)),
  });
}
// Stable names bind generated methods to opcode tables; these descriptions contain no callbacks.
export const instructions6502 = {
  cmpImmediate: mosComparison("a", immediate, "#byte"),
  cmpAbsolute: mosComparison("a", absolute6502, "absolute"),
  cpxImmediate: mosComparison("x", immediate, "#byte"),
  cpxAbsolute: mosComparison("x", absolute6502, "absolute"),
  cpyImmediate: mosComparison("y", immediate, "#byte"),
  cpyAbsolute: mosComparison("y", absolute6502, "absolute"),
  cmpZeroPage: mosComparison("a", zeroPage6502(), "zero page"),
  cpxZeroPage: mosComparison("x", zeroPage6502(), "zero page"),
  cpyZeroPage: mosComparison("y", zeroPage6502(), "zero page"),
  cmpZeroPageX: mosComparison("a", zeroPage6502("x"), "zero page,X"),
  cmpAbsoluteX: mosComparison("a", absoluteIndexed6502("x"), "absolute,X"),
  cmpAbsoluteY: mosComparison("a", absoluteIndexed6502("y"), "absolute,Y"),
  cmpIndexedIndirect: mosComparison("a", indirect6502("indexed-indirect"), "(zero page,X)"),
  cmpIndirectIndexed: mosComparison("a", indirect6502("indirect-indexed"), "(zero page),Y"),
  tax: defineInstruction({
    cpu: mos.declaration, name: "TAX",
    explanation: "Capture A, write X, then apply N/Z. Other flags are preserved. The captured byte remains "
      + "stable even though the destination changes.",
    steps: [
      { kind: "read-register", name: "byte", register: mos.register("a") },
      { kind: "write-register", register: mos.register("x"), value: value("byte") },
      { kind: "update-flags", policy: mosNZ, arguments: { result: value("byte") } },
    ],
  }),
  aslZeroPage: defineInstruction({
    cpu: mos.declaration, name: "ASL zero page",
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
        updates: [{ flag: mos.flag("c"), value: negative(value("original")) }],
      }, arguments: { original: value("original") } },
      { kind: "write-memory", address: value("address"), value: value("result") },
      { kind: "update-flags", policy: mosNZ, arguments: { result: value("result") } },
    ],
  }),
};

export const instructions8080 = {
  cpi: intelComparison(immediate, "CPI byte"),
  cmpB: intelComparison(fromRegister(intel.register("b")), "CMP B"),
  cmpC: intelComparison(fromRegister(intel.register("c")), "CMP C"),
  cmpD: intelComparison(fromRegister(intel.register("d")), "CMP D"),
  cmpE: intelComparison(fromRegister(intel.register("e")), "CMP E"),
  cmpH: intelComparison(fromRegister(intel.register("h")), "CMP H"),
  cmpL: intelComparison(fromRegister(intel.register("l")), "CMP L"),
  cmpM: intelComparison(throughHL, "CMP M"),
  cmpA: intelComparison(fromRegister(intel.register("a")), "CMP A"),
  movBA: defineInstruction({
    cpu: intel.declaration, name: "MOV B,A",
    explanation: "Capture A and write B. No flag-update statement occurs, so every flag is preserved.",
    steps: [
      { kind: "read-register", name: "byte", register: intel.register("a") },
      { kind: "write-register", register: intel.register("b"), value: value("byte") },
    ],
  }),
};

export const instructions6809 = {
  cmpaImmediate: motorolaComparison("a", immediate, "#byte"),
  cmpbImmediate: motorolaComparison("b", immediate, "#byte"),
  cmpxImmediate: motorolaComparison("x", immediateWord6809, "#word"),
  cmpxDirect: motorolaComparison("x", memoryWord6809("direct"), "direct"),
  cmpxExtended: motorolaComparison("x", memoryWord6809("extended"), "extended"),
  cmpxPostincrement: defineInstruction({
    cpu: motorola.declaration, name: "CMPX ,X++",
    explanation: "Entry is after the opcode and postbyte 81 have selected this form. Capture old X, "
      + "increment stored X, then read both source bytes high first. Only then capture X for "
      + "comparison. If either memory read fails, the increment survives and comparison flags "
      + "remain unchanged. Other postbytes are outside this sample.",
    steps: compare(motorola.register("x"), xPostincrement, motorolaCompare(16)),
  }),
};

export const instructionExamples = Object.freeze([
  ...Object.values(instructions6502), ...Object.values(instructions8080), ...Object.values(instructions6809),
]);
