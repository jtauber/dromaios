import { cpu6502StateDescription, cpu6502Status } from "../../state/6502.ts";
import { opcodeFamily, opcodePattern } from "../../opcodes.ts";
import { addWrap, bitAnd, bitOr, capture, concat, cpuSymbols, extend, fetchByte, flagLiteral, highByte, literal, lowByte,
  readMemory, readRegister, readSource, subtract, updateFlags, value, writeMemory, writeRegister } from "../model.ts";
import type { InstructionDefinition, NumberExpression, Register, SourceDefinitions, Statement, ValueSource } from "../model.ts";
import { instructionSet, registerSource, shift } from "../builders.ts";
import { defineInstruction } from "../validate.ts";
import { flagCondition, loadVector, jump, relativeBranch, subroutineReturn } from "../control-flow.ts";
import { byteStack, stackPop, stackPush, wordStack } from "../stack.ts";
import { flagInstruction, flagPolicy, packedStatus, restoreStatus } from "../status.ts";
import { mosArithmetic } from "../mos.ts";
import { sources, policies, operands, families } from "../generated/6502.ts";

const cpu = cpuSymbols("6502", cpu6502StateDescription);
const stack = byteStack(cpu.register("sp"), "free", 0x0100);
type Operand = readonly [name: string, source: ValueSource];

// The literate chapter owns these sources; all 6502 families consume the same definitions.
const { immediateByte, ...addresses } = sources;

// NMOS JMP (addr) increments only the pointer's low byte: xxFF reads its high target byte at xx00.
const indirectJump: ValueSource = { name: "NMOS page-wrapped pointer", width: 16,
  steps: [readSource("pointer", addresses.absolute), readMemory("low", value("pointer")),
    readMemory("high", bitOr(bitAnd(value("pointer"), literal(16, 0xff00)), extend(addWrap(lowByte(value("pointer")), literal(8, 1)), 16)))],
  result: concat(value("high"), value("low")),
};

const resultNZ = policies.NZ;
function arithmetic(name: "ADC" | "SBC", [operand, source]: Operand): InstructionDefinition {
  return defineInstruction({ cpu: cpu.declaration, name: `${name} ${operand}`,
    explanation: "Finish operand reads before capturing A and carry. Binary mode writes A before N/Z/C/V. "
      + (name === "ADC" ? "In decimal mode, Z follows binary addition, N/V follow low-digit correction, and C follows the decimal threshold; flags precede A. "
        : "SBC writes the binary result and N/Z/C/V first; decimal mode then corrects A only. ")
      + "Each decimal digit passes at most one carry or borrow, including invalid BCD digits. Preserve D/I.",
    steps: [readSource("right", source), ...mosArithmetic(cpu, name)],
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

// The chapter's bbb catalogue also serves the other aaa bbb 01 accumulator families.
const accumulatorOperands: readonly Operand[] = operands.accumulator.map(operand => [operand.name, operand.read]);
// Standalone source generation retains focused probes of this shared addressing inventory.
export const sources6502 = { cpu: cpu.declaration, groups: {
  addresses, operands: Object.fromEntries(accumulatorOperands.map(([, source], code) => [code, source])),
} } satisfies SourceDefinitions;
const indexRegisters = ["y", "x"] as const;
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

function interruptEntry(vector: NumberExpression, software: boolean): readonly Statement[] {
  return [readRegister("highPC", cpu.register("pc")), ...stack.push(highByte(value("highPC")), "high"),
    readRegister("lowPC", cpu.register("pc")), ...stack.push(lowByte(value("lowPC")), "low"),
    readSource("status", packedStatus(cpu, cpu6502Status, software ? 0x10 : 0)), ...stack.push(value("status"), "status"),
    updateFlags(flagPolicy(cpu, "mask IRQ after stacking old I", {}, { i: flagLiteral(true) }), {}),
    ...loadVector(cpu.register("pc"), vector, "little-endian")];
}
const entryExplanation = "Push PC high then live PC low, then packed status with old I. Set I only after those writes; preserve NMOS D. Read the complete low-first vector before replacing PC. " + stack.explanation;
export const interrupts6502 = { enter: defineInstruction({ cpu: cpu.declaration, name: "external interrupt entry", inputs: { vector: 16 },
  explanation: "After CPU-owned recognition, stack B clear. " + entryExplanation, steps: interruptEntry(value("vector"), false) }) };

// These patterns generate both instruction bodies and their execution bindings.
export const instructions6502 = instructionSet([
  // 0r0 000 00: r=0 BRK consumes padding and enters IRQ; r=1 RTI restores status then PC.
  ...opcodePattern("000 000 00", defineInstruction({ cpu: cpu.declaration, name: "BRK",
    explanation: "Fetch padding before saving PC; stack B set. " + entryExplanation,
    steps: [fetchByte("padding"), ...interruptEntry(literal(16, 0xfffe), true)] })),
  ...opcodePattern("010 000 00", defineInstruction({ cpu: cpu.declaration, name: "RTI",
    explanation: "Restore the complete flag object first, then pull PC low/high without RTS's increment. A failed PC read retains restored flags. " + stack.explanation,
    steps: [readSource("status", stack.pop), restoreStatus(cpu, cpu6502Status, value("status")),
      readSource("target", wordStack(stack, "little-endian").pop), writeRegister(cpu.register("pc"), value("target"))] })),
  ...opcodePattern("111 010 10", defineInstruction({ cpu: cpu.declaration, name: "NOP", explanation: "No effects after opcode fetching.", steps: [] })),
  // 00v/01v/11v 110 00 select C/I/D and the new flag value; 101 selects CLV.
  ...([["00", "c", "CLC", "SEC"], ["01", "i", "CLI", "SEI"], ["11", "d", "CLD", "SED"]] as const).flatMap(([bits, flag, clear, set]) =>
    opcodeFamily(`${bits}v 110 00`, { v: [false, true] }, ({ v }) => flagInstruction(cpu, v ? set : clear, flag, v))),
  ...opcodePattern("101 110 00", flagInstruction(cpu, "CLV", "v", false)),
  // 00p 010 00: status push adds the stacked B marker; pull ignores reserved bits.
  ...opcodePattern("00 0 010 00", stackPush(cpu.declaration, "PHP", stack, packedStatus(cpu, cpu6502Status, 0x10))),
  ...opcodePattern("00 1 010 00", defineInstruction({ cpu: cpu.declaration, name: "PLP", explanation: "Pull status, then replace all six flags, ignoring reserved bits. " + stack.explanation,
    steps: [readSource("status", stack.pop), restoreStatus(cpu, cpu6502Status, value("status"))] })),
  // 0rp 010 00: r=1 selects A; p=0 pushes, p=1 pulls and updates N/Z.
  ...opcodePattern("01 0 010 00", stackPush(cpu.declaration, "PHA", stack, registerSource(cpu.register("a")))),
  ...opcodePattern("01 1 010 00", stackPop(cpu.declaration, "PLA", stack, cpu.register("a"), resultNZ)),
  // 0r1 000 00: r=0 calls, r=1 returns. JSR interleaves operand fetching with stack writes.
  ...opcodePattern("001 000 00", defineInstruction({ cpu: cpu.declaration, name: "JSR",
    explanation: "Fetch the target low byte, then push the current PC high byte and current PC low byte. "
      + "Only then fetch the target high byte and write PC. A stack write may replace that final operand. "
      + "Preserve flags and other registers. " + stack.explanation,
    steps: [fetchByte("targetLow"), readRegister("highPC", cpu.register("pc")), ...stack.push(highByte(value("highPC")), "high"),
      readRegister("lowPC", cpu.register("pc")), ...stack.push(lowByte(value("lowPC")), "low"),
      fetchByte("targetHigh"), writeRegister(cpu.register("pc"), concat(value("targetHigh"), value("targetLow")))],
  })),
  ...opcodePattern("011 000 00", subroutineReturn(cpu, "RTS", wordStack(stack, "little-endian"), undefined, 1)),
  // ffv 100 00: ff selects N/V/C/Z; v is the required flag value.
  ...opcodeFamily("ff v 100 00", { f: ["n", "v", "c", "z"] as const, v: [false, true] }, ({ f, v }) =>
    relativeBranch(cpu, { n: ["BPL", "BMI"], v: ["BVC", "BVS"], c: ["BCC", "BCS"], z: ["BNE", "BEQ"] }[f][Number(v)]!,
      immediateByte, flagCondition(cpu.flag(f), v))),
  ...opcodePattern("010 011 00", jump(cpu, "JMP absolute", addresses.absolute)),
  ...opcodePattern("011 011 00", jump(cpu, "JMP indirect", indirectJump)),
  // The chapter owns loads/stores, register transfers, logic, comparisons, and BIT.
  ...Object.values(families).flat(),
  ...opcodeFamily("011 bbb 01", { b: accumulatorOperands }, ({ b }) => arithmetic("ADC", b)),
  ...opcodeFamily("111 bbb 01", { b: accumulatorOperands }, ({ b }) => arithmetic("SBC", b)),
  // The same operations serve A and memory; only memory performs the original-value write.
  ...opcodeFamily("0ss 010 10", { s: shifts }, ({ s }) => updateByte(`${s.name} A`, cpu.register("a"), s.steps)),
  ...opcodeFamily("0ss mm1 10", { s: shifts, m: modifyOperands }, ({ s, m: [operand, address] }) => updateByte(`${s.name} ${operand}`, address, s.steps)),
  ...opcodeFamily("11i mm1 10", { i: adjustments, m: modifyOperands }, ({ i, m: [operand, address] }) => updateByte(`${i.name} ${operand}`, address, i.steps)),
  // 1ir 010 00: i=1 increments Y/X; i=0 has DEY only. DEX instead occupies 110 010 10.
  ...opcodePattern("100 010 00", updateByte("DEY", cpu.register("y"), adjustments[0]!.steps)),
  ...opcodeFamily("11r 010 00", { r: indexRegisters }, ({ r }) => updateByte(`IN${r.toUpperCase()}`, cpu.register(r), adjustments[1]!.steps)),
  ...opcodePattern("110 010 10", updateByte("DEX", cpu.register("x"), adjustments[0]!.steps)),
]);
