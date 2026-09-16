import { cpu6502StateDescription } from "../6502.ts";
import { cpu8080StateDescription } from "../8080.ts";
import { cpu6809StateDescription } from "../6809.ts";
import { addWrap, borrow, concat, cpuSymbols, evenParity, extend, halfBorrow, literal, negative, not, overflow, subtract, value, zero } from "./model.ts";
import type { Flag, FlagPolicy, Register, Statement, ValueSource, Width } from "./model.ts";
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

/** Review samples, not replacement CPU implementations or a complete addressing-mode inventory. */
export const instructionExamples = Object.freeze([
  ...(["a", "x", "y"] as const).flatMap(register => [immediate, absolute6502].map(source => defineInstruction({
    cpu: mos.declaration, name: `${{ a: "CMP", x: "CPX", y: "CPY" }[register]} ${source === immediate ? "#byte" : "absolute"}`,
    explanation: "Read the source before the comparison register. Subtract without writing a destination. C "
      + "means no borrow; V, D, and I are preserved. Decimal mode does not change comparison.",
    steps: compare(mos.register(register), source, mosCompare),
  }))),
  ...([ ["CPI byte", immediate], ["CMP B", fromRegister(intel.register("b"))], ["CMP M", throughHL] ] as const)
    .map(([name, source]) => defineInstruction({
      cpu: intel.declaration, name,
      explanation: "Retain A. S/Z describe the byte result, P its even parity, CY the borrow, and AC the "
        + "inverse borrow at the low-nibble boundary. This definition omits the current "
        + "implementation's redundant assignment of A to itself.",
      steps: compare(intel.register("a"), source, intelCompare),
    })),
  ...(["a", "b"] as const).map(register => defineInstruction({
    cpu: motorola.declaration, name: `CMP${register.toUpperCase()} #byte`,
    explanation: "Apply N/Z/V/C from byte subtraction and preserve H and control flags. C means borrow; the "
      + "compared register is retained.",
    steps: compare(motorola.register(register), immediate, motorolaCompare(8)),
  })),
  defineInstruction({
    cpu: motorola.declaration, name: "CMPX ,X++",
    explanation: "Entry is after the opcode and postbyte 81 have selected this form. Capture old X, "
      + "increment stored X, then read both source bytes high first. Only then capture X for "
      + "comparison. If either memory read fails, the increment survives and comparison flags "
      + "remain unchanged. Other postbytes are outside this sample.",
    steps: compare(motorola.register("x"), xPostincrement, motorolaCompare(16)),
  }),
  defineInstruction({
    cpu: mos.declaration, name: "TAX",
    explanation: "Capture A, write X, then apply N/Z. Other flags are preserved. The captured byte remains "
      + "stable even though the destination changes.",
    steps: [
      { kind: "read-register", name: "byte", register: mos.register("a") },
      { kind: "write-register", register: mos.register("x"), value: value("byte") },
      { kind: "update-flags", policy: mosNZ, arguments: { result: value("byte") } },
    ],
  }),
  defineInstruction({
    cpu: intel.declaration, name: "MOV B,A",
    explanation: "Capture A and write B. No flag-update statement occurs, so every flag is preserved.",
    steps: [
      { kind: "read-register", name: "byte", register: intel.register("a") },
      { kind: "write-register", register: intel.register("b"), value: value("byte") },
    ],
  }),
  defineInstruction({
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
]);
