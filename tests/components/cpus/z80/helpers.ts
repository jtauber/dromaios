import assert from "node:assert/strict";
import type { BytePorts } from "../../../../src/components/cpus/port-access.js";
import { CpuZ80 } from "../../../../src/components/cpus/generated/z80-cpu.js";
import type { CpuZ80Flags, CpuZ80RegisterBank, CpuZ80State, CpuZ80MemoryAccess, CpuZ80Access } from "../../../../src/components/cpus/generated/z80-cpu.js";
import { Ram } from "../../../../src/components/memory/ram.js";
import { ObservedRam } from "../../../helpers/observed-ram.js";

export function initialState(overrides: Partial<CpuZ80State> = {}): CpuZ80State {
  return {
    a: 0x11, b: 0x22, c: 0x33, d: 0x44, e: 0x55, h: 0x66, l: 0x77,
    flags: { s: true, z: false, h: true, pv: false, n: true, c: false },
    alternate: {
      a: 0x88, b: 0x99, c: 0xaa, d: 0xbb, e: 0xcc, h: 0xdd, l: 0xee,
      flags: { s: false, z: true, h: false, pv: true, n: false, c: true },
    },
    ix: 0x1234, iy: 0x5678, pc: 0x2000, sp: 0xabcd, i: 0x42, r: 0xfe,
    interruptDeferred: false, nmiDeferred: false, iff1: true, iff2: false, im: 2, halted: false,
    ...overrides,
  };
}

export function bankSnapshot(bank: CpuZ80RegisterBank) {
  return { ...bank, flags: { ...bank.flags }, bc: bank.b * 256 + bank.c,
    de: bank.d * 256 + bank.e, hl: bank.h * 256 + bank.l };
}

export function snapshot(state: CpuZ80State) {
  return { ...state, ...bankSnapshot(state), alternate: bankSnapshot(state.alternate) };
}

export function flagPattern(bits: number): CpuZ80Flags {
  return { s: Boolean(bits & 1), z: Boolean(bits & 2), h: Boolean(bits & 4),
    pv: Boolean(bits & 8), n: Boolean(bits & 16), c: Boolean(bits & 32) };
}

// Literal rows from the documented load matrix; columns are B/C/D/E/H/L/(HL)/A.
export const transferColumns = ["b", "c", "d", "e", "h", "l", "(hl)", "a"] as const;

export const transferRows = [
  { destination: "b", opcodes: [0x40, 0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47] },
  { destination: "c", opcodes: [0x48, 0x49, 0x4a, 0x4b, 0x4c, 0x4d, 0x4e, 0x4f] },
  { destination: "d", opcodes: [0x50, 0x51, 0x52, 0x53, 0x54, 0x55, 0x56, 0x57] },
  { destination: "e", opcodes: [0x58, 0x59, 0x5a, 0x5b, 0x5c, 0x5d, 0x5e, 0x5f] },
  { destination: "h", opcodes: [0x60, 0x61, 0x62, 0x63, 0x64, 0x65, 0x66, 0x67] },
  { destination: "l", opcodes: [0x68, 0x69, 0x6a, 0x6b, 0x6c, 0x6d, 0x6e, 0x6f] },
  { destination: "(hl)", opcodes: [0x70, 0x71, 0x72, 0x73, 0x74, 0x75, 0x76, 0x77] },
  { destination: "a", opcodes: [0x78, 0x79, 0x7a, 0x7b, 0x7c, 0x7d, 0x7e, 0x7f] },
] as const;

// Manual encodings, with register columns B/C/D/E/H/L/(HL)/A and a separate immediate form.
export const aluForms = [
  { name: "ADD", opcodes: [0x80, 0x81, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87], immediate: 0xc6 },
  { name: "ADC", opcodes: [0x88, 0x89, 0x8a, 0x8b, 0x8c, 0x8d, 0x8e, 0x8f], immediate: 0xce },
  { name: "SUB", opcodes: [0x90, 0x91, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97], immediate: 0xd6 },
  { name: "SBC", opcodes: [0x98, 0x99, 0x9a, 0x9b, 0x9c, 0x9d, 0x9e, 0x9f], immediate: 0xde },
  { name: "AND", opcodes: [0xa0, 0xa1, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7], immediate: 0xe6 },
  { name: "XOR", opcodes: [0xa8, 0xa9, 0xaa, 0xab, 0xac, 0xad, 0xae, 0xaf], immediate: 0xee },
  { name: "OR", opcodes: [0xb0, 0xb1, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7], immediate: 0xf6 },
  { name: "CP", opcodes: [0xb8, 0xb9, 0xba, 0xbb, 0xbc, 0xbd, 0xbe, 0xbf], immediate: 0xfe },
] as const;

export type AluName = typeof aluForms[number]["name"];

export function expectedAlu(name: AluName, a: number, value: number, carry: boolean) {
  if (name === "AND" || name === "XOR" || name === "OR") {
    const result = name === "AND" ? a & value : name === "XOR" ? a ^ value : a | value;
    const setBits = result.toString(2).split("1").length - 1;
    return { a: result, flags: { s: result >= 128, z: result === 0, h: name === "AND",
      pv: setBits % 2 === 0, n: false, c: false } };
  }
  // Signed/unsigned arithmetic and decimal low-digit comparisons, independent of the shared ALU helpers.
  const signed = (value: number) => value < 128 ? value : value - 256;
  const input = (name === "ADC" || name === "SBC") && carry ? 1 : 0;
  const subtract = name === "SUB" || name === "SBC" || name === "CP";
  const total = subtract ? a - value - input : a + value + input;
  const signedTotal = subtract ? signed(a) - signed(value) - input : signed(a) + signed(value) + input;
  const lowTotal = subtract ? a % 16 - value % 16 - input : a % 16 + value % 16 + input;
  const result = (total + 256) % 256;
  return { a: name === "CP" ? a : result, flags: { s: result >= 128, z: result === 0,
    h: lowTotal < 0 || lowTotal > 15, pv: signedTotal < -128 || signedTotal > 127,
    n: subtract, c: total < 0 || total > 255 } };
}

// CB rows from the manual. The undocumented 30–37 SLL row is deliberately absent.
export const cbRows = [
  { name: "RLC", bit: 0, base: 0x00 }, { name: "RRC", bit: 0, base: 0x08 },
  { name: "RL", bit: 0, base: 0x10 }, { name: "RR", bit: 0, base: 0x18 },
  { name: "SLA", bit: 0, base: 0x20 }, { name: "SRA", bit: 0, base: 0x28 },
  { name: "SRL", bit: 0, base: 0x38 },
  ...[0x40, 0x48, 0x50, 0x58, 0x60, 0x68, 0x70, 0x78].map((base, bit) => ({ name: "BIT", bit, base })),
  ...[0x80, 0x88, 0x90, 0x98, 0xa0, 0xa8, 0xb0, 0xb8].map((base, bit) => ({ name: "RES", bit, base })),
  ...[0xc0, 0xc8, 0xd0, 0xd8, 0xe0, 0xe8, 0xf0, 0xf8].map((base, bit) => ({ name: "SET", bit, base })),
];

export function expectedCb(name: string, bit: number, value: number, flags: CpuZ80Flags) {
  // Use character movement to specify bit behavior independently of the core's shifts and masks.
  const digits = value.toString(2).padStart(8, "0").split("");
  if (name === "BIT") {
    const clear = digits[7 - bit] === "0";
    return { value, flags: { s: bit === 7 && !clear, z: clear, h: true, pv: clear, n: false, c: flags.c } };
  }
  if (name === "RES" || name === "SET") {
    digits[7 - bit] = name === "SET" ? "1" : "0";
    return { value: Number.parseInt(digits.join(""), 2), flags };
  }
  const left = ["RLC", "RL", "SLA"].includes(name);
  const outgoing = left ? digits.shift()! : digits.pop()!;
  const incoming = name === "RLC" || name === "RRC" ? outgoing
    : name === "RL" || name === "RR" ? (flags.c ? "1" : "0")
    : name === "SRA" ? digits[0]! : "0";
  if (left) digits.push(incoming);
  else digits.unshift(incoming);
  const result = Number.parseInt(digits.join(""), 2);
  return { value: result, flags: { s: digits[0] === "1", z: result === 0, h: false,
    pv: digits.filter(digit => digit === "1").length % 2 === 0, n: false, c: outgoing === "1" } };
}

export function unpackFlags(value: number): CpuZ80Flags {
  // Positions in F are independent of flagPattern's compact test-case numbering.
  return { s: Math.floor(value / 128) % 2 === 1, z: Math.floor(value / 64) % 2 === 1,
    h: Math.floor(value / 16) % 2 === 1, pv: Math.floor(value / 4) % 2 === 1,
    n: Math.floor(value / 2) % 2 === 1, c: value % 2 === 1 };
}

export function checkBaseStep(ram: ObservedRam, before: CpuZ80State, bytes: readonly number[], changes: Partial<CpuZ80State> = {}, data: readonly CpuZ80MemoryAccess[] = []): void {
  bytes.forEach((value, i) => ram.write((before.pc + i) % 65536, value));
  ram.accesses.length = 0;
  const cpu = new CpuZ80(ram, before);
  const accesses = [...bytes.map((value, i) => ({ kind: "read" as const, address: (before.pc + i) % 65536, value })), ...data];
  const after = snapshot({ ...before, pc: (before.pc + bytes.length) % 65536,
    r: Math.floor(before.r / 128) * 128 + (before.r % 128 + 1) % 128, ...changes });
  assert.deepEqual(cpu.step(), { before: snapshot(before), after, instruction: { address: before.pc, bytes }, accesses, outcome: "executed" });
  assert.deepEqual(cpu.snapshot(), after);
  assert.deepEqual(ram.accesses, accesses);
}

export const wordPairForms = [
  { high: "b", low: "c", inc: 0x03, dec: 0x0b, add: 0x09 },
  { high: "d", low: "e", inc: 0x13, dec: 0x1b, add: 0x19 },
  { high: "h", low: "l", inc: 0x23, dec: 0x2b, add: 0x29 },
  { high: null, low: null, inc: 0x33, dec: 0x3b, add: 0x39 },
] as const;

export function withPair(state: CpuZ80State, form: typeof wordPairForms[number], value: number): CpuZ80State {
  return form.high === null ? { ...state, sp: value } : { ...state, [form.high]: Math.floor(value / 256), [form.low]: value % 256 };
}

// Documented prefix-page inventories transcribed independently of the implementation's patterns.
export const indexOpcodes = [0x09, 0x19, 0x21, 0x22, 0x23, 0x29, 0x2a, 0x2b, 0x34, 0x35, 0x36, 0x39,
  0x46, 0x4e, 0x56, 0x5e, 0x66, 0x6e, 0x70, 0x71, 0x72, 0x73, 0x74, 0x75, 0x77, 0x7e,
  0x86, 0x8e, 0x96, 0x9e, 0xa6, 0xae, 0xb6, 0xbe, 0xe1, 0xe3, 0xe5, 0xe9, 0xf9];

export const edOpcodes = [0x45, 0x46, 0x4d, 0x56, 0x5e,
  0x40, 0x48, 0x50, 0x58, 0x60, 0x68, 0x78, 0x41, 0x49, 0x51, 0x59, 0x61, 0x69, 0x79,
  0xa2, 0xa3, 0xaa, 0xab, 0xb2, 0xb3, 0xba, 0xbb,
  0x42, 0x43, 0x44, 0x47, 0x4a, 0x4b, 0x4f, 0x52, 0x53, 0x57, 0x5a, 0x5b, 0x5f,
  0x62, 0x63, 0x67, 0x6a, 0x6b, 0x6f, 0x72, 0x73, 0x7a, 0x7b, 0xa0, 0xa1, 0xa8, 0xa9, 0xb0, 0xb1, 0xb8, 0xb9];

export const indexes = [{ prefix: 0xdd, index: "ix" }, { prefix: 0xfd, index: "iy" }] as const;

export const readAccess = (address: number, value: number): CpuZ80MemoryAccess => ({ kind: "read", address, value });

export const writeAccess = (address: number, value: number): CpuZ80MemoryAccess => ({ kind: "write", address, value });

export const refreshTwice = (r: number): number => Math.floor(r / 128) * 128 + (r + 2) % 128;

export function checkPrefixedStep(ram: ObservedRam, before: CpuZ80State, bytes: readonly number[], changes: Partial<CpuZ80State> = {}, data: readonly CpuZ80MemoryAccess[] = []): void {
  checkBaseStep(ram, before, bytes, { r: refreshTwice(before.r), ...changes }, data);
}

// Observe the real RAM/device calls in one order, independently of the CPU's recorders.
export class IoRam extends Ram {
  readonly accesses: CpuZ80Access[] = [];
  input = 0;
  observe?: (kind: CpuZ80Access["kind"], address: number, value?: number) => void;
  constructor() { super(0x10000); }
  override read(address: number): number {
    this.observe?.("read", address);
    const value = super.read(address);
    this.accesses.push({ kind: "read", address, value });
    return value;
  }
  override write(address: number, value: number): void {
    this.observe?.("write", address, value);
    super.write(address, value);
    this.accesses.push({ kind: "write", address, value });
  }
  readonly ports: BytePorts = {
    readPort: port => {
      this.observe?.("input", port);
      this.accesses.push({ kind: "input", port, value: this.input });
      return this.input;
    },
    writePort: (port, value) => {
      this.observe?.("output", port, value);
      this.accesses.push({ kind: "output", port, value });
    },
  };
}
