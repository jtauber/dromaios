import assert from "node:assert/strict";
import { Cpu8088 } from "../../../../src/components/cpus/generated/8088-cpu.js";
import type { Cpu8088Flags, Cpu8088State, Cpu8088Snapshot, Cpu8088MemoryAccess } from "../../../../src/components/cpus/generated/8088-cpu.js";
import { Ram } from "../../../../src/components/memory/ram.js";
import { ObservedRam } from "../../../helpers/observed-ram.js";

// Literal encodings from Intel's instruction table, independent of the core's selector arrays.
export const wordMoves = [
  [0xb8, "ax"], [0xb9, "cx"], [0xba, "dx"], [0xbb, "bx"],
  [0xbc, "sp"], [0xbd, "bp"], [0xbe, "si"], [0xbf, "di"],
] as const;
export const byteMoves = [
  [0xb0, "ax", "low"], [0xb1, "cx", "low"], [0xb2, "dx", "low"], [0xb3, "bx", "low"],
  [0xb4, "ax", "high"], [0xb5, "cx", "high"], [0xb6, "dx", "high"], [0xb7, "bx", "high"],
] as const;

export function initialState(overrides: Partial<Cpu8088State> = {}): Cpu8088State {
  return { halted: false, waiting: false, interruptDeferred: false, recognitionDeferred: false, trapPending: false, ax: 0x1122, bx: 0x3344, cx: 0x5566, dx: 0x7788, sp: 0x8000, bp: 0x9000, si: 0x10, di: 0x20,
    cs: 0x1234, ds: 0x2000, ss: 0x3000, es: 0x4000, ip: 0x100, flags: flags(0x1df), ...overrides };
}

// A compact test enumeration of the nine flags, independent of packed FLAGS bit positions.
export function flags(bits: number): Cpu8088Flags {
  return { cf: Boolean(bits & 1), pf: Boolean(bits & 2), af: Boolean(bits & 4), zf: Boolean(bits & 8),
    sf: Boolean(bits & 16), tf: Boolean(bits & 32), if: Boolean(bits & 64), df: Boolean(bits & 128), of: Boolean(bits & 256) };
}

export function snapshot(state: Cpu8088State): Cpu8088Snapshot {
  return { ...state, flags: { ...state.flags },
    al: state.ax % 256, ah: Math.floor(state.ax / 256), bl: state.bx % 256, bh: Math.floor(state.bx / 256),
    cl: state.cx % 256, ch: Math.floor(state.cx / 256), dl: state.dx % 256, dh: Math.floor(state.dx / 256),
    pc: (state.cs * 16 + state.ip) % 1048576 };
}

// Signed ranges and a bit count provide an oracle independent of the CPU's bitwise flag formulas.
export function addition(before: Cpu8088State, operand: number, width: 8 | 16 = 16): Cpu8088State {
  const modulus = 2 ** width;
  const sign = modulus / 2;
  const accumulator = before.ax % modulus;
  const total = accumulator + operand;
  const result = total % modulus;
  const signedTotal = (accumulator < sign ? accumulator : accumulator - modulus)
    + (operand < sign ? operand : operand - modulus);
  const ones = (result % 256).toString(2).replaceAll("0", "").length;
  const ax = width === 8 ? Math.floor(before.ax / 256) * 256 + result : result;
  return { ...before, ax, ip: (before.ip + 1 + width / 8) % 65536, flags: { ...before.flags,
    cf: total >= modulus, pf: ones % 2 === 0, af: accumulator % 16 + operand % 16 >= 16,
    zf: result === 0, sf: result >= sign, of: signedTotal < -sign || signedTotal >= sign } };
}

export function checkStep(ram: ObservedRam, before: Cpu8088State, bytes: readonly number[], after: Cpu8088State,
  addresses: readonly number[] = bytes.map((_, i) => (before.cs * 16 + (before.ip + i) % 65536) % 1048576), dataAccesses: readonly Cpu8088MemoryAccess[] = []): void {
  after = { ...after, trapPending: before.flags.tf }; // TF is sampled before the tested instruction.
  bytes.forEach((byte, index) => ram.write(addresses[index]!, byte));
  ram.accesses.length = 0;
  const cpu = new Cpu8088(ram, before);
  const accesses = [...bytes.map((value, index) => ({ kind: "read", address: addresses[index]!, value })), ...dataAccesses];
  assert.deepEqual(cpu.step(), { before: snapshot(before), after: snapshot(after),
    instruction: { address: addresses[0], bytes }, outcome: "executed", accesses });
  assert.deepEqual(cpu.snapshot(), snapshot(after));
  assert.deepEqual(ram.accesses, accesses);
}

// Rows are literal documented encodings, including each ModR/M operation selector.
export const aluForms = [
  ["ADD", 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0],
  ["OR",  0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 1],
  ["ADC", 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 2],
  ["SBB", 0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 3],
  ["AND", 0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 4],
  ["SUB", 0x28, 0x29, 0x2a, 0x2b, 0x2c, 0x2d, 5],
  ["XOR", 0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 6],
  ["CMP", 0x38, 0x39, 0x3a, 0x3b, 0x3c, 0x3d, 7],
] as const;
export type AluName = typeof aluForms[number][0] | "TEST";

export function aluResult(name: AluName, width: 8 | 16, left: number, right: number, old: Cpu8088Flags) {
  const modulus = 2 ** width;
  const sign = modulus / 2;
  const signed = (value: number) => value < sign ? value : value - modulus;
  const subtract = name === "SUB" || name === "SBB" || name === "CMP";
  const arithmetic = subtract || name === "ADD" || name === "ADC";
  const carry = (name === "ADC" || name === "SBB") && old.cf ? 1 : 0;
  const total = subtract ? left - right - carry : left + right + carry;
  // Logic expectations are constructed one bit at a time, independently of bitwise operators.
  let logical = 0;
  for (let bit = 0; bit < width; bit++) {
    const l = Math.floor(left / 2 ** bit) % 2;
    const r = Math.floor(right / 2 ** bit) % 2;
    if (name === "OR" ? l + r > 0 : name === "XOR" ? l !== r : l * r === 1) logical += 2 ** bit;
  }
  const result = arithmetic ? (total % modulus + modulus) % modulus : logical;
  const signedTotal = subtract ? signed(left) - signed(right) - carry : signed(left) + signed(right) + carry;
  return { result, flags: { ...old,
    cf: arithmetic && (total < 0 || total >= modulus),
    af: arithmetic && (subtract ? left % 16 < right % 16 + carry : left % 16 + right % 16 + carry >= 16),
    of: arithmetic && (signedTotal < -sign || signedTotal >= sign),
    pf: (result % 256).toString(2).replaceAll("0", "").length % 2 === 0,
    zf: result === 0, sf: result >= sign } };
}

export function registerValue(state: Cpu8088State, width: 8 | 16, selector: number): number {
  if (width === 16) return state[wordMoves[selector]![1]];
  const [, word, half] = byteMoves[selector]!;
  return half === "low" ? state[word] % 256 : Math.floor(state[word] / 256);
}

export function replaceRegister(state: Cpu8088State, width: 8 | 16, selector: number, value: number): Cpu8088State {
  if (width === 16) return { ...state, [wordMoves[selector]![1]]: value };
  const [, word, half] = byteMoves[selector]!;
  return { ...state, [word]: half === "low" ? Math.floor(state[word] / 256) * 256 + value : value * 256 + state[word] % 256 };
}

// Literal base offsets for BX=FFF0, BP=FFF8, SI=0020, DI=0030. No core decoder is used.
export const memoryForms = [
  [0, 0x10, "ds"], [1, 0x20, "ds"], [2, 0x18, "ss"], [3, 0x28, "ss"],
  [4, 0x20, "ds"], [5, 0x30, "ds"], [6, 0xfff8, "ss"], [7, 0xfff0, "ds"],
] as const;
export function addressedState(): Cpu8088State {
  return initialState({ bx: 0xfff0, bp: 0xfff8, si: 0x20, di: 0x30, ds: 0xffff, ss: 0x3456 });
}
export function addressingCases() {
  return memoryForms.flatMap(([rm, base, segment]) => [
    { rm, mod: 0, displacement: rm === 6 ? [0xff, 0xff] : [], offset: rm === 6 ? 0xffff : base, segment: rm === 6 ? "ds" as const : segment },
    ...[0, 1, 0x7f, 0x80, 0xff].map(byte => ({ rm, mod: 1, displacement: [byte],
      offset: (base + (byte < 128 ? byte : byte - 256) + 65536) % 65536, segment })),
    ...[0, 1, 0x7fff, 0x8000, 0xffff].map(word => ({ rm, mod: 2, displacement: [word % 256, Math.floor(word / 256)],
      offset: (base + word) % 65536, segment })),
  ]);
}
export function memoryBytes(before: Cpu8088State, segment: "ds" | "ss", offset: number, width: 8 | 16, value: number): [number, number][] {
  return Array.from({ length: width / 8 }, (_, i) => [(before[segment] * 16 + (offset + i) % 65536) % 1048576,
    Math.floor(value / 256 ** i) % 256]);
}

export const unaryForms = [
  ["INC", 0xfe, 0xff, 0], ["DEC", 0xfe, 0xff, 1],
  ["NOT", 0xf6, 0xf7, 2], ["NEG", 0xf6, 0xf7, 3],
] as const;
export type UnaryName = typeof unaryForms[number][0];

export function unaryResult(name: UnaryName, width: 8 | 16, value: number, old: Cpu8088Flags) {
  if (name === "NOT") return { result: 2 ** width - 1 - value, flags: old };
  const expected = name === "NEG" ? aluResult("SUB", width, 0, value, old)
    : aluResult(name === "INC" ? "ADD" : "SUB", width, value, 1, old);
  if (name !== "NEG") expected.flags.cf = old.cf;
  return expected;
}

export const shiftForms = [["ROL", 0], ["ROR", 1], ["RCL", 2], ["RCR", 3], ["SHL", 4], ["SHR", 5], ["SAR", 7]] as const;
export type ShiftName = typeof shiftForms[number][0];

// Rotate a string ring, or take a slice of a zero/sign-extended string. No CPU helper or repeated single-bit arithmetic.
export function shiftedResult(name: ShiftName, width: 8 | 16, value: number, count: number, old: Cpu8088Flags) {
  if (count === 0) return { result: value, flags: old };
  const bits = value.toString(2).padStart(width, "0");
  const rotate = name.startsWith("R");
  const left = name === "ROL" || name === "RCL" || name === "SHL";
  let output: string;
  let carry: boolean;
  if (rotate) {
    const throughCarry = name === "RCL" || name === "RCR";
    const ring = bits + (throughCarry ? Number(old.cf) : "");
    const offset = (left ? count : ring.length - count % ring.length) % ring.length;
    const rotated = ring.slice(offset) + ring.slice(0, offset);
    output = rotated.slice(0, width);
    carry = (throughCarry || left ? rotated.at(-1) : rotated[0]) === "1";
  } else {
    const fill = name === "SAR" ? bits[0]! : "0";
    output = left ? (bits + "0".repeat(count)).slice(count, count + width) : (fill.repeat(count) + bits).slice(0, width);
    carry = (count <= width ? bits[left ? count - 1 : width - count] : fill) === "1";
  }
  const result = parseInt(output, 2);
  return { result, flags: { ...old, cf: carry,
    of: count === 1 ? bits[0] !== output[0] : old.of,
    ...(rotate ? {} : { af: false, sf: output[0] === "1", zf: result === 0,
      pf: output.slice(-8).replaceAll("0", "").length % 2 === 0 }) } };
}

// Completion tranche: literal encodings and arithmetic/program oracles, independent of decoder construction.
export const segments = [[0x26, "es"], [0x2e, "cs"], [0x36, "ss"], [0x3e, "ds"]] as const;
export const words = ["ax", "cx", "dx", "bx", "sp", "bp", "si", "di"] as const;
export function address(segment: number, offset: number): number { return (segment * 16 + offset % 65536) % 1048576; }
export function put(ram: Ram, segment: number, offset: number, bytes: readonly number[]): void {
  bytes.forEach((value, i) => ram.write(address(segment, offset + i), value));
}
export function wordBytes(value: number): number[] { return [value % 256, Math.floor(value / 256)]; }
export function dataReads(segment: number, offset: number, bytes: readonly number[]): Cpu8088MemoryAccess[] {
  return bytes.map((value, i) => ({ kind: "read", address: address(segment, offset + i), value }));
}
export function dataWrites(segment: number, offset: number, bytes: readonly number[]): Cpu8088MemoryAccess[] {
  return bytes.map((value, i) => ({ kind: "write", address: address(segment, offset + i), value }));
}
export function resultFlags(value: number, width: 8 | 16): Pick<Cpu8088Flags, "pf" | "sf" | "zf"> {
  return { pf: (value % 256).toString(2).replaceAll("0", "").length % 2 === 0, sf: value >= 2 ** (width - 1), zf: value === 0 };
}
export function reject(ram: ObservedRam, before: Cpu8088State, bytes: readonly number[], reason: "opcode" = "opcode",
  data: readonly Cpu8088MemoryAccess[] = []): void {
  put(ram, before.cs, before.ip, bytes);
  const cpu = new Cpu8088(ram, before);
  for (let attempt = 0; attempt < 2; attempt++) {
    ram.accesses.length = 0;
    const accesses = [...dataReads(before.cs, before.ip, bytes), ...data];
    assert.deepEqual(cpu.step(), { before: snapshot(before), after: snapshot(before), outcome: "unsupported", reason,
      instruction: { address: snapshot(before).pc, bytes }, accesses });
    assert.deepEqual(ram.accesses, accesses);
  }
}

export function checkDivideError(ram: ObservedRam, before: Cpu8088State, bytes: readonly number[], data: readonly Cpu8088MemoryAccess[] = []): void {
  put(ram, 0, 0, [0x78, 0x56, 0x21, 0x43]);
  put(ram, before.cs, before.ip, bytes);
  const packed = 0xf002 + Object.entries({ cf: 0, pf: 2, af: 4, zf: 6, sf: 7, tf: 8, if: 9, df: 10, of: 11 })
    .reduce((sum, [flag, bit]) => sum + (before.flags[flag as keyof Cpu8088Flags] ? 2 ** bit : 0), 0);
  const accesses = [...dataReads(before.cs, before.ip, bytes), ...data, ...dataReads(0, 0, [0x78, 0x56, 0x21, 0x43]),
    ...dataWrites(before.ss, (before.sp + 65534) % 65536, wordBytes(packed)),
    ...dataWrites(before.ss, (before.sp + 65532) % 65536, wordBytes(before.cs)),
    ...dataWrites(before.ss, (before.sp + 65530) % 65536, wordBytes((before.ip + bytes.length) % 65536))];
  ram.accesses.length = 0;
  assert.deepEqual(new Cpu8088(ram, before).step(), { before: snapshot(before), after: snapshot({ ...before,
    cs: 0x4321, ip: 0x5678, sp: (before.sp + 65530) % 65536, trapPending: before.flags.tf,
    flags: { ...before.flags, if: false, tf: false } }), outcome: "executed", interrupt: { source: "divide-error", vector: 0 },
    instruction: { address: snapshot(before).pc, bytes }, accesses });
  assert.deepEqual(ram.accesses, accesses);
}

// Interrupt expectations come from Intel's vector/frame layout, independently of the core's helpers.
export function interruptFrame(before: Cpu8088State, ip = before.ip): Cpu8088MemoryAccess[] {
  const status = 0xf002 + Object.entries({ cf: 0, pf: 2, af: 4, zf: 6, sf: 7, tf: 8, if: 9, df: 10, of: 11 })
    .reduce((sum, [name, bit]) => sum + (before.flags[name as keyof Cpu8088Flags] ? 2 ** bit : 0), 0);
  return [status, before.cs, ip].flatMap((word, i) => dataWrites(before.ss, (before.sp + 65534 - 2 * i) % 65536, wordBytes(word)));
}
export const interruptTarget = [0x78, 0x56, 0x21, 0x43];
export function entered(before: Cpu8088State): Cpu8088State {
  return { ...before, ip: 0x5678, cs: 0x4321, sp: (before.sp + 65530) % 65536, halted: false, waiting: false,
    interruptDeferred: false, recognitionDeferred: false, flags: { ...before.flags, if: false, tf: false } };
}
