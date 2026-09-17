import { cpu6502StateDescription } from "../../state/6502.ts";
import { opcodeFamily, opcodePattern } from "../../opcodes.ts";
import { addWrap, bitAnd, bitOr, bitXor, borrow, capture, concat, cpuSymbols, extend, fetchByte, literal, negative, not,
  readMemory, readRegister, readSource, subtract, updateFlags, value, writeMemory, writeRegister, zero } from "../model.ts";
import type { FlagPolicy, InstructionDefinition, Register, SourceDefinitions, Statement, ValueSource } from "../model.ts";
import { compare, immediateByte, instructionSet, memorySource, negativeZeroPolicy, registerSource, shift, transfer } from "../builders.ts";
import { defineInstruction } from "../validate.ts";

const cpu = cpuSymbols("6502", cpu6502StateDescription);
type Operand = readonly [name: string, source: ValueSource];

// Address sources stop before the final data read; stores and modifiers use them directly.
function absolute(index?: "x" | "y"): ValueSource {
  return { name: index ? `absolute indexed by ${index.toUpperCase()}` : "absolute address, low byte first", width: 16, steps: [
    fetchByte("low"), fetchByte("high"),
    ...(index ? [readRegister("index", cpu.register(index))] : []),
  ], result: index ? addWrap(concat(value("high"), value("low")), extend(value("index"), 16)) : concat(value("high"), value("low")) };
}
function zeroPage(index?: "x" | "y"): ValueSource {
  return { name: index ? `zero page indexed by ${index.toUpperCase()}` : "zero page", width: 16, steps: [
    fetchByte("offset"),
    ...(index ? [readRegister("index", cpu.register(index))] : []),
  ], result: extend(index ? addWrap(value("offset"), value("index")) : value("offset"), 16) };
}
function indirect(mode: "indexed-indirect" | "indirect-indexed"): ValueSource {
  const indexFirst = mode === "indexed-indirect";
  return { name: indexFirst ? "indexed indirect (zero page,X)" : "indirect indexed (zero page),Y", width: 16, steps: [
    fetchByte("offset"),
    ...(indexFirst ? [
      readRegister("index", cpu.register("x")),
      capture("pointer", addWrap(value("offset"), value("index"))),
    ] : [capture("pointer", value("offset"))]),
    readMemory("low", extend(value("pointer"), 16)),
    readMemory("high", extend(addWrap(value("pointer"), literal(8, 1)), 16)),
    capture("base", concat(value("high"), value("low"))),
    ...(!indexFirst ? [readRegister("index", cpu.register("y"))] : []),
  ], result: indexFirst ? value("base") : addWrap(value("base"), extend(value("index"), 16)) };
}

const addresses = {
  zeroPage: zeroPage(), zeroPageX: zeroPage("x"), zeroPageY: zeroPage("y"),
  absolute: absolute(), absoluteX: absolute("x"), absoluteY: absolute("y"),
  indexedIndirect: indirect("indexed-indirect"), indirectIndexed: indirect("indirect-indexed"),
};

const resultNZ = negativeZeroPolicy("6502 result N/Z", cpu.flag("n"), cpu.flag("z"), 8);
const comparisonFlags: FlagPolicy = {
  ...resultNZ, name: "6502 comparison", parameters: { left: 8, right: 8, result: 8 },
  updates: [...resultNZ.updates, { flag: cpu.flag("c"), value: not(borrow(value("left"), value("right"))) }],
};
const bitFlags: FlagPolicy = {
  name: "6502 BIT", parameters: { accumulator: 8, operand: 8 }, unlisted: "preserve", updates: [
    { flag: cpu.flag("n"), value: negative(value("operand")) },
    { flag: cpu.flag("v"), value: not(zero(bitAnd(value("operand"), literal(8, 0x40)))) },
    { flag: cpu.flag("z"), value: zero(bitAnd(value("accumulator"), value("operand"))) },
  ],
};
const logicalOperations = { ORA: bitOr, AND: bitAnd, EOR: bitXor };

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
function store(register: "a" | "x" | "y", [operand, address]: Operand): InstructionDefinition {
  return defineInstruction({
    cpu: cpu.declaration, name: `ST${register.toUpperCase()} ${operand}`,
    explanation: "Resolve the address once, including any pointer reads, before capturing the source register. "
      + "Write that byte once, even if unchanged, without reading the destination. Preserve every flag. "
      + "A failed access prevents later effects; completed fetches and pointer reads remain.",
    steps: [readSource("address", address), readRegister("byte", cpu.register(register)), writeMemory(value("address"), value("byte"))],
  });
}
function logic(name: keyof typeof logicalOperations, [operand, source]: Operand): InstructionDefinition {
  return defineInstruction({
    cpu: cpu.declaration, name: `${name} ${operand}`,
    explanation: "Finish the operand reads before capturing A, then combine the captured bytes. Write A before setting N/Z. "
      + "Preserve V, D, I, and C; decimal mode has no effect. A failed read leaves A and every flag unchanged.",
    steps: [readSource("operand", source), readRegister("accumulator", cpu.register("a")),
      capture("result", logicalOperations[name](value("accumulator"), value("operand"))),
      writeRegister(cpu.register("a"), value("result")), updateFlags(resultNZ, { result: value("result") })],
  });
}
function testBits([operand, source]: Operand): InstructionDefinition {
  return defineInstruction({
    cpu: cpu.declaration, name: `BIT ${operand}`,
    explanation: "Read memory before capturing A. Copy N/V from memory bits 7/6; set Z from A AND memory. "
      + "Preserve A, C, D, and I. Decimal mode has no effect. A failed read leaves every flag unchanged.",
    steps: [readSource("operand", source), readRegister("accumulator", cpu.register("a")),
      updateFlags(bitFlags, { accumulator: value("accumulator"), operand: value("operand") })],
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

// A byte operation consumes "original" and captures "result"; its flag stages stay in place.
function shiftOperation(name: string, direction: "left" | "right", rotate = false) {
  const operation = shift(direction, rotate ? cpu.flag("c") : "zero");
  return { name, steps: [
    ...operation.steps,
    updateFlags({ name: `6502 ${name} carry`, parameters: { original: 8 }, unlisted: "preserve",
      updates: [{ flag: cpu.flag("c"), value: operation.carry }],
    }, { original: value("original") }),
  ] };
}
function updateByte(name: string, target: Register | ValueSource, operation: readonly Statement[]): InstructionDefinition {
  const register = "kind" in target;
  return defineInstruction({
    cpu: cpu.declaration, name,
    explanation: (register ? `Read ${target.field.toUpperCase()} before the operation. `
      : "Resolve the address once, read the original byte, and write it back unchanged before the operation. ")
      + "Perform the calculation and its flag updates, then write the result and apply N/Z. "
      + "Rotates read incoming C at the calculation stage. A failed access prevents all later effects; "
      + "a failed result write retains any carry update but leaves N/Z unchanged. Preserve unlisted flags.",
    steps: [
      ...(register ? [readRegister("original", target)] : [
        readSource("address", target), readMemory("original", value("address")), writeMemory(value("address"), value("original")),
      ]),
      ...operation,
      register ? writeRegister(target, value("result")) : writeMemory(value("address"), value("result")),
      updateFlags(resultNZ, { result: value("result") }),
    ],
  });
}

// aaa bbb cc: cc=01, aaa selects ORA/AND/EOR/ADC/STA/LDA/CMP/SBC; bbb selects addressing in numeric order.
// bbb=010 has no address: reads fetch an immediate byte, while STA omits that encoding.
const accumulatorAddresses: readonly (Operand | undefined)[] = [
  ["(zero page,X)", addresses.indexedIndirect], ["zero page", addresses.zeroPage],
  undefined, ["absolute", addresses.absolute],
  ["(zero page),Y", addresses.indirectIndexed], ["zero page,X", addresses.zeroPageX],
  ["absolute,Y", addresses.absoluteY], ["absolute,X", addresses.absoluteX],
];
const accumulatorOperands = accumulatorAddresses.map((operand): Operand => operand === undefined
  ? ["#byte", immediateByte] : [operand[0], memorySource(operand[1])]);
// The same bbb source inventory serves generated bodies and the remaining handwritten ALU.
export const sources6502 = { cpu: cpu.declaration, groups: {
  addresses, operands: Object.fromEntries(accumulatorOperands.map(([, source], code) => [code, source])),
} } satisfies SourceDefinitions;
const indexRegisters = ["y", "x"] as const;
const otherIndex = { x: "y", y: "x" } as const;
// 0ss bbb 10: ss selects ASL/ROL/LSR/ROR. 11i bbb 10: i selects DEC/INC.
const shifts = [shiftOperation("ASL", "left"), shiftOperation("ROL", "left", true), shiftOperation("LSR", "right"), shiftOperation("ROR", "right", true)];
const adjustments = [
  { name: "DEC", steps: [capture("result", subtract(value("original"), literal(8, 1)))] },
  { name: "INC", steps: [capture("result", addWrap(value("original"), literal(8, 1)))] },
];
// bbb=mm1: mm (bits 4..3) selects zp/absolute/zp,X/absolute,X in numeric order.
const modifyOperands: readonly Operand[] = [
  ["zero page", addresses.zeroPage], ["absolute", addresses.absolute],
  ["zero page,X", addresses.zeroPageX], ["absolute,X", addresses.absoluteX],
];

// These patterns generate both instruction bodies and their execution bindings.
export const instructions6502 = instructionSet([
  ...opcodeFamily("000 bbb 01", { b: accumulatorOperands }, ({ b }) => logic("ORA", b)),
  ...opcodeFamily("001 bbb 01", { b: accumulatorOperands }, ({ b }) => logic("AND", b)),
  ...opcodeFamily("010 bbb 01", { b: accumulatorOperands }, ({ b }) => logic("EOR", b)),
  ...opcodeFamily("100 bbb 01", { b: accumulatorAddresses }, ({ b }) => b)
    .flatMap(([opcode, address]) => address === undefined ? [] : [[opcode, store("a", address)] as const]),
  ...opcodeFamily("101 bbb 01", { b: accumulatorOperands }, ({ b }) => load("a", b)),
  ...opcodeFamily("110 bbb 01", { b: accumulatorOperands }, ({ b }) => comparison("a", b)),
  // cc=00, aaa=001 selects BIT; bbb=001/011 selects zero page/absolute. No immediate or indexed form.
  ...opcodeFamily("001 0b1 00", { b: [["zero page", memorySource(addresses.zeroPage)], ["absolute", memorySource(addresses.absolute)]] }, ({ b }) => testBits(b)),
  // 11r bbb 00: r selects Y/X; bbb=000/001/011 selects immediate/zero page/absolute.
  ...opcodeFamily("11r 000 00", { r: indexRegisters }, ({ r }) => comparison(r, ["#byte", immediateByte])),
  ...opcodeFamily("11r 001 00", { r: indexRegisters }, ({ r }) => comparison(r, ["zero page", memorySource(addresses.zeroPage)])),
  ...opcodeFamily("11r 011 00", { r: indexRegisters }, ({ r }) => comparison(r, ["absolute", memorySource(addresses.absolute)])),
  // 101 bbb r0: r selects Y/X; indexed loads use the OTHER register as the index.
  ...opcodeFamily("101 000 r0", { r: indexRegisters }, ({ r }) => load(r, ["#byte", immediateByte])),
  ...opcodeFamily("101 001 r0", { r: indexRegisters }, ({ r }) => load(r, ["zero page", memorySource(addresses.zeroPage)])),
  ...opcodeFamily("101 011 r0", { r: indexRegisters }, ({ r }) => load(r, ["absolute", memorySource(addresses.absolute)])),
  ...opcodeFamily("101 101 r0", { r: indexRegisters }, ({ r }) => load(r, [`zero page,${otherIndex[r].toUpperCase()}`, memorySource(zeroPage(otherIndex[r]))])),
  ...opcodeFamily("101 111 r0", { r: indexRegisters }, ({ r }) => load(r, [`absolute,${otherIndex[r].toUpperCase()}`, memorySource(absolute(otherIndex[r]))])),
  // 100 bbb r0: STY/STX use zp/absolute/zp,OTHER; there is no immediate or absolute-indexed store.
  ...opcodeFamily("100 001 r0", { r: indexRegisters }, ({ r }) => store(r, ["zero page", addresses.zeroPage])),
  ...opcodeFamily("100 011 r0", { r: indexRegisters }, ({ r }) => store(r, ["absolute", addresses.absolute])),
  ...opcodeFamily("100 101 r0", { r: indexRegisters }, ({ r }) => store(r, [`zero page,${otherIndex[r].toUpperCase()}`, zeroPage(otherIndex[r])])),
  // Register transfers occupy bbb=010/110; TXS alone preserves every flag.
  ...opcodePattern("101 010 00", registerTransfer("TAY", "a", "y", resultNZ)),
  ...opcodePattern("100 110 00", registerTransfer("TYA", "y", "a", resultNZ)),
  ...opcodePattern("100 010 10", registerTransfer("TXA", "x", "a", resultNZ)),
  ...opcodePattern("101 010 10", registerTransfer("TAX", "a", "x", resultNZ)),
  ...opcodePattern("100 110 10", registerTransfer("TXS", "x", "sp")),
  ...opcodePattern("101 110 10", registerTransfer("TSX", "sp", "x", resultNZ)),
  // The same operations serve A and memory; only memory performs the original-value write.
  ...opcodeFamily("0ss 010 10", { s: shifts }, ({ s }) => updateByte(`${s.name} A`, cpu.register("a"), s.steps)),
  ...opcodeFamily("0ss mm1 10", { s: shifts, m: modifyOperands }, ({ s, m: [operand, address] }) => updateByte(`${s.name} ${operand}`, address, s.steps)),
  ...opcodeFamily("11i mm1 10", { i: adjustments, m: modifyOperands }, ({ i, m: [operand, address] }) => updateByte(`${i.name} ${operand}`, address, i.steps)),
  // 1ir 010 00: i=1 increments Y/X; i=0 has DEY only. DEX instead occupies 110 010 10.
  ...opcodePattern("100 010 00", updateByte("DEY", cpu.register("y"), adjustments[0]!.steps)),
  ...opcodeFamily("11r 010 00", { r: indexRegisters }, ({ r }) => updateByte(`IN${r.toUpperCase()}`, cpu.register(r), adjustments[1]!.steps)),
  ...opcodePattern("110 010 10", updateByte("DEX", cpu.register("x"), adjustments[0]!.steps)),
]);
