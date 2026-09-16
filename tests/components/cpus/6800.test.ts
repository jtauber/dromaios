import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu6800 } from "../../../src/components/cpus/6800.js";
import type { Cpu6800Flags, Cpu6800State, Cpu6800MemoryAccess } from "../../../src/components/cpus/6800.js";
import { Ram } from "../../../src/components/memory/ram.js";
import { ObservedRam } from "../../helpers/observed-ram.js";

function initialState(overrides: Partial<Cpu6800State> = {}): Cpu6800State {
  return { waiting: false, a: 0x81, b: 0x22, x: 0x3456, sp: 0x789a, pc: 0x2000,
    flags: { h: true, i: false, n: true, z: false, v: true, c: true }, ...overrides };
}

function flags(bits: number): Cpu6800Flags {
  return { h: Boolean(bits & 32), i: Boolean(bits & 16), n: Boolean(bits & 8),
    z: Boolean(bits & 4), v: Boolean(bits & 2), c: Boolean(bits & 1) };
}

function loadStoreFlags(value: number, old: Cpu6800Flags): Cpu6800Flags {
  return { ...old, n: value >= 128, z: value === 0, v: false };
}

// Independent oracle: signed ranges and decimal division/remainders, not bitwise overflow formulae.
function addition(a: number, operand: number, i: boolean, carry = 0) {
  const total = a + operand + carry;
  const result = total % 256;
  const signedTotal = (a < 128 ? a : a - 256) + (operand < 128 ? operand : operand - 256) + carry;
  return { waiting: false, a: result, flags: { h: a % 16 + operand % 16 + carry >= 16, i,
    n: result >= 128, z: result === 0, v: signedTotal < -128 || signedTotal > 127, c: total >= 256 } };
}

// Apply a literal Boolean truth table one bit at a time, independently of JS bitwise operators.
function logicalResult(left: number, right: number, truth: readonly [number, number, number, number]): number {
  let result = 0;
  for (let weight = 1; weight <= 128; weight *= 2) {
    const leftBit = Math.floor(left / weight) % 2;
    const rightBit = Math.floor(right / weight) % 2;
    result += truth[leftBit * 2 + rightBit]! * weight;
  }
  return result;
}

const immediateLogic = [
  { mnemonic: "ANDA", opcode: 0x84, register: "a", truth: [0, 0, 0, 1], stores: true },
  { mnemonic: "ANDB", opcode: 0xc4, register: "b", truth: [0, 0, 0, 1], stores: true },
  { mnemonic: "BITA", opcode: 0x85, register: "a", truth: [0, 0, 0, 1], stores: false },
  { mnemonic: "BITB", opcode: 0xc5, register: "b", truth: [0, 0, 0, 1], stores: false },
  { mnemonic: "EORA", opcode: 0x88, register: "a", truth: [0, 1, 1, 0], stores: true },
  { mnemonic: "EORB", opcode: 0xc8, register: "b", truth: [0, 1, 1, 0], stores: true },
  { mnemonic: "ORAA", opcode: 0x8a, register: "a", truth: [0, 1, 1, 1], stores: true },
  { mnemonic: "ORAB", opcode: 0xca, register: "b", truth: [0, 1, 1, 1], stores: true },
] as const;

// Literal manufacturer encodings, in immediate/direct/indexed/extended order.
const accumulatorForms = [
  { name: "SUBA", register: "a", operation: "sub", opcodes: [0x80, 0x90, 0xa0, 0xb0] },
  { name: "SUBB", register: "b", operation: "sub", opcodes: [0xc0, 0xd0, 0xe0, 0xf0] },
  { name: "CMPA", register: "a", operation: "cmp", opcodes: [0x81, 0x91, 0xa1, 0xb1] },
  { name: "CMPB", register: "b", operation: "cmp", opcodes: [0xc1, 0xd1, 0xe1, 0xf1] },
  { name: "SBCA", register: "a", operation: "sbc", opcodes: [0x82, 0x92, 0xa2, 0xb2] },
  { name: "SBCB", register: "b", operation: "sbc", opcodes: [0xc2, 0xd2, 0xe2, 0xf2] },
  { name: "ANDA", register: "a", operation: "and", opcodes: [0x84, 0x94, 0xa4, 0xb4] },
  { name: "ANDB", register: "b", operation: "and", opcodes: [0xc4, 0xd4, 0xe4, 0xf4] },
  { name: "BITA", register: "a", operation: "bit", opcodes: [0x85, 0x95, 0xa5, 0xb5] },
  { name: "BITB", register: "b", operation: "bit", opcodes: [0xc5, 0xd5, 0xe5, 0xf5] },
  { name: "LDAA", register: "a", operation: "load", opcodes: [0x86, 0x96, 0xa6, 0xb6] },
  { name: "LDAB", register: "b", operation: "load", opcodes: [0xc6, 0xd6, 0xe6, 0xf6] },
  { name: "EORA", register: "a", operation: "xor", opcodes: [0x88, 0x98, 0xa8, 0xb8] },
  { name: "EORB", register: "b", operation: "xor", opcodes: [0xc8, 0xd8, 0xe8, 0xf8] },
  { name: "ADCA", register: "a", operation: "adc", opcodes: [0x89, 0x99, 0xa9, 0xb9] },
  { name: "ADCB", register: "b", operation: "adc", opcodes: [0xc9, 0xd9, 0xe9, 0xf9] },
  { name: "ORAA", register: "a", operation: "or", opcodes: [0x8a, 0x9a, 0xaa, 0xba] },
  { name: "ORAB", register: "b", operation: "or", opcodes: [0xca, 0xda, 0xea, 0xfa] },
  { name: "ADDA", register: "a", operation: "add", opcodes: [0x8b, 0x9b, 0xab, 0xbb] },
  { name: "ADDB", register: "b", operation: "add", opcodes: [0xcb, 0xdb, 0xeb, 0xfb] },
] as const;

const storeForms = [
  { name: "STAA", register: "a", opcode: 0x97, mode: "direct" },
  { name: "STAB", register: "b", opcode: 0xd7, mode: "direct" },
  { name: "STAA", register: "a", opcode: 0xa7, mode: "indexed" },
  { name: "STAB", register: "b", opcode: 0xe7, mode: "indexed" },
  { name: "STAA", register: "a", opcode: 0xb7, mode: "extended" },
  { name: "STAB", register: "b", opcode: 0xf7, mode: "extended" },
] as const;

// Original 6800 word encodings, in immediate/direct/indexed/extended order.
const wordLoads = [
  { name: "LDS", register: "sp", opcodes: [0x8e, 0x9e, 0xae, 0xbe] },
  { name: "LDX", register: "x", opcodes: [0xce, 0xde, 0xee, 0xfe] },
] as const;
const wordStores = [
  { name: "STS", register: "sp", opcodes: [0x9f, 0xaf, 0xbf] },
  { name: "STX", register: "x", opcodes: [0xdf, 0xef, 0xff] },
] as const;
const indexComparisons = [0x8c, 0x9c, 0xac, 0xbc] as const;
const pointerOperations = [
  { name: "INX", opcode: 0x08, source: "x", destination: "x", delta: 1, setsZero: true },
  { name: "DEX", opcode: 0x09, source: "x", destination: "x", delta: -1, setsZero: true },
  { name: "TSX", opcode: 0x30, source: "sp", destination: "x", delta: 1, setsZero: false },
  { name: "INS", opcode: 0x31, source: "sp", destination: "sp", delta: 1, setsZero: false },
  { name: "DES", opcode: 0x34, source: "sp", destination: "sp", delta: -1, setsZero: false },
  { name: "TXS", opcode: 0x35, source: "x", destination: "sp", delta: -1, setsZero: false },
] as const;
const interAccumulator = [
  { name: "ABA", opcode: 0x1b, operation: "add" },
  { name: "SBA", opcode: 0x10, operation: "sub" },
  { name: "CBA", opcode: 0x11, operation: "cmp" },
] as const;

function indexComparison(x: number, operand: number, old: Cpu6800Flags): Cpu6800Flags {
  const left = Math.floor(x / 256), right = Math.floor(operand / 256);
  const highDifference = (left - right + 256) % 256;
  const signedDifference = (left < 128 ? left : left - 256) - (right < 128 ? right : right - 256);
  return { ...old, n: highDifference >= 128, z: x === operand, v: signedDifference < -128 || signedDifference > 127 };
}

const wordForms = [
  ...wordLoads.flatMap(({ name, register, opcodes }) => opcodes.map((opcode, mode) => ({ name, register, opcode, mode, operation: "load" as const }))),
  ...wordStores.flatMap(({ name, register, opcodes }) => opcodes.map((opcode, index) => ({ name, register, opcode, mode: index + 1, operation: "store" as const }))),
  ...indexComparisons.map((opcode, mode) => ({ name: "CPX", register: "x" as const, opcode, mode, operation: "compare" as const })),
];

// Arrange literal operand bytes and independently derive expected state and actual bus calls.
function checkWordInstruction(ram: ObservedRam, form: typeof wordForms[number], before: Cpu6800State, operand: number, location: number) {
  const { opcode, mode, register, operation } = form;
  const pc = before.pc;
  const address = mode === 0 ? undefined : mode === 2 ? (before.x + location) % 65536 : location;
  const word = mode === 0 ? operand : location;
  const bytes = mode === 0 || mode === 3 ? [opcode, Math.floor(word / 256), word % 256] : [opcode, location];
  if (address !== undefined) {
    ram.write(address, Math.floor(operand / 256));
    ram.write((address + 1) % 65536, operand % 256);
  }
  // Code takes precedence when data overlaps instruction bytes.
  for (const [offset, byte] of bytes.entries()) ram.write((pc + offset) % 65536, byte);
  const memoryValue = address === undefined ? operand : ram.read(address) * 256 + ram.read((address + 1) % 65536);
  const value = operation === "store" ? before[register] : memoryValue;
  const after = { ...before, pc: (pc + bytes.length) % 65536,
    flags: operation === "compare" ? indexComparison(before.x, value, before.flags)
      : { ...before.flags, n: value >= 32768, z: value === 0, v: false } };
  if (operation === "load") after[register] = value;
  const accesses: Cpu6800MemoryAccess[] = bytes.map((value, offset) => ({ kind: "read", address: (pc + offset) % 65536, value }));
  if (address !== undefined) {
    const kind = operation === "store" ? "write" : "read";
    accesses.push({ kind, address, value: Math.floor(value / 256) }, { kind, address: (address + 1) % 65536, value: value % 256 });
  }
  ram.accesses.length = 0;
  const cpu = new Cpu6800(ram, before);
  assert.deepEqual(cpu.step(), { before, after, instruction: { address: pc, bytes }, outcome: "executed", accesses });
  assert.deepEqual(cpu.snapshot(), after);
  assert.deepEqual(ram.accesses, accesses);
  if (address !== undefined) {
    const expectedMemory = operation === "store" ? value : memoryValue;
    assert.equal(ram.read(address) * 256 + ram.read((address + 1) % 65536), expectedMemory);
  }
}

// Literal opcode rows from Motorola Appendix A, in A/B/indexed/extended order.
const unaryForms = [
  { name: "NEG", opcodes: [0x40, 0x50, 0x60, 0x70] },
  { name: "COM", opcodes: [0x43, 0x53, 0x63, 0x73] },
  { name: "LSR", opcodes: [0x44, 0x54, 0x64, 0x74] },
  { name: "ROR", opcodes: [0x46, 0x56, 0x66, 0x76] },
  { name: "ASR", opcodes: [0x47, 0x57, 0x67, 0x77] },
  { name: "ASL", opcodes: [0x48, 0x58, 0x68, 0x78] },
  { name: "ROL", opcodes: [0x49, 0x59, 0x69, 0x79] },
  { name: "DEC", opcodes: [0x4a, 0x5a, 0x6a, 0x7a] },
  { name: "INC", opcodes: [0x4c, 0x5c, 0x6c, 0x7c] },
  { name: "TST", opcodes: [0x4d, 0x5d, 0x6d, 0x7d] },
  { name: "CLR", opcodes: [0x4f, 0x5f, 0x6f, 0x7f] },
] as const;

type UnaryOperation = typeof unaryForms[number]["name"];

// Arithmetic ranges and printed bit strings supply an independent result/flag oracle.
function unaryResult(operation: UnaryOperation, value: number, old: Cpu6800Flags) {
  let result = value, c = old.c, v = false;
  const bits = value.toString(2).padStart(8, "0");
  switch (operation) {
    case "NEG": result = (256 - value) % 256; c = value !== 0; v = value === 128; break;
    case "COM": result = 255 - value; c = true; break;
    case "DEC": case "INC": {
      const delta = operation === "INC" ? 1 : -1;
      const signed = (value < 128 ? value : value - 256) + delta;
      result = (value + delta + 256) % 256;
      v = signed < -128 || signed > 127;
      break;
    }
    case "ASL": case "ROL": {
      const incoming = operation === "ROL" && old.c ? "1" : "0";
      result = parseInt(bits.slice(1) + incoming, 2);
      c = bits[0] === "1";
      const signed = (value < 128 ? value : value - 256) * 2 + Number(incoming);
      v = signed < -128 || signed > 127;
      break;
    }
    case "LSR": case "ROR": case "ASR": {
      const incoming = operation === "ASR" ? bits[0]! : operation === "ROR" && old.c ? "1" : "0";
      result = parseInt(incoming + bits.slice(0, -1), 2);
      c = bits.at(-1) === "1";
      // Motorola's V truth table in N,C order: 00=0, 01=1, 10=1, 11=0.
      v = [false, true, true, false][Number(incoming) * 2 + Number(c)]!;
      break;
    }
    case "CLR": result = 0; c = false; break;
    case "TST": c = false; break;
  }
  return { result, flags: { ...old, n: result >= 128, z: result === 0, v, c } };
}

type AccumulatorOperation = typeof accumulatorForms[number]["operation"];

function accumulatorResult(operation: AccumulatorOperation, left: number, right: number, old: Cpu6800Flags) {
  if (operation === "add" || operation === "adc") {
    const { a, flags } = addition(left, right, old.i, operation === "adc" && old.c ? 1 : 0);
    return { value: a, flags };
  }
  if (operation === "sub" || operation === "sbc" || operation === "cmp") {
    const incoming = operation === "sbc" && old.c ? 1 : 0;
    const difference = left - right - incoming;
    const value = (difference + 256) % 256;
    const signedDifference = (left < 128 ? left : left - 256) - (right < 128 ? right : right - 256) - incoming;
    return { value: operation === "cmp" ? left : value,
      flags: { h: old.h, i: old.i, n: value >= 128, z: value === 0,
        v: signedDifference < -128 || signedDifference > 127, c: difference < 0 } };
  }
  const value = operation === "load" ? right
    : logicalResult(left, right, operation === "or" ? [0, 1, 1, 1]
      : operation === "xor" ? [0, 1, 1, 0] : [0, 0, 0, 1]);
  return { value: operation === "bit" ? left : value, flags: loadStoreFlags(value, old) };
}

for (const { name, register, operation, opcodes } of accumulatorForms) {
  test(`6800 ${name} covers all four modes and flag patterns with complete records at arithmetic boundaries`, () => {
    const ram = new ObservedRam();
    for (const [mode, opcode] of opcodes.entries()) {
      for (const [left, operand] of [[0, 0], [0, 0xff], [0x7f, 1], [0x80, 1], [0xff, 1], [0x0f, 0xf0]] as const) {
        for (let bits = 0; bits < 64; bits++) {
          const pc = bits % 2 === 0 ? 0x2000 : 0xffff;
          const before = initialState({ [register]: left, x: 0xfff0, pc, flags: flags(bits) });
          const operands = mode === 0 ? [operand] : mode === 1 ? [0x80] : mode === 2 ? [0xff] : [0x81, 0x23];
          const address = mode === 0 ? undefined : mode === 1 ? 0x80 : mode === 2 ? 0xef : 0x8123;
          const bytes = [opcode, ...operands];
          for (const [offset, byte] of bytes.entries()) ram.write((pc + offset) % 65536, byte);
          if (address !== undefined) ram.write(address, operand);
          ram.accesses.length = 0;
          const expected = accumulatorResult(operation, left, operand, before.flags);
          const after = { ...before, [register]: expected.value, flags: expected.flags, pc: (pc + bytes.length) % 65536 };
          const accesses = bytes.map((value, offset) => ({ kind: "read", address: (pc + offset) % 65536, value }));
          if (address !== undefined) accesses.push({ kind: "read", address, value: operand });
          const cpu = new Cpu6800(ram, before);
          assert.deepEqual(cpu.step(), { before, after, instruction: { address: pc, bytes }, accesses, outcome: "executed" },
            `${name} mode ${mode}, ${left}, ${operand}, flags ${bits}`);
          assert.deepEqual(cpu.snapshot(), after);
          assert.deepEqual(ram.accesses, accesses);
        }
      }
    }
  });

  if (!["sub", "sbc", "cmp", "adc", "add"].includes(operation) || name === "ADDA") continue;
  test(`6800 ${name} matches independent arithmetic for every byte pair and applicable incoming carry`, () => {
    const ram = new Ram(65536);
    // Reuse the CPU through a real five-instruction loop. CMP establishes C before LDA preserves it.
    const load = register === "a" ? 0x86 : 0xc6;
    const compare = register === "a" ? 0x81 : 0xc1;
    const program = [load, 0, compare, 0, load, 0, opcodes[0], 0, 0x20, 0xf6];
    for (const [offset, byte] of program.entries()) ram.write(0x2000 + offset, byte);
    const cpu = new Cpu6800(ram, initialState({ flags: { ...flags(0), h: true, i: true } }));
    const inputs = operation === "adc" || operation === "sbc" ? [0, 1] : [1];
    for (const incoming of inputs) {
      ram.write(0x2003, incoming);
      for (let left = 0; left < 256; left++) {
        ram.write(0x2005, left);
        for (let operand = 0; operand < 256; operand++) {
          ram.write(0x2007, operand);
          for (let step = 0; step < 3; step++) assert.equal(cpu.step().outcome, "executed");
          const before = cpu.snapshot();
          assert.equal(before[register], left);
          assert.equal(before.flags.c, incoming === 1);
          assert.equal(before.flags.i, true);
          if (operation !== "adc" && operation !== "add") assert.equal(before.flags.h, true);
          const expected = accumulatorResult(operation, left, operand, before.flags);
          const record = cpu.step();
          assert.equal(record.outcome, "executed");
          assert.deepEqual(record.after, { ...before, [register]: expected.value, flags: expected.flags, pc: 0x2008 },
            `${name} ${left}, ${operand}, incoming ${incoming}`);
          assert.equal(cpu.step().after.pc, 0x2000);
        }
      }
    }
  });
}

for (const { name, register, opcode, mode } of storeForms) {
  test(`6800 ${name} ${mode} stores every byte with all flag patterns, without reading the destination`, () => {
    const ram = new ObservedRam();
    const pc = 0xfffe;
    const operands = mode === "direct" ? [0x80] : mode === "indexed" ? [0xff] : [0x81, 0x23];
    const address = mode === "direct" ? 0x80 : mode === "indexed" ? 0xef : 0x8123;
    const bytes = [opcode, ...operands];
    for (const [offset, byte] of bytes.entries()) ram.write((pc + offset) % 65536, byte);
    for (let bits = 0; bits < 64; bits++) {
      for (let value = 0; value < 256; value++) {
        ram.write(address, value); // An unchanged value still requires the write.
        ram.accesses.length = 0;
        const before = initialState({ [register]: value, x: 0xfff0, pc, flags: flags(bits) });
        const after = { ...before, flags: loadStoreFlags(value, before.flags), pc: (pc + bytes.length) % 65536 };
        const accesses = [
          ...bytes.map((value, offset) => ({ kind: "read", address: (pc + offset) % 65536, value })),
          { kind: "write", address, value },
        ];
        assert.deepEqual(new Cpu6800(ram, before).step(), {
          before, after, instruction: { address: pc, bytes }, accesses, outcome: "executed",
        });
        assert.deepEqual(ram.accesses, accesses);
      }
    }
  });
}

test("6800 indexed loads and stores add every unsigned displacement to X with sixteen-bit wrapping", () => {
  const ram = new ObservedRam();
  for (const [opcode, register, store] of [[0xa6, "a", false], [0xe6, "b", false], [0xa7, "a", true], [0xe7, "b", true]] as const) {
    ram.write(0x2000, opcode);
    for (const x of [0, 1, 0x7fff, 0xff00, 0xff80, 0xffff]) {
      for (let offset = 0; offset < 256; offset++) {
        const address = (x + offset) % 65536;
        ram.write(0x2001, offset);
        ram.write(address, 0xa5);
        ram.accesses.length = 0;
        const before = initialState({ x, [register]: 0x5a });
        const value = store ? 0x5a : 0xa5;
        const after = { ...before, [register]: value, pc: 0x2002, flags: loadStoreFlags(value, before.flags) };
        const accesses = [
          { kind: "read", address: 0x2000, value: opcode },
          { kind: "read", address: 0x2001, value: offset },
          { kind: store ? "write" : "read", address, value },
        ];
        assert.deepEqual(new Cpu6800(ram, before).step(), {
          before, after, instruction: { address: 0x2000, bytes: [opcode, offset] }, accesses, outcome: "executed",
        });
        assert.deepEqual(ram.accesses, accesses);
      }
    }
  }
});

test("6800 direct loads and stores reach exactly page zero for every address byte, independently of X", () => {
  const ram = new ObservedRam();
  for (const [opcode, register, store] of [[0x96, "a", false], [0xd6, "b", false], [0x97, "a", true], [0xd7, "b", true]] as const) {
    ram.write(0x2000, opcode);
    for (let address = 0; address < 256; address++) {
      ram.write(0x2001, address);
      ram.write(address, 0xa5);
      ram.accesses.length = 0;
      const before = initialState({ x: 0x8000, [register]: 0x5a });
      const record = new Cpu6800(ram, before).step();
      const value = store ? 0x5a : 0xa5;
      assert.equal(record.outcome, "executed");
      assert.deepEqual(record.after, { ...before, [register]: value, pc: 0x2002, flags: loadStoreFlags(value, before.flags) });
      assert.deepEqual(ram.accesses, [
        { kind: "read", address: 0x2000, value: opcode },
        { kind: "read", address: 0x2001, value: address },
        { kind: store ? "write" : "read", address, value },
      ]);
      assert.deepEqual(record.accesses, ram.accesses);
    }
  }
});

test("6800 memory operands may overlap the fetched opcode or address bytes, retaining separate reads", () => {
  const ram = new ObservedRam();
  for (const { register, operation, opcodes } of accumulatorForms) {
    for (const [mode, opcode] of opcodes.entries()) {
      if (mode === 0) continue;
      for (const pc of [0, 0xfffe, 0xffff]) {
        const length = mode === 3 ? 3 : 2;
        for (let slot = 0; slot < length; slot++) {
          const address = (pc + slot) % 65536;
          if (mode === 1 && address > 255) continue;
          const operands = mode === 1 ? [address] : mode === 2 ? [slot] : [Math.floor(address / 256), address % 256];
          const bytes = [opcode, ...operands];
          for (const [offset, value] of bytes.entries()) ram.write((pc + offset) % 65536, value);
          const before = initialState({ pc, x: pc });
          const expected = accumulatorResult(operation, before[register], bytes[slot]!, before.flags);
          ram.accesses.length = 0;
          const record = new Cpu6800(ram, before).step();
          assert.deepEqual(record.after, { ...before, [register]: expected.value, flags: expected.flags, pc: (pc + length) % 65536 });
          assert.deepEqual(record.instruction?.bytes, bytes);
          assert.deepEqual(record.accesses, [
            ...bytes.map((value, offset) => ({ kind: "read", address: (pc + offset) % 65536, value })),
            { kind: "read", address, value: bytes[slot] },
          ]);
          assert.deepEqual(ram.accesses, record.accesses);
        }
      }
    }
  }
});

test("6800 all accumulator stores fetch their complete address before overwriting instruction bytes", () => {
  const ram = new ObservedRam();
  for (const { register, opcode, mode } of storeForms) {
    for (const pc of [0, 0xfffe, 0xffff]) {
      const length = mode === "extended" ? 3 : 2;
      for (let slot = 0; slot < length; slot++) {
        const address = (pc + slot) % 65536;
        if (mode === "direct" && address > 255) continue;
        const operands = mode === "direct" ? [address] : mode === "indexed" ? [slot] : [Math.floor(address / 256), address % 256];
        const bytes = [opcode, ...operands];
        for (const [offset, value] of bytes.entries()) ram.write((pc + offset) % 65536, value);
        ram.accesses.length = 0;
        const before = initialState({ pc, x: pc, [register]: 0x55 });
        const record = new Cpu6800(ram, before).step();
        assert.deepEqual(record.after, { ...before, pc: (pc + length) % 65536, flags: loadStoreFlags(0x55, before.flags) });
        assert.deepEqual(record.instruction?.bytes, bytes);
        assert.deepEqual(record.accesses, [
          ...bytes.map((value, offset) => ({ kind: "read", address: (pc + offset) % 65536, value })),
          { kind: "write", address, value: 0x55 },
        ]);
        assert.deepEqual(ram.accesses, record.accesses);
        assert.equal(ram.read(address), 0x55);
      }
    }
  }
});

test("6800 indexed reads use edited RAM on later instructions and keep earlier records detached", () => {
  const ram = new ObservedRam();
  for (const [offset, value] of [0xa6, 0xff, 0xa6, 0xff].entries()) ram.write(0x2000 + offset, value);
  ram.write(0x7f, 0x33);
  const cpu = new Cpu6800(ram, initialState({ x: 0xff80 }));
  const first = cpu.step();
  const saved = structuredClone(first);
  assert.equal(first.after.a, 0x33);
  ram.write(0x7f, 0x80);
  const second = cpu.step();
  assert.equal(second.after.a, 0x80);
  assert.equal(second.after.flags.n, true);
  assert.deepEqual(second.accesses.at(-1), { kind: "read", address: 0x7f, value: 0x80 });
  cpu.reset();
  ram.write(0x7f, 0);
  assert.deepEqual(first, saved);
});

test("6800 construction and inspection copy only declared state and detach flags without RAM accesses", () => {
  const ram = new ObservedRam();
  const state = initialState();
  const cpu = new Cpu6800(ram, state);
  const first = cpu.snapshot();
  const second = cpu.snapshot();
  const restored = new Cpu6800(ram, first);
  state.a = 0;
  state.flags.h = false;
  Reflect.set(first, "x", 0);
  Reflect.set(first.flags, "c", false);
  assert.deepEqual(second, initialState());
  assert.deepEqual(cpu.snapshot(), second);
  assert.deepEqual(restored.snapshot(), second);
  assert.deepEqual(ram.accesses, []);
});

test("6800 reads each declared getter once, including non-enumerable fields, and ignores metadata", () => {
  const state = initialState();
  const calls = new Map<string, number>();
  for (const [label, object] of [["state", state], ["flags", state.flags]] as const) {
    for (const [name, value] of Object.entries(object)) {
      const key = `${label}.${name}`;
      Object.defineProperty(object, name, { enumerable: false, get: () => {
        calls.set(key, (calls.get(key) ?? 0) + 1);
        return value;
      } });
    }
    for (const name of ["metadata", "d", "cc"]) {
      Object.defineProperty(object, name, { get: () => { throw new Error(`Unexpected ${label}.${name}`); } });
    }
  }
  assert.deepEqual(new Cpu6800(new Ram(0x10000), state).snapshot(), initialState());
  assert.equal(calls.size, 13);
  assert.ok([...calls.values()].every(count => count === 1));
});

test("6800 validates byte accumulators, word registers, Boolean flags, and exactly 64 KiB RAM", () => {
  const ram = new ObservedRam();
  for (const name of ["a", "b", "x", "sp", "pc"] as const) {
    const maximum = name === "a" || name === "b" ? 255 : 65535;
    for (const value of [0, maximum]) assert.equal(new Cpu6800(ram, initialState({ [name]: value })).snapshot()[name], value);
    for (const value of [-1, maximum + 1, 0.5, NaN, Infinity, "00", undefined]) {
      const state = initialState();
      Reflect.set(state, name, value);
      assert.throws(() => new Cpu6800(ram, state), RangeError);
    }
  }
  for (const name of ["h", "i", "n", "z", "v", "c"]) {
    for (const value of [0, 1, "false", undefined]) {
      const state = initialState();
      Reflect.set(state.flags, name, value);
      assert.throws(() => new Cpu6800(ram, state), TypeError);
    }
  }
  for (const size of [1, 0x4000, 0xffff, 0x10001]) {
    assert.throws(() => new Cpu6800(new Ram(size), initialState()), /exactly 64 KiB/);
  }
  assert.deepEqual(ram.accesses, []);
});

for (const [mnemonic, opcode, register] of [["LDAA", 0x86, "a"], ["LDAB", 0xc6, "b"]] as const) {
  test(`6800 ${mnemonic} immediate checks all bytes and incoming flags, preserving H/I/C across wrapped fetches`, () => {
    const ram = new ObservedRam();
    ram.write(0xffff, opcode);
    for (let bits = 0; bits < 64; bits++) {
      for (let value = 0; value < 256; value++) {
        ram.write(0, value);
        ram.accesses.length = 0;
        const before = initialState({ pc: 0xffff, flags: flags(bits) });
        const after = { ...before, [register]: value, pc: 1, flags: loadStoreFlags(value, before.flags) };
        const accesses = [{ kind: "read", address: 0xffff, value: opcode }, { kind: "read", address: 0, value }];
        const cpu = new Cpu6800(ram, before);
        assert.deepEqual(cpu.step(), { before, after, instruction: { address: 0xffff, bytes: [opcode, value] },
          outcome: "executed", accesses });
        assert.deepEqual(cpu.snapshot(), after);
        assert.deepEqual(ram.accesses, accesses);
      }
    }
  });
}

for (const [mnemonic, opcode, source, destination] of [["TAB", 0x16, "a", "b"], ["TBA", 0x17, "b", "a"]] as const) {
  test(`6800 ${mnemonic} copies every byte, updates N/Z/V, and preserves H/I/C and its source`, () => {
    const ram = new ObservedRam();
    ram.write(0xffff, opcode);
    ram.write(0, 0x3f);
    for (let bits = 0; bits < 64; bits++) {
      for (let value = 0; value < 256; value++) {
        const before = initialState({ [source]: value, [destination]: 255 - value, pc: 0xffff, flags: flags(bits) });
        const after = { ...before, [destination]: value, pc: 0, flags: loadStoreFlags(value, before.flags) };
        const cpu = new Cpu6800(ram, before);
        ram.accesses.length = 0;
        const accesses = [{ kind: "read", address: 0xffff, value: opcode }];
        assert.deepEqual(cpu.step(), { before, after, instruction: { address: 0xffff, bytes: [opcode] },
          outcome: "executed", accesses });
        assert.deepEqual(cpu.snapshot(), after);
        assert.deepEqual(ram.accesses, accesses);
      }
    }
  });
}

for (const { name, opcodes: [opcodeA, opcodeB, indexed, extended] } of unaryForms) {
  for (const [form, opcode, register, operands, address] of [
    ["A", opcodeA, "a", [], undefined], ["B", opcodeB, "b", [], undefined],
    ["indexed", indexed, undefined, [0xff], 0x0080],
    ["extended", extended, undefined, [0xff, 0x80], 0xff80],
  ] as const) {
    test(`6800 ${name} ${form} checks every byte and flag pattern, exact accesses, and wrapped fetching`, () => {
      const ram = new ObservedRam();
      const bytes = [opcode, ...operands];
      bytes.forEach((value, offset) => ram.write((0xffff + offset) % 65536, value));
      for (let bits = 0; bits < 64; bits++) {
        for (let value = 0; value < 256; value++) {
          const before = initialState({ pc: 0xffff, x: 0xff81, flags: flags(bits),
            ...(register === undefined ? {} : { [register]: value }) });
          if (address !== undefined) ram.write(address, value);
          const expected = unaryResult(name, value, before.flags);
          const after = { ...before, pc: operands.length, flags: expected.flags,
            ...(register === undefined ? {} : { [register]: expected.result }) };
          const cpu = new Cpu6800(ram, before);
          ram.accesses.length = 0;
          const accesses = [
            ...bytes.map((value, offset) => ({ kind: "read", address: (0xffff + offset) % 65536, value })),
            ...(address === undefined || name === "CLR" ? [] : [{ kind: "read", address, value }]),
            ...(address === undefined || name === "TST" ? [] : [{ kind: "write", address, value: expected.result }]),
          ];
          assert.deepEqual(cpu.step(), { before, after, instruction: { address: 0xffff, bytes },
            outcome: "executed", accesses }, `value=${value}, CC=${bits}`);
          assert.deepEqual(cpu.snapshot(), after);
          assert.deepEqual(ram.accesses, accesses);
          if (address !== undefined) assert.equal(ram.read(address), expected.result);
        }
      }
    });
  }
}

test("6800 ADDA checks every operand pair, ignores incoming carry, and preserves I", () => {
  const ram = new ObservedRam();
  ram.write(0x2000, 0x8b);
  for (const oldFlags of [flags(0), flags(63)]) {
    for (let a = 0; a < 256; a++) {
      for (let operand = 0; operand < 256; operand++) {
        ram.write(0x2001, operand);
        ram.accesses.length = 0;
        const before = initialState({ a, flags: oldFlags });
        const after = { ...before, ...addition(a, operand, oldFlags.i), pc: 0x2002 };
        const accesses = [{ kind: "read", address: 0x2000, value: 0x8b }, { kind: "read", address: 0x2001, value: operand }];
        assert.deepEqual(new Cpu6800(ram, before).step(), { before, after,
          instruction: { address: 0x2000, bytes: [0x8b, operand] }, outcome: "executed", accesses });
        assert.deepEqual(ram.accesses, accesses);
      }
    }
  }
});

test("6800 ADDA replaces H/N/Z/V/C for every incoming flag pattern at arithmetic boundaries", () => {
  const ram = new Ram(0x10000);
  ram.write(0xffff, 0x8b);
  for (let bits = 0; bits < 64; bits++) {
    for (const [a, operand] of [[0, 0], [0, 1], [0x0f, 1], [0x7f, 1], [0x80, 0x80], [0xff, 1], [0xff, 0xff]] as const) {
      ram.write(0, operand);
      const before = initialState({ a, flags: flags(bits), pc: 0xffff });
      const after = { ...before, ...addition(a, operand, before.flags.i), pc: 1 };
      assert.deepEqual(new Cpu6800(ram, before).step(), { before, after,
        instruction: { address: 0xffff, bytes: [0x8b, operand] }, outcome: "executed",
        accesses: [{ kind: "read", address: 0xffff, value: 0x8b }, { kind: "read", address: 0, value: operand }] });
    }
  }
});

for (const { mnemonic, opcode, register, truth, stores } of immediateLogic) {
  test(`6800 ${mnemonic} immediate matches an independent truth table for every operand pair`, () => {
    const ram = new ObservedRam();
    ram.write(0x2000, opcode);
    for (const oldFlags of [flags(0), flags(63)]) {
      for (let left = 0; left < 256; left++) {
        for (let operand = 0; operand < 256; operand++) {
          ram.write(0x2001, operand);
          ram.accesses.length = 0;
          const result = logicalResult(left, operand, truth);
          const before = initialState({ [register]: left, flags: oldFlags });
          const after = { ...before, [register]: stores ? result : left, pc: 0x2002,
            flags: { ...oldFlags, n: result >= 128, z: result === 0, v: false } };
          const accesses = [{ kind: "read", address: 0x2000, value: opcode }, { kind: "read", address: 0x2001, value: operand }];
          const cpu = new Cpu6800(ram, before);
          assert.deepEqual(cpu.step(), { before, after, instruction: { address: 0x2000, bytes: [opcode, operand] },
            outcome: "executed", accesses });
          assert.deepEqual(cpu.snapshot(), after);
          assert.deepEqual(ram.accesses, accesses);
        }
      }
    }
  });

  test(`6800 ${mnemonic} preserves H/I/C for all flag patterns and wraps either instruction fetch`, () => {
    const ram = new ObservedRam();
    for (const pc of [0x2000, 0xfffe, 0xffff]) {
      const operandAddress = (pc + 1) % 65536;
      ram.write(pc, opcode);
      for (let bits = 0; bits < 64; bits++) {
        for (const left of [0, 1, 0x55, 0x7f, 0x80, 0xaa, 0xff]) {
          for (const operand of [0, 1, 0x55, 0x7f, 0x80, 0xaa, 0xff]) {
            ram.write(operandAddress, operand);
            ram.accesses.length = 0;
            const result = logicalResult(left, operand, truth);
            const before = initialState({ [register]: left, pc, flags: flags(bits) });
            const after = { ...before, [register]: stores ? result : left, pc: (pc + 2) % 65536,
              flags: { ...before.flags, n: result >= 128, z: result === 0, v: false } };
            const accesses = [{ kind: "read", address: pc, value: opcode }, { kind: "read", address: operandAddress, value: operand }];
            assert.deepEqual(new Cpu6800(ram, before).step(), { before, after,
              instruction: { address: pc, bytes: [opcode, operand] }, outcome: "executed", accesses });
            assert.deepEqual(ram.accesses, accesses);
          }
        }
      }
    }
  });
}

test("6800 logic resumes after replacing an unsupported form and reads current operands while retaining old records", () => {
  for (const { opcode, register, truth, stores } of immediateLogic) {
    const ram = new ObservedRam();
    ram.write(0xfffe, 0x83); // Unassigned on the original 6800.
    ram.write(0xffff, 0xff);
    const cpu = new Cpu6800(ram, initialState({ [register]: 0x81, pc: 0xfffe }));
    const initial = cpu.snapshot();
    ram.accesses.length = 0;
    const rejectedAccesses = [{ kind: "read", address: 0xfffe, value: 0x83 }];
    assert.deepEqual(cpu.step(), { before: initial, after: initial,
      instruction: { address: 0xfffe, bytes: [0x83] }, outcome: "unsupported", reason: "opcode", accesses: rejectedAccesses });
    assert.deepEqual(ram.accesses, rejectedAccesses);
    ram.write(0xfffe, opcode);
    const first = cpu.step();
    const saved = structuredClone(first);
    const firstResult = logicalResult(0x81, 0xff, truth);
    const before = { ...initial, [register]: stores ? firstResult : 0x81, pc: 0,
      flags: { ...initial.flags, n: firstResult >= 128, z: firstResult === 0, v: false } };
    assert.deepEqual(first.after, before);
    ram.write(0, opcode);
    ram.write(1, 0x80);
    ram.accesses.length = 0;
    const result = logicalResult(before[register], 0x80, truth);
    const after = { ...before, [register]: stores ? result : before[register], pc: 2,
      flags: { ...before.flags, n: result >= 128, z: result === 0, v: false } };
    const accesses = [{ kind: "read", address: 0, value: opcode }, { kind: "read", address: 1, value: 0x80 }];
    assert.deepEqual(cpu.step(), { before, after, instruction: { address: 0, bytes: [opcode, 0x80] }, outcome: "executed", accesses });
    assert.deepEqual(ram.accesses, accesses);
    ram.write(0xffff, 0);
    cpu.reset();
    assert.deepEqual(first, saved);
  }
});

test("6800 STAA extended records unchanged-value writes for every byte and flag pattern without reading the destination", () => {
  const ram = new ObservedRam();
  ram.write(0x2000, 0xb7);
  ram.write(0x2001, 0x12);
  ram.write(0x2002, 0x34);
  for (let bits = 0; bits < 64; bits++) {
    for (let a = 0; a < 256; a++) {
      ram.write(0x1234, a);
      ram.accesses.length = 0;
      const before = initialState({ a, flags: flags(bits) });
      const after = { ...before, pc: 0x2003, flags: loadStoreFlags(a, before.flags) };
      const accesses = [{ kind: "read", address: 0x2000, value: 0xb7 },
        { kind: "read", address: 0x2001, value: 0x12 }, { kind: "read", address: 0x2002, value: 0x34 },
        { kind: "write", address: 0x1234, value: a }];
      assert.deepEqual(new Cpu6800(ram, before).step(), { before, after,
        instruction: { address: 0x2000, bytes: [0xb7, 0x12, 0x34] }, outcome: "executed", accesses });
      assert.deepEqual(ram.accesses, accesses);
      assert.equal(ram.read(0x1234), a);
    }
  }
});

test("6800 STAA reaches every address using high-byte-first operands, including stores over its own bytes", () => {
  const ram = new ObservedRam();
  const before = initialState({ a: 0xa5 });
  const after = { ...before, pc: 0x2003, flags: loadStoreFlags(0xa5, before.flags) };
  for (let address = 0; address < 0x10000; address++) {
    const high = Math.floor(address / 256);
    const low = address % 256;
    ram.write(0x2000, 0xb7);
    ram.write(0x2001, high);
    ram.write(0x2002, low);
    ram.accesses.length = 0;
    const accesses = [{ kind: "read", address: 0x2000, value: 0xb7 },
      { kind: "read", address: 0x2001, value: high }, { kind: "read", address: 0x2002, value: low },
      { kind: "write", address, value: 0xa5 }];
    assert.deepEqual(new Cpu6800(ram, before).step(), { before, after,
      instruction: { address: 0x2000, bytes: [0xb7, high, low] }, outcome: "executed", accesses });
    assert.deepEqual(ram.accesses, accesses);
    assert.equal(ram.read(address), 0xa5);
  }
});

test("6800 opcode and operand fetches advance from every PC and wrap at sixteen bits", () => {
  const ram = new Ram(0x10000);
  for (let pc = 0; pc < 0x10000; pc++) {
    const operandAddress = (pc + 1) % 0x10000;
    ram.write(pc, 0x86);
    ram.write(operandAddress, 0xa5);
    const before = initialState({ pc });
    assert.deepEqual(new Cpu6800(ram, before).step(), { before,
      after: { ...before, a: 0xa5, pc: (pc + 2) % 0x10000, flags: loadStoreFlags(0xa5, before.flags) },
      instruction: { address: pc, bytes: [0x86, 0xa5] }, outcome: "executed",
      accesses: [{ kind: "read", address: pc, value: 0x86 }, { kind: "read", address: operandAddress, value: 0xa5 }] });
  }
});

test("6800 extended stores wrap across either operand fetch and preserve recorded bytes when overwriting them", () => {
  const ram = new ObservedRam();
  for (const [pc, highAt, lowAt, nextPc] of [[0xfffd, 0xfffe, 0xffff, 0], [0xfffe, 0xffff, 0, 1], [0xffff, 0, 1, 2]] as const) {
    ram.write(pc, 0xb7);
    ram.write(highAt, 0xff);
    ram.write(lowAt, 0xff);
    ram.accesses.length = 0;
    const before = initialState({ pc });
    const accesses = [{ kind: "read", address: pc, value: 0xb7 }, { kind: "read", address: highAt, value: 0xff },
      { kind: "read", address: lowAt, value: 0xff }, { kind: "write", address: 0xffff, value: before.a }];
    assert.deepEqual(new Cpu6800(ram, before).step(), { before,
      after: { ...before, pc: nextPc, flags: loadStoreFlags(before.a, before.flags) },
      instruction: { address: pc, bytes: [0xb7, 0xff, 0xff] }, outcome: "executed", accesses });
    assert.deepEqual(ram.accesses, accesses);
    assert.equal(ram.read(0xffff), before.a);
  }
});

test("6800 NOP and CLC/SEC/CLV/SEV/CLI/SEI preserve unrelated state for all flags and wrapped PCs", () => {
  const ram = new ObservedRam();
  for (const [opcode, changedFlag, value] of [[0x01, undefined, false], [0x0a, "v", false],
    [0x0b, "v", true], [0x0c, "c", false], [0x0d, "c", true], [0x0e, "i", false], [0x0f, "i", true]] as const) {
    for (let bits = 0; bits < 64; bits++) {
      for (const pc of [0x2000, 0xffff]) {
        const before = initialState({ pc, flags: flags(bits) });
        const after = { ...before, pc: (pc + 1) % 65536,
          flags: changedFlag ? { ...before.flags, [changedFlag]: value } : before.flags };
        ram.write(pc, opcode);
        ram.accesses.length = 0;
        const accesses = [{ kind: "read", address: pc, value: opcode }];
        assert.deepEqual(new Cpu6800(ram, before).step(), { before, after, instruction: { address: pc, bytes: [opcode] }, outcome: "executed", accesses });
        assert.deepEqual(ram.accesses, accesses);
      }
    }
  }
});

test("6800 TAP/TPA cover every accumulator and flag pattern, ignoring A's upper bits and packing them as ones", () => {
  const ram = new ObservedRam();
  for (const opcode of [0x06, 0x07]) {
    ram.write(0xffff, opcode);
    for (let a = 0; a < 256; a++) {
      for (let bits = 0; bits < 64; bits++) {
        const before = initialState({ a, pc: 0xffff, flags: flags(bits) });
        const after = opcode === 0x06 ? { ...before, pc: 0, flags: flags(a % 64) } : { ...before, pc: 0, a: 192 + bits };
        ram.accesses.length = 0;
        const accesses = [{ kind: "read", address: 0xffff, value: opcode }];
        assert.deepEqual(new Cpu6800(ram, before).step(), { before, after, instruction: { address: 0xffff, bytes: [opcode] }, outcome: "executed", accesses });
        assert.deepEqual(ram.accesses, accesses);
      }
    }
  }
});

for (const { name, opcode, source, destination, delta, setsZero } of pointerOperations) {
  test(`6800 ${name} checks every pointer value, all flags at boundaries, and no memory stack access`, () => {
    const ram = new ObservedRam();
    ram.write(0xffff, opcode);
    for (let value = 0; value < 65536; value++) {
      const patterns = [0, 1, 0xff, 0x100, 0x7fff, 0x8000, 0xfffe, 0xffff].includes(value)
        ? Array.from({ length: 64 }, (_, bits) => bits) : [value % 64];
      for (const bits of patterns) {
        const before = initialState({ [source]: value, pc: 0xffff, flags: flags(bits) });
        const result = (value + delta + 65536) % 65536;
        const after = { ...before, [destination]: result, pc: 0,
          flags: setsZero ? { ...before.flags, z: result === 0 } : before.flags };
        ram.accesses.length = 0;
        const accesses = [{ kind: "read", address: 0xffff, value: opcode }];
        assert.deepEqual(new Cpu6800(ram, before).step(), { before, after, instruction: { address: 0xffff, bytes: [opcode] }, outcome: "executed", accesses });
        assert.deepEqual(ram.accesses, accesses);
      }
    }
  });
}

for (const { name, opcode, operation } of interAccumulator) {
  test(`6800 ${name} checks every accumulator pair, ignores incoming C, and preserves B`, () => {
    const ram = new ObservedRam();
    ram.write(0xffff, opcode);
    for (let a = 0; a < 256; a++) {
      for (let b = 0; b < 256; b++) {
        const patterns = [0, 1, 0x7f, 0x80, 0xff].includes(a) && [0, 1, 0x7f, 0x80, 0xff].includes(b)
          ? Array.from({ length: 64 }, (_, bits) => bits) : [(a + b) % 64];
        for (const bits of patterns) {
          const before = initialState({ a, b, pc: 0xffff, flags: flags(bits) });
          const expected = accumulatorResult(operation, a, b, before.flags);
          const after = { ...before, a: expected.value, flags: expected.flags, pc: 0 };
          ram.accesses.length = 0;
          const accesses = [{ kind: "read", address: 0xffff, value: opcode }];
          assert.deepEqual(new Cpu6800(ram, before).step(), { before, after, instruction: { address: 0xffff, bytes: [opcode] }, outcome: "executed", accesses });
          assert.deepEqual(ram.accesses, accesses);
        }
      }
    }
  });
}

test("6800 DAA follows every documented adjustment-table row for all unaffected flag patterns", () => {
  // Motorola Appendix A: carry in, upper range, H in, lower range, correction, carry out.
  const rows = [
    [0, 0, 9, 0, 0, 9, 0x00, 0], [0, 0, 8, 0, 10, 15, 0x06, 0], [0, 0, 9, 1, 0, 3, 0x06, 0],
    [0, 10, 15, 0, 0, 9, 0x60, 1], [0, 9, 15, 0, 10, 15, 0x66, 1], [0, 10, 15, 1, 0, 3, 0x66, 1],
    [1, 0, 2, 0, 0, 9, 0x60, 1], [1, 0, 2, 0, 10, 15, 0x66, 1], [1, 0, 3, 1, 0, 3, 0x66, 1],
  ] as const;
  const ram = new ObservedRam();
  ram.write(0xffff, 0x19);
  for (const [carry, highMin, highMax, half, lowMin, lowMax, correction, carryOut] of rows) {
    for (let high = highMin; high <= highMax; high++) {
      for (let low = lowMin; low <= lowMax; low++) {
        for (let bits = 0; bits < 16; bits++) {
          const before = initialState({ a: high * 16 + low, pc: 0xffff,
            flags: { ...flags(bits * 2), h: Boolean(half), c: Boolean(carry) } });
          const a = (before.a + correction) % 256;
          const after = { ...before, a, pc: 0, flags: { ...before.flags, n: a >= 128, z: a === 0, v: false, c: Boolean(carryOut) } };
          ram.accesses.length = 0;
          const accesses = [{ kind: "read", address: 0xffff, value: 0x19 }];
          assert.deepEqual(new Cpu6800(ram, before).step(), { before, after, instruction: { address: 0xffff, bytes: [0x19] }, outcome: "executed", accesses });
          assert.deepEqual(ram.accesses, accesses);
        }
      }
    }
  }
});

for (const [name, opcode, immediate] of [["ABA", 0x1b, false], ["ADDA", 0x8b, true], ["ADCA", 0x89, true]] as const) {
  test(`6800 ${name} followed by DAA gives the decimal sum for every BCD pair and applicable carry`, () => {
    const bcd = (decimal: number) => Math.floor(decimal / 10) * 16 + decimal % 10;
    const ram = new Ram(65536);
    ram.write(0x2000, opcode);
    const adjustAt = immediate ? 0x2002 : 0x2001;
    ram.write(adjustAt, 0x19);
    for (let left = 0; left < 100; left++) {
      for (let right = 0; right < 100; right++) {
        for (const carry of [false, true]) {
          const before = initialState({ a: bcd(left), b: bcd(right), flags: { ...flags((left + right) % 64), c: carry } });
          if (immediate) ram.write(0x2001, bcd(right));
          const cpu = new Cpu6800(ram, before);
          const added = cpu.step().after;
          const total = left + right + Number(name === "ADCA" && carry);
          const a = bcd(total % 100);
          assert.deepEqual(cpu.step().after, { ...added, a, pc: adjustAt + 1,
            flags: { ...added.flags, n: a >= 128, z: a === 0, v: false, c: total >= 100 } });
        }
      }
    }
  });
}

test("6800 DAA deterministically extends correction rules to non-BCD states, preserving H/I and clearing undefined V", () => {
  const ram = new Ram(65536);
  ram.write(0x2000, 0x19);
  for (const [a, h, c, result, carry] of [[0x00, true, false, 0x06, false], [0x94, true, false, 0x9a, false],
    [0x9a, true, false, 0x00, true], [0x9f, true, false, 0x05, true], [0xf9, true, false, 0x5f, true], [0xff, true, true, 0x65, true]] as const) {
    const before = initialState({ a, flags: { ...flags(63), h, c } });
    assert.deepEqual(new Cpu6800(ram, before).step().after, { ...before, a: result, pc: 0x2001,
      flags: { ...before.flags, n: result >= 128, z: result === 0, v: false, c: carry } });
  }
});

for (const form of wordForms) {
  test(`6800 ${form.name} opcode ${form.opcode.toString(16)} checks word boundaries, all flags, and wrapped fetching`, () => {
    const ram = new ObservedRam();
    for (const value of [0, 1, 0xff, 0x100, 0x7fff, 0x8000, 0xff00, 0xffff]) {
      for (let bits = 0; bits < 64; bits++) {
        const before = initialState({ x: 0x7f20, flags: flags(bits), pc: [0x2000, 0xfffd, 0xfffe, 0xffff][bits % 4]! });
        if (form.operation === "store") before[form.register] = value;
        checkWordInstruction(ram, form, before, value, form.mode === 3 ? 0x80ff : 0x80);
      }
    }
  });
}

test("6800 word memory forms check every direct address and indexed offset, page crossing, wrapping, and code overlap", () => {
  const ram = new ObservedRam();
  for (const form of wordForms) {
    if (form.mode === 0) continue;
    if (form.mode === 1 || form.mode === 2) {
      for (const x of form.mode === 1 ? [0x3456] : [0, 0x7fff, 0xff80, 0xffff]) {
        for (let offset = 0; offset < 256; offset++) {
          checkWordInstruction(ram, form, initialState({ x, flags: flags(offset % 64) }), 0xa55a, offset);
        }
      }
    } else {
      for (const address of [0, 0xff, 0x100, 0x7fff, 0xffff]) checkWordInstruction(ram, form, initialState(), 0xa55a, address);
    }
    for (const pc of [0, 0xff, 0x2000, 0xfffd, 0xfffe, 0xffff]) {
      for (const offset of [-1, 0, 1, 2]) {
        const address = (pc + offset + 65536) % 65536;
        if (form.mode === 1 && address > 255) continue;
        const before = initialState({ pc, x: (address + 65536 - 128) % 65536 });
        checkWordInstruction(ram, form, before, 0x8001, form.mode === 2 ? 0x80 : address);
      }
    }
  }
});

for (const form of wordForms.filter(form => form.operation === "store" && form.mode === 3)) {
  test(`6800 ${form.name} stores every word high first across FFFF, including unchanged-value writes`, () => {
    const ram = new ObservedRam();
    for (let value = 0; value < 65536; value++) {
      const before = initialState({ [form.register]: value, flags: flags(value % 64) });
      checkWordInstruction(ram, form, before, value, 0xffff);
    }
  });
}

test("6800 comparisons retain completed fetches and unchanged flags at every failed read, including wrapped and overlapping operands", () => {
  const failure = new Error("comparison read failure");
  class FaultRam extends ObservedRam {
    failAt = -1; attempts = 0;
    override read(address: number): number { if (this.attempts++ === this.failAt) throw failure; return super.read(address); }
  }
  for (const [register, opcodes] of [["a", [0x81, 0x91, 0xa1, 0xb1]], ["b", [0xc1, 0xd1, 0xe1, 0xf1]], ["x", indexComparisons]] as const) {
    const word = register === "x";
    for (const [mode, opcode] of opcodes.entries()) for (const pc of [0x2000, 0xfffe, 0xffff]) for (const bits of [0, 63]) {
      const cases = mode === 2 ? Array.from({ length: 256 }, (_, offset) => offset) : [mode === 1 ? 0xff : 0xffff];
      for (const location of cases) {
        const before = initialState({ pc, x: 0xffff, flags: flags(bits) });
        const address = mode === 0 ? undefined : mode === 2 ? (before.x + location) % 65536 : location;
        const bytes = [opcode, ...(mode === 0 ? (word ? [0x80, 1] : [0x80]) : mode === 3 ? [0xff, 0xff] : [location])];
        const image = new Map<number, number>();
        if (address !== undefined) { image.set(address, 0x80); if (word) image.set((address + 1) % 65536, 1); }
        bytes.forEach((byte, i) => image.set((pc + i) % 65536, byte)); // Fetched code wins when it overlaps data.
        const operand = address === undefined ? (word ? 0x8001 : 0x80)
          : image.get(address)! * (word ? 256 : 1) + (word ? image.get((address + 1) % 65536)! : 0);
        const expected = word ? indexComparison(before.x, operand, before.flags) : accumulatorResult("cmp", before[register], operand, before.flags).flags;
        const accesses = [
          ...bytes.map((value, i) => ({ kind: "read", address: (pc + i) % 65536, value })),
          ...(address === undefined ? [] : (word ? [address, (address + 1) % 65536] : [address])
            .map(address => ({ kind: "read", address, value: image.get(address)! }))),
        ];
        // Check every indexed offset; inject each failure at boundary offsets and in all other modes.
        const failures = mode === 2 && ![0, 1, 127, 128, 255].includes(location) ? [-1] : [-1, ...accesses.map((_, i) => i)];
        for (const failAt of failures) {
          const ram = new FaultRam();
          for (const [address, value] of image) ram.write(address, value);
          const cpu = new Cpu6800(ram, before);
          ram.accesses.length = 0; ram.attempts = 0; ram.failAt = failAt;
          const completed = failAt < 0 ? accesses.length : failAt;
          const after = { ...before, pc: (pc + Math.min(completed, bytes.length)) % 65536,
            flags: failAt < 0 ? expected : before.flags };
          if (failAt >= 0) assert.throws(() => cpu.step(), error => error === failure);
          else assert.deepEqual(cpu.step(), { before, after, instruction: { address: pc, bytes }, accesses, outcome: "executed" });
          assert.deepEqual(cpu.snapshot(), after, `${register}, bytes=${bytes}, failAt=${failAt}`);
          assert.deepEqual(ram.accesses, accesses.slice(0, completed));
        }
      }
    }
  }
});

test("6800 CPX checks every high-byte pair with low-byte equality and borrow, preserving C", () => {
  const ram = new Ram(65536);
  ram.write(0x2000, 0x8c);
  for (let left = 0; left < 256; left++) {
    for (let right = 0; right < 256; right++) {
      for (const [lowX, lowOperand] of [[0, 0], [0, 255], [255, 0], [255, 255]] as const) {
        const operand = right * 256 + lowOperand;
        const before = initialState({ x: left * 256 + lowX, flags: flags((left + right + lowOperand) % 64) });
        ram.write(0x2001, right);
        ram.write(0x2002, lowOperand);
        assert.deepEqual(new Cpu6800(ram, before).step().after,
          { ...before, pc: 0x2003, flags: indexComparison(before.x, operand, before.flags) });
      }
    }
  }
});

for (const { name, register, opcodes } of wordLoads) {
  test(`6800 ${name} immediate loads every word high-byte first and uses bit 15 and the whole word for N/Z`, () => {
    const ram = new ObservedRam();
    ram.write(0xffff, opcodes[0]);
    for (let value = 0; value < 0x10000; value++) {
      const high = Math.floor(value / 256), low = value % 256;
      ram.write(0, high);
      ram.write(1, low);
      ram.accesses.length = 0;
      const before = initialState({ pc: 0xffff, flags: flags(value % 64) });
      const after = { ...before, [register]: value, pc: 2,
        flags: { ...before.flags, n: value >= 0x8000, z: value === 0, v: false } };
      const accesses = [{ kind: "read", address: 0xffff, value: opcodes[0] },
        { kind: "read", address: 0, value: high }, { kind: "read", address: 1, value: low }];
      assert.deepEqual(new Cpu6800(ram, before).step(), { before, after,
        instruction: { address: 0xffff, bytes: [opcodes[0], high, low] }, outcome: "executed", accesses });
      assert.deepEqual(ram.accesses, accesses);
    }
  });
}

test("6800 LDS replaces N/Z/V while preserving H/I/C for every flag pattern at word boundaries", () => {
  const ram = new Ram(0x10000);
  for (const pc of [0x2000, 0xfffd, 0xfffe, 0xffff]) {
    for (let bits = 0; bits < 64; bits++) {
      for (const value of [0, 1, 0x7f, 0x80, 0xff, 0x100, 0x7fff, 0x8000, 0xff00, 0xffff]) {
        ram.write(pc, 0x8e);
        ram.write((pc + 1) % 0x10000, Math.floor(value / 256));
        ram.write((pc + 2) % 0x10000, value % 256);
        const before = initialState({ pc, flags: flags(bits) });
        assert.deepEqual(new Cpu6800(ram, before).step().after, { ...before, sp: value, pc: (pc + 3) % 0x10000,
          flags: { ...before.flags, n: value >= 0x8000, z: value === 0, v: false } });
      }
    }
  }
});

for (const [mnemonic, opcode, register, push] of [
  ["PULA", 0x32, "a", false], ["PULB", 0x33, "b", false],
  ["PSHA", 0x36, "a", true], ["PSHB", 0x37, "b", true],
] as const) {
  test(`6800 ${mnemonic} covers every byte and flag pattern, preserving all flags across SP and PC wrap`, () => {
    const ram = new ObservedRam();
    ram.write(0xffff, opcode);
    for (let bits = 0; bits < 64; bits++) {
      for (let value = 0; value < 256; value++) {
        const before = initialState({ [register]: push ? value : 255 - value, pc: 0xffff,
          sp: push ? 0 : 0xffff, flags: flags(bits) });
        ram.write(0, push && bits % 2 === 0 ? 255 - value : value);
        ram.accesses.length = 0;
        const after = { ...before, [register]: value, pc: 0, sp: push ? 0xffff : 0 };
        const accesses = [{ kind: "read", address: 0xffff, value: opcode }, { kind: push ? "write" : "read", address: 0, value }];
        assert.deepEqual(new Cpu6800(ram, before).step(), { before, after,
          instruction: { address: 0xffff, bytes: [opcode] }, outcome: "executed", accesses });
        assert.deepEqual(ram.accesses, accesses);
        assert.equal(ram.read(0), value);
      }
    }
  });

  test(`6800 ${mnemonic} uses every full-width SP, including stack accesses overlapping its opcode`, () => {
    const ram = new ObservedRam();
    for (let sp = 0; sp < 0x10000; sp++) {
      const address = push ? sp : (sp + 1) % 0x10000;
      const byte = sp % 256;
      ram.write(address, byte);
      ram.write(0x2000, opcode);
      ram.accesses.length = 0;
      const value = !push && address === 0x2000 ? opcode : byte;
      const before = initialState({ [register]: push ? value : 255 - value, sp });
      const after = { ...before, [register]: value, pc: 0x2001, sp: (sp + (push ? 65535 : 1)) % 65536 };
      const accesses = [{ kind: "read", address: 0x2000, value: opcode }, { kind: push ? "write" : "read", address, value }];
      assert.deepEqual(new Cpu6800(ram, before).step(), { before, after,
        instruction: { address: 0x2000, bytes: [opcode] }, outcome: "executed", accesses });
      assert.deepEqual(ram.accesses, accesses);
      assert.equal(ram.read(address), value);
    }
  });
}

test("6800 BSR covers all displacements and flags, stacking the fall-through PC low-byte first before branching", () => {
  const ram = new ObservedRam();
  for (const pc of [0, 0x12fe, 0xfffe, 0xffff]) {
    for (let bits = 0; bits < 64; bits++) {
      for (let displacement = 0; displacement < 256; displacement++) {
        const operandAddress = (pc + 1) % 65536;
        const returnAddress = (pc + 2) % 65536;
        const target = (returnAddress + (displacement < 128 ? displacement : displacement - 256) + 65536) % 65536;
        ram.write(pc, 0x8d);
        ram.write(operandAddress, displacement);
        ram.accesses.length = 0;
        const before = initialState({ pc, sp: 0, flags: flags(bits) });
        const after = { ...before, pc: target, sp: 0xfffe };
        const accesses = [{ kind: "read", address: pc, value: 0x8d }, { kind: "read", address: operandAddress, value: displacement },
          { kind: "write", address: 0, value: returnAddress % 256 }, { kind: "write", address: 0xffff, value: Math.floor(returnAddress / 256) }];
        assert.deepEqual(new Cpu6800(ram, before).step(), { before, after,
          instruction: { address: pc, bytes: [0x8d, displacement] }, outcome: "executed", accesses });
        assert.deepEqual(ram.accesses, accesses);
        assert.equal(ram.read(0), returnAddress % 256);
        assert.equal(ram.read(0xffff), Math.floor(returnAddress / 256));
      }
    }
  }
});

test("6800 JSR extended reaches every target and saves the address after all three instruction bytes", () => {
  const ram = new ObservedRam();
  ram.write(0x2000, 0xbd);
  for (let target = 0; target < 65536; target++) {
    const high = Math.floor(target / 256), low = target % 256;
    ram.write(0x2001, high);
    ram.write(0x2002, low);
    ram.accesses.length = 0;
    const before = initialState({ sp: 0x1000, flags: flags(target % 64) });
    const after = { ...before, pc: target, sp: 0x0ffe };
    const accesses = [{ kind: "read", address: 0x2000, value: 0xbd }, { kind: "read", address: 0x2001, value: high },
      { kind: "read", address: 0x2002, value: low }, { kind: "write", address: 0x1000, value: 3 },
      { kind: "write", address: 0x0fff, value: 0x20 }];
    assert.deepEqual(new Cpu6800(ram, before).step(), { before, after,
      instruction: { address: 0x2000, bytes: [0xbd, high, low] }, outcome: "executed", accesses });
    assert.deepEqual(ram.accesses, accesses);
  }
});

test("6800 JSR fetches both target bytes before overlapping stack writes, preserves all flags, and wraps PC and SP", () => {
  const ram = new ObservedRam();
  for (const [pc, highAt, lowAt, returnAddress] of [
    [0x2000, 0x2001, 0x2002, 0x2003], [0xfffd, 0xfffe, 0xffff, 0],
    [0xfffe, 0xffff, 0, 1], [0xffff, 0, 1, 2],
  ] as const) {
    for (const sp of [0, 1, 0xffff, pc, highAt, lowAt]) {
      for (let bits = 0; bits < 64; bits++) {
        for (const target of [0, 0xffff, pc, highAt, lowAt, sp]) {
          const high = Math.floor(target / 256), low = target % 256;
          const highStackAddress = (sp + 65535) % 65536;
          ram.write(pc, 0xbd);
          ram.write(highAt, high);
          ram.write(lowAt, low);
          ram.accesses.length = 0;
          const before = initialState({ pc, sp, flags: flags(bits) });
          const after = { ...before, pc: target, sp: (sp + 65534) % 65536 };
          const accesses = [{ kind: "read", address: pc, value: 0xbd }, { kind: "read", address: highAt, value: high },
            { kind: "read", address: lowAt, value: low }, { kind: "write", address: sp, value: returnAddress % 256 },
            { kind: "write", address: highStackAddress, value: Math.floor(returnAddress / 256) }];
          assert.deepEqual(new Cpu6800(ram, before).step(), { before, after,
            instruction: { address: pc, bytes: [0xbd, high, low] }, outcome: "executed", accesses });
          assert.deepEqual(ram.accesses, accesses);
          assert.equal(ram.read(sp), returnAddress % 256);
          assert.equal(ram.read(highStackAddress), Math.floor(returnAddress / 256));
        }
      }
    }
  }
});

for (const [name, opcode, indexed, call] of [["JMP indexed", 0x6e, true, false],
  ["JMP extended", 0x7e, false, false], ["JSR indexed", 0xad, true, true]] as const) {
  test(`6800 ${name} checks address and fetch wrapping, current X, flags, and stack/code overlap without target reads`, () => {
    const ram = new ObservedRam();
    for (const base of [0, 0xff, 0x100, 0x7fff, 0x8000, 0xff80, 0xffff]) {
      for (let offset = 0; offset < 256; offset++) {
        for (const pc of [0x2000, 0xfffe, 0xffff]) {
          const target = (base + offset) % 65536;
          const bytes = indexed ? [opcode, offset] : [opcode, Math.floor(target / 256), target % 256];
          const sp = [0, 1, 0xffff, pc, (pc + 1) % 65536, (pc + 2) % 65536, 0x789a][offset % 7]!;
          const before = initialState({ pc, x: base, sp, flags: flags(offset % 64) });
          for (const [index, byte] of bytes.entries()) ram.write((pc + index) % 65536, byte);
          ram.accesses.length = 0;
          const accesses: Cpu6800MemoryAccess[] = bytes.map((value, index) => ({ kind: "read", address: (pc + index) % 65536, value }));
          const returnAddress = (pc + bytes.length) % 65536;
          if (call) accesses.push({ kind: "write", address: sp, value: returnAddress % 256 },
            { kind: "write", address: (sp + 65535) % 65536, value: Math.floor(returnAddress / 256) });
          const after = { ...before, pc: target, sp: call ? (sp + 65534) % 65536 : sp };
          const cpu = new Cpu6800(ram, before);
          assert.deepEqual(cpu.step(), { before, after, instruction: { address: pc, bytes }, outcome: "executed", accesses });
          assert.deepEqual(cpu.snapshot(), after);
          assert.deepEqual(ram.accesses, accesses);
          if (call) {
            assert.equal(ram.read(sp), returnAddress % 256);
            assert.equal(ram.read((sp + 65535) % 65536), Math.floor(returnAddress / 256));
          }
        }
      }
    }
  });
}

test("6800 JMP extended reaches every destination with no data read", () => {
  const ram = new ObservedRam();
  ram.write(0x2000, 0x7e);
  for (let target = 0; target < 65536; target++) {
    const high = Math.floor(target / 256), low = target % 256;
    ram.write(0x2001, high);
    ram.write(0x2002, low);
    const before = initialState({ flags: flags(target % 64) });
    ram.accesses.length = 0;
    const accesses = [{ kind: "read", address: 0x2000, value: 0x7e },
      { kind: "read", address: 0x2001, value: high }, { kind: "read", address: 0x2002, value: low }];
    assert.deepEqual(new Cpu6800(ram, before).step(), { before, after: { ...before, pc: target },
      instruction: { address: 0x2000, bytes: [0x7e, high, low] }, accesses, outcome: "executed" });
    assert.deepEqual(ram.accesses, accesses);
  }
});

test("6800 TAP restores the live flags used by later arithmetic and TPA without changing retained records", () => {
  const ram = new Ram(65536);
  for (const [offset, byte] of [0x06, 0x89, 0, 0x07].entries()) ram.write(0x2000 + offset, byte);
  const before = initialState({ a: 1, flags: flags(62) });
  const cpu = new Cpu6800(ram, before);
  const tap = cpu.step();
  const saved = structuredClone(tap);
  assert.deepEqual(tap.after, { ...before, pc: 0x2001, flags: flags(1) });
  assert.deepEqual(cpu.step().after, { ...before, a: 2, pc: 0x2003, flags: flags(0) });
  assert.deepEqual(cpu.step().after, { ...before, a: 0xc0, pc: 0x2004, flags: flags(0) });
  assert.deepEqual(tap, saved);
});

test("6800 RTS pulls every return address high-byte first from RAM without a preceding call", () => {
  const ram = new ObservedRam();
  ram.write(0x2000, 0x39);
  for (let target = 0; target < 65536; target++) {
    const high = Math.floor(target / 256), low = target % 256;
    ram.write(0, high);
    ram.write(1, low);
    ram.accesses.length = 0;
    const before = initialState({ sp: 0xffff, flags: flags(target % 64) });
    const after = { ...before, pc: target, sp: 1 };
    const accesses = [{ kind: "read", address: 0x2000, value: 0x39 },
      { kind: "read", address: 0, value: high }, { kind: "read", address: 1, value: low }];
    assert.deepEqual(new Cpu6800(ram, before).step(), { before, after,
      instruction: { address: 0x2000, bytes: [0x39] }, outcome: "executed", accesses });
    assert.deepEqual(ram.accesses, accesses);
  }
});

test("6800 RTS uses every SP and retains separate data reads when either return byte overlaps its opcode", () => {
  const ram = new ObservedRam();
  for (let sp = 0; sp < 65536; sp++) {
    const highAt = (sp + 1) % 65536, lowAt = (sp + 2) % 65536;
    ram.write(highAt, 0x34);
    ram.write(lowAt, 0x56);
    ram.write(0xffff, 0x39);
    ram.accesses.length = 0;
    const high = highAt === 0xffff ? 0x39 : 0x34;
    const low = lowAt === 0xffff ? 0x39 : 0x56;
    const before = initialState({ pc: 0xffff, sp, flags: flags(sp % 64) });
    const after = { ...before, pc: high * 256 + low, sp: lowAt };
    const accesses = [{ kind: "read", address: 0xffff, value: 0x39 },
      { kind: "read", address: highAt, value: high }, { kind: "read", address: lowAt, value: low }];
    assert.deepEqual(new Cpu6800(ram, before).step(), { before, after,
      instruction: { address: 0xffff, bytes: [0x39] }, outcome: "executed", accesses });
    assert.deepEqual(ram.accesses, accesses);
  }
});

test("6800 pulls read edited stack RAM and later calls use current SP while old records remain detached", () => {
  const ram = new ObservedRam();
  // JSR, then PULA consumes an edited high return byte; PULB consumes the low byte.
  for (const [address, byte] of [[0x2000, 0xbd], [0x2001, 0x21], [0x2002, 0], [0x2100, 0x32],
    [0x2101, 0x33], [0x2102, 0x8d], [0x2103, 0], [0x2104, 0x39]] as const) ram.write(address, byte);
  const cpu = new Cpu6800(ram, initialState({ sp: 0x1000 }));
  const first = cpu.step();
  const saved = structuredClone(first);
  ram.write(0x0fff, 0xa5);
  assert.equal(cpu.step().after.a, 0xa5);
  assert.equal(cpu.step().after.b, 3);
  const call = cpu.step();
  assert.equal(call.after.sp, 0x0ffe);
  ram.write(0x0fff, 0x12);
  ram.write(0x1000, 0x34);
  const before = cpu.snapshot();
  ram.accesses.length = 0;
  const after = { ...before, pc: 0x1234, sp: 0x1000 };
  const accesses = [{ kind: "read", address: 0x2104, value: 0x39 },
    { kind: "read", address: 0x0fff, value: 0x12 }, { kind: "read", address: 0x1000, value: 0x34 }];
  assert.deepEqual(cpu.step(), { before, after, instruction: { address: 0x2104, bytes: [0x39] }, outcome: "executed", accesses });
  assert.deepEqual(ram.accesses, accesses);
  cpu.reset();
  Reflect.set(call.before.flags, "h", false);
  assert.deepEqual(first, saved);
});

test("6800 implements all 197 documented forms and atomically rejects the 59 undefined encodings", () => {
  const supported = new Set([
    0x16, 0x17, 0x20, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x2b, 0x2c, 0x2d, 0x2e, 0x2f,
    0x32, 0x33, 0x36, 0x37, 0x39, 0x4a, 0x4c, 0x5a, 0x5c,
    0x8d, 0x8e, 0xbd,
    ...accumulatorForms.flatMap(form => form.opcodes), ...storeForms.map(form => form.opcode),
    ...unaryForms.flatMap(form => form.opcodes),
    ...wordLoads.flatMap(form => form.opcodes), ...wordStores.flatMap(form => form.opcodes), ...indexComparisons,
    ...pointerOperations.map(form => form.opcode), ...interAccumulator.map(form => form.opcode),
    0x01, 0x06, 0x07, 0x0a, 0x0b, 0x0c, 0x0d, 0x19, 0x6e, 0x7e, 0xad,
  ]);
  for (const opcode of [0x0e, 0x0f, 0x3b, 0x3e, 0x3f]) supported.add(opcode); // CLI, SEI, RTI, WAI, SWI
  assert.equal(supported.size, 197);
  const ram = new ObservedRam();
  for (let opcode = 0; opcode < 256; opcode++) {
    for (const pc of [0, 0x2000, 0xffff]) {
      ram.write(pc, opcode);
      ram.write((pc + 1) % 0x10000, 0xa5);
      const before = initialState({ pc, flags: flags(opcode % 64) });
      const cpu = new Cpu6800(ram, before);
      if (supported.has(opcode)) {
        assert.equal(cpu.step().outcome, opcode === 0x3e ? "waiting" : "executed", `documented opcode ${opcode.toString(16)}`);
        continue;
      }
      for (let attempt = 0; attempt < 2; attempt++) {
        ram.accesses.length = 0;
        const accesses = [{ kind: "read", address: pc, value: opcode }];
        assert.deepEqual(cpu.step(), { before, after: before, instruction: { address: pc, bytes: [opcode] },
          outcome: "unsupported", reason: "opcode", accesses });
        assert.deepEqual(ram.accesses, accesses);
      }
    }
  }
});

test("6800 reset checks every vector value, reading only FFFE then FFFF and setting I", () => {
  const ram = new ObservedRam();
  for (let vector = 0; vector < 0x10000; vector++) {
    const high = Math.floor(vector / 256);
    const low = vector % 256;
    ram.write(0xfffe, high);
    ram.write(0xffff, low);
    ram.accesses.length = 0;
    const before = initialState({ flags: flags(vector % 64) });
    const after = { ...before, pc: vector, flags: { ...before.flags, i: true } };
    const accesses = [{ kind: "read", address: 0xfffe, value: high }, { kind: "read", address: 0xffff, value: low }];
    const cpu = new Cpu6800(ram, before);
    assert.deepEqual(cpu.reset(), { before, after, accesses });
    assert.deepEqual(cpu.snapshot(), after);
    assert.deepEqual(ram.accesses, accesses);
  }
});

test("6800 reset rereads current vector bytes, preserves RAM and other state, and returns detached records", () => {
  const ram = new ObservedRam();
  ram.write(0xfffe, 0x12);
  ram.write(0xffff, 0xab);
  ram.write(0x1234, 0x55);
  const cpu = new Cpu6800(ram, initialState());
  const first = cpu.reset();
  const saved = structuredClone(first);
  ram.accesses.length = 0;
  assert.deepEqual(cpu.reset(), { before: first.after, after: first.after, accesses: first.accesses });
  assert.deepEqual(ram.accesses, first.accesses);
  ram.write(0xfffe, 0x34);
  ram.write(0xffff, 0x56);
  ram.accesses.length = 0;
  const after = { ...saved.after, pc: 0x3456 };
  assert.deepEqual(cpu.reset(), { before: first.after, after,
    accesses: [{ kind: "read", address: 0xfffe, value: 0x34 }, { kind: "read", address: 0xffff, value: 0x56 }] });
  assert.deepEqual(first, saved);
  Reflect.set(first.after, "pc", 0);
  Reflect.set(first.after.flags, "i", false);
  assert.deepEqual(cpu.snapshot(), after);
  assert.equal(ram.read(0x1234), 0x55);
});

test("6800 sees host-edited operands and self-modified instructions while earlier records stay detached", () => {
  const ram = new Ram(0x10000);
  for (const [offset, byte] of [0x86, 0, 0xb7, 0x20, 0x05, 0x8b, 0, 0x80].entries()) ram.write(0x2000 + offset, byte);
  const cpu = new Cpu6800(ram, initialState());
  ram.write(0x2001, 0xb7);
  const load = cpu.step();
  assert.equal(load.after.a, 0xb7);
  const store = cpu.step();
  assert.deepEqual(store.accesses, [{ kind: "read", address: 0x2002, value: 0xb7 },
    { kind: "read", address: 0x2003, value: 0x20 }, { kind: "read", address: 0x2004, value: 5 },
    { kind: "write", address: 0x2005, value: 0xb7 }]);
  const saved = structuredClone([load, store]);
  const changed = cpu.step();
  assert.deepEqual(changed.instruction, { address: 0x2005, bytes: [0xb7, 0, 0x80] });
  assert.equal(ram.read(0x80), 0xb7);
  cpu.reset();
  ram.write(0x2001, 0);
  assert.deepEqual([load, store], saved);
  Reflect.set(load.after.flags, "n", false);
  assert.equal(store.before.flags.n, true);
});

// Literal truth sets for N Z V C, independent of the implementation's paired predicates.
// The original 6800 leaves 21 unused; the 6809's BRN is not part of this model.
const branchCases: readonly { mnemonic: string; opcode: number; takenCodes: readonly number[] }[] = [
  { mnemonic: "BRA", opcode: 0x20, takenCodes: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] },
  { mnemonic: "BHI", opcode: 0x22, takenCodes: [0, 2, 8, 10] },
  { mnemonic: "BLS", opcode: 0x23, takenCodes: [1, 3, 4, 5, 6, 7, 9, 11, 12, 13, 14, 15] },
  { mnemonic: "BCC", opcode: 0x24, takenCodes: [0, 2, 4, 6, 8, 10, 12, 14] },
  { mnemonic: "BCS", opcode: 0x25, takenCodes: [1, 3, 5, 7, 9, 11, 13, 15] },
  { mnemonic: "BNE", opcode: 0x26, takenCodes: [0, 1, 2, 3, 8, 9, 10, 11] },
  { mnemonic: "BEQ", opcode: 0x27, takenCodes: [4, 5, 6, 7, 12, 13, 14, 15] },
  { mnemonic: "BVC", opcode: 0x28, takenCodes: [0, 1, 4, 5, 8, 9, 12, 13] },
  { mnemonic: "BVS", opcode: 0x29, takenCodes: [2, 3, 6, 7, 10, 11, 14, 15] },
  { mnemonic: "BPL", opcode: 0x2a, takenCodes: [0, 1, 2, 3, 4, 5, 6, 7] },
  { mnemonic: "BMI", opcode: 0x2b, takenCodes: [8, 9, 10, 11, 12, 13, 14, 15] },
  { mnemonic: "BGE", opcode: 0x2c, takenCodes: [0, 1, 4, 5, 10, 11, 14, 15] },
  { mnemonic: "BLT", opcode: 0x2d, takenCodes: [2, 3, 6, 7, 8, 9, 12, 13] },
  { mnemonic: "BGT", opcode: 0x2e, takenCodes: [0, 1, 10, 11] },
  { mnemonic: "BLE", opcode: 0x2f, takenCodes: [2, 3, 4, 5, 6, 7, 8, 9, 12, 13, 14, 15] },
];

for (const { mnemonic, opcode, takenCodes } of branchCases) {
  test(`6800 ${mnemonic} follows its truth table for all flags, preserves state, and fetches both bytes on either path`, () => {
    const ram = new ObservedRam();
    // Literal targets cover signed extremes, instruction overlap, page and address-space crossings.
    for (const [pc, operandAddress, displacement, fallthrough, target] of [
      [0x1234, 0x1235, 0x00, 0x1236, 0x1236],
      [0x1234, 0x1235, 0x7f, 0x1236, 0x12b5],
      [0x1234, 0x1235, 0x80, 0x1236, 0x11b6],
      [0x1234, 0x1235, 0xfe, 0x1236, 0x1234],
      [0x1234, 0x1235, 0xff, 0x1236, 0x1235],
      [0x12fd, 0x12fe, 0x01, 0x12ff, 0x1300],
      [0x0000, 0x0001, 0x80, 0x0002, 0xff82],
      [0xfffd, 0xfffe, 0x01, 0xffff, 0x0000],
      [0xfffe, 0xffff, 0xff, 0x0000, 0xffff],
      [0xffff, 0x0000, 0xfe, 0x0001, 0xffff],
    ] as const) {
      ram.write(pc, opcode);
      ram.write(operandAddress, displacement);
      for (let bits = 0; bits < 64; bits++) {
        const before = initialState({ pc, flags: flags(bits) });
        const after = { ...before, pc: takenCodes.includes(bits % 16) ? target : fallthrough };
        const cpu = new Cpu6800(ram, before);
        ram.accesses.length = 0;
        const accesses = [{ kind: "read", address: pc, value: opcode },
          { kind: "read", address: operandAddress, value: displacement }];
        assert.deepEqual(cpu.step(), { before, after, instruction: { address: pc, bytes: [opcode, displacement] },
          outcome: "executed", accesses });
        assert.deepEqual(cpu.snapshot(), after);
        assert.deepEqual(ram.accesses, accesses);
      }
    }
  });
}

test("6800 branches interpret every displacement relative to the end of the instruction", () => {
  const ram = new ObservedRam();
  const operand = new DataView(new ArrayBuffer(1));
  for (const { opcode, takenCodes } of branchCases) {
    const untakenCode = Array.from({ length: 16 }, (_, code) => code).find(code => !takenCodes.includes(code));
    for (const bits of [takenCodes[0], untakenCode]) {
      if (bits === undefined) continue; // BRA has no untaken path.
      for (const pc of [0, 0x1234, 0xffff]) {
        ram.write(pc, opcode);
        for (let displacement = 0; displacement < 256; displacement++) {
          ram.write((pc + 1) % 65536, displacement);
          operand.setUint8(0, displacement);
          const before = initialState({ pc, flags: flags(bits) });
          const offset: number = takenCodes.includes(bits) ? operand.getInt8(0) : 0;
          const after: Cpu6800State = { ...before, pc: (pc + 2 + offset + 65536) % 65536 };
          const cpu = new Cpu6800(ram, before);
          ram.accesses.length = 0;
          const accesses = [{ kind: "read", address: pc, value: opcode },
            { kind: "read", address: (pc + 1) % 65536, value: displacement }];
          assert.deepEqual(cpu.step(), { before, after, instruction: { address: pc, bytes: [opcode, displacement] },
            outcome: "executed", accesses });
          assert.deepEqual(ram.accesses, accesses);
        }
      }
    }
  }
});

test("6800 branches use current overflow and carry after decrement, transfers, and addition", () => {
  const ram = new ObservedRam();
  for (const [address, bytes] of [
    [0x2000, [0xc6, 0x80, 0x5a, 0x2d, 2]],
    [0x2007, [0x17, 0x2c, 2]],
    [0x200c, [0x8b, 0x81, 0x16, 0x25, 2]],
  ] as const) {
    bytes.forEach((byte, offset) => ram.write(address + offset, byte));
  }
  let before = initialState({ flags: flags(0x10) });
  const cpu = new Cpu6800(ram, before);
  for (const [bytes, changes] of [
    [[0xc6, 0x80], { pc: 0x2002, b: 0x80, flags: flags(0x18) }],
    [[0x5a], { pc: 0x2003, b: 0x7f, flags: flags(0x12) }],
    [[0x2d, 2], { pc: 0x2007 }],
    [[0x17], { pc: 0x2008, a: 0x7f, flags: flags(0x10) }],
    [[0x2c, 2], { pc: 0x200c }],
    [[0x8b, 0x81], { pc: 0x200e, a: 0, flags: flags(0x35) }],
    [[0x16], { pc: 0x200f, b: 0 }],
    [[0x25, 2], { pc: 0x2013 }],
  ] as const) {
    const after = { ...before, ...changes };
    const accesses = bytes.map((value, offset) => ({ kind: "read", address: before.pc + offset, value }));
    ram.accesses.length = 0;
    assert.deepEqual(cpu.step(), { before, after, instruction: { address: before.pc, bytes }, outcome: "executed", accesses });
    assert.deepEqual(ram.accesses, accesses);
    before = after;
  }
});

test("6800 branches fetch edited operands, keep records detached, and resume after replacing unused 21", () => {
  const ram = new ObservedRam();
  ram.write(0xffff, 0x26);
  ram.write(0, 0);
  const initial = initialState({ pc: 0xffff });
  const cpu = new Cpu6800(ram, initial);
  ram.write(0, 0xfe);
  ram.accesses.length = 0;
  const first = cpu.step();
  const saved = structuredClone(first);
  assert.deepEqual(first, { before: initial, after: initial, instruction: { address: 0xffff, bytes: [0x26, 0xfe] },
    outcome: "executed", accesses: [{ kind: "read", address: 0xffff, value: 0x26 }, { kind: "read", address: 0, value: 0xfe }] });
  assert.deepEqual(ram.accesses, first.accesses);
  ram.write(0, 1);
  ram.accesses.length = 0;
  const second = cpu.step();
  const atTwo = { ...initial, pc: 2 };
  assert.deepEqual(second, { before: initial, after: atTwo, instruction: { address: 0xffff, bytes: [0x26, 1] },
    outcome: "executed", accesses: [{ kind: "read", address: 0xffff, value: 0x26 }, { kind: "read", address: 0, value: 1 }] });
  assert.deepEqual(ram.accesses, second.accesses);
  ram.write(2, 0x21);
  ram.write(3, 0xa5);
  ram.accesses.length = 0;
  assert.deepEqual(cpu.step(), { before: atTwo, after: atTwo, instruction: { address: 2, bytes: [0x21] },
    outcome: "unsupported", reason: "opcode", accesses: [{ kind: "read", address: 2, value: 0x21 }] });
  assert.deepEqual(ram.accesses, [{ kind: "read", address: 2, value: 0x21 }]);
  ram.write(2, 0x20);
  ram.write(3, 0xfe);
  ram.accesses.length = 0;
  const resumed = cpu.step();
  assert.deepEqual(resumed, { before: atTwo, after: atTwo, instruction: { address: 2, bytes: [0x20, 0xfe] },
    outcome: "executed", accesses: [{ kind: "read", address: 2, value: 0x20 }, { kind: "read", address: 3, value: 0xfe }] });
  assert.deepEqual(ram.accesses, resumed.accesses);
  ram.write(0xfffe, 0x23);
  ram.write(0xffff, 0x45);
  cpu.reset();
  assert.deepEqual(first, saved);
  Reflect.set(first.after.flags, "z", true);
  Reflect.set(second.instruction.bytes, 1, 0);
  assert.deepEqual(resumed.after, atTwo);
  assert.deepEqual(cpu.snapshot(), { ...atTwo, pc: 0x2345, flags: { ...atTwo.flags, i: true } });
});

for (const { name, opcodes: [, , indexed, extended] } of unaryForms) {
  test(`6800 ${name} indexed uses every unsigned displacement, wraps the address, and preserves X`, () => {
    const ram = new ObservedRam();
    for (const x of [0, 0x7fff, 0xff00, 0xffff]) {
      for (let offset = 0; offset < 256; offset++) {
        const address = (x + offset) % 65536;
        const value = (offset * 73 + 17) % 256;
        ram.write(0x4000, indexed); ram.write(0x4001, offset); ram.write(address, value);
        const before = initialState({ pc: 0x4000, x, flags: flags(offset % 64) });
        const cpu = new Cpu6800(ram, before);
        ram.accesses.length = 0;
        const expected = unaryResult(name, value, before.flags);
        const record = cpu.step();
        assert.deepEqual(record, { before, after: { ...before, pc: 0x4002, flags: expected.flags },
          instruction: { address: 0x4000, bytes: [indexed, offset] }, outcome: "executed", accesses: [
            { kind: "read", address: 0x4000, value: indexed }, { kind: "read", address: 0x4001, value: offset },
            ...(name === "CLR" ? [] : [{ kind: "read", address, value }]),
            ...(name === "TST" ? [] : [{ kind: "write", address, value: expected.result }]),
          ] });
        assert.deepEqual(ram.accesses, record.accesses);
        assert.equal(ram.read(address), expected.result);
      }
    }
  });

  test(`6800 ${name} captures indexed/extended operands before changing overlapping code`, () => {
    for (const isIndexed of [true, false]) {
      for (const pc of [0x2000, 0xfffe, 0xffff]) {
        for (let overlap = 0; overlap < (isIndexed ? 2 : 3); overlap++) {
          const address = (pc + overlap) % 65536;
          const x = (address + 65536 - 0x80) % 65536;
          const bytes = isIndexed ? [indexed, 0x80] : [extended, Math.floor(address / 256), address % 256];
          const value = bytes[overlap]!;
          const ram = new ObservedRam();
          bytes.forEach((value, offset) => ram.write((pc + offset) % 65536, value));
          const before = initialState({ pc, x });
          const cpu = new Cpu6800(ram, before);
          ram.accesses.length = 0;
          const expected = unaryResult(name, value, before.flags);
          const record = cpu.step();
          assert.deepEqual(record, { before, after: { ...before, pc: (pc + bytes.length) % 65536, flags: expected.flags },
            instruction: { address: pc, bytes }, outcome: "executed", accesses: [
              ...bytes.map((value, offset) => ({ kind: "read", address: (pc + offset) % 65536, value })),
              ...(name === "CLR" ? [] : [{ kind: "read", address, value }]),
              ...(name === "TST" ? [] : [{ kind: "write", address, value: expected.result }]),
            ] });
          assert.deepEqual(ram.accesses, record.accesses);
          assert.equal(ram.read(address), expected.result);
        }
      }
    }
  });
}

test("6800 unary failures retain completed fetches and apply flags only after the required operand read", () => {
  const failure = new Error("unary access failure");
  class FaultRam extends ObservedRam {
    failAt = -1; attempts = 0;
    override read(address: number): number { if (this.attempts++ === this.failAt) throw failure; return super.read(address); }
    override write(address: number, value: number): void { if (this.attempts++ === this.failAt) throw failure; super.write(address, value); }
  }
  for (const { name, opcodes: [, , indexed, extended] } of unaryForms) {
    for (const bytes of [[indexed, 0xff], [extended, 0, 0x80]]) for (const bits of [0, 63]) {
      const before = initialState({ pc: 0xffff, x: 0xff81, flags: flags(bits) });
      const expected = unaryResult(name, 0x80, before.flags), readsOperand = name !== "CLR", writesResult = name !== "TST";
      const accesses = [
        ...bytes.map((value, offset) => ({ kind: "read", address: (before.pc + offset) % 65536, value })),
        ...(readsOperand ? [{ kind: "read", address: 0x80, value: 0x80 }] : []),
        ...(writesResult ? [{ kind: "write", address: 0x80, value: expected.result }] : []),
      ];
      for (let failAt = -1; failAt < accesses.length; failAt++) {
        const ram = new FaultRam();
        bytes.forEach((value, offset) => ram.write((before.pc + offset) % 65536, value));
        ram.write(0x80, 0x80);
        const cpu = new Cpu6800(ram, before);
        ram.accesses.length = 0; ram.attempts = 0; ram.failAt = failAt;
        const completed = failAt < 0 ? accesses.length : failAt;
        const after = { ...before, pc: (before.pc + Math.min(completed, bytes.length)) % 65536,
          flags: completed >= bytes.length + Number(readsOperand) ? expected.flags : before.flags };
        if (failAt < 0) assert.deepEqual(cpu.step(), { before, after, instruction: { address: before.pc, bytes }, accesses, outcome: "executed" });
        else assert.throws(() => cpu.step(), error => error === failure);
        assert.deepEqual(cpu.snapshot(), after, `${name}, bytes=${bytes}, failAt=${failAt}`);
        assert.deepEqual(ram.accesses, accesses.slice(0, completed));
        ram.failAt = -1;
        assert.equal(ram.read(0x80), writesResult && failAt < 0 ? expected.result : 0x80);
      }
    }
  }
});

test("6800 unary steps read current data and retain independent records across resumption, edits, and reset", () => {
  const ram = new ObservedRam();
  const bytes = [0x64, 0x80, 0x76, 0, 0, 0x7d, 0, 0, 0x6f, 0x80]; // LSR, ROR, TST, CLR at 0000
  bytes.forEach((value, offset) => ram.write(0x2000 + offset, value));
  ram.write(0, 3); ram.write(0xfffe, 0x20); ram.write(0xffff, 0);
  const cpu = new Cpu6800(ram, initialState({ x: 0xff80 }));
  const first = cpu.step();
  const saved = structuredClone(first);
  assert.equal(ram.read(0), 1);
  assert.deepEqual(first.after.flags, { h: true, i: false, n: false, z: false, v: true, c: true });
  ram.write(0, 0x80);
  const resumed = new Cpu6800(ram, cpu.snapshot());
  const rotate = resumed.step();
  assert.equal(ram.read(0), 0xc0); // The current byte with carry from LSR.
  assert.deepEqual(rotate.after.flags, { h: true, i: false, n: true, z: false, v: true, c: false });
  ram.write(0, 0);
  const tested = resumed.step();
  assert.deepEqual(tested.after.flags, { h: true, i: false, n: false, z: true, v: false, c: false });
  ram.accesses.length = 0;
  const cleared = resumed.step();
  assert.deepEqual(cleared.accesses, [
    { kind: "read", address: 0x2008, value: 0x6f }, { kind: "read", address: 0x2009, value: 0x80 },
    { kind: "write", address: 0, value: 0 },
  ]); // Clearing an already-zero byte still writes.
  assert.deepEqual(ram.accesses, cleared.accesses);
  const savedRotate = structuredClone(rotate);
  Reflect.set(first.after.flags, "c", false);
  assert.deepEqual(rotate, savedRotate);
  const beforeReset = resumed.snapshot();
  assert.deepEqual(resumed.reset(), { before: beforeReset, after: { ...beforeReset, pc: 0x2000,
    flags: { ...beforeReset.flags, i: true } }, accesses: [
      { kind: "read", address: 0xfffe, value: 0x20 }, { kind: "read", address: 0xffff, value: 0 },
    ] });
  assert.deepEqual(first.instruction, saved.instruction);
  assert.deepEqual(first.accesses, saved.accesses);
  assert.deepEqual(rotate, savedRotate);
});

function load(ram: Ram, bytes: readonly number[], address: number): void {
  for (const [offset, value] of bytes.entries()) ram.write(address + offset, value);
}

// Motorola's frame, laid out in ascending memory: CC, B, A, X high/low, PC high/low.
// Buffer supplies independent word encoding; the CPU uses its own stack primitives.
function interruptFrame(state: Cpu6800State, pc = state.pc): number[] {
  const bytes = Buffer.alloc(7);
  bytes[0] = 192 + [state.flags.h, state.flags.i, state.flags.n, state.flags.z, state.flags.v, state.flags.c]
    .reduce((sum, value, index) => sum + Number(value) * 2 ** (5 - index), 0);
  bytes[1] = state.b;
  bytes[2] = state.a;
  bytes.writeUInt16BE(state.x, 3);
  bytes.writeUInt16BE(pc, 5);
  return [...bytes];
}

for (const source of ["swi", "irq", "nmi", "wai"] as const) {
  test(`6800 ${source} checks the full frame, vectors, flags, wrapping, and overlapping code/stack/vector RAM`, () => {
    const ram = new ObservedRam();
    const vector = source === "swi" ? 0xfffa : source === "irq" ? 0xfff8 : 0xfffc;
    const opcode = source === "wai" ? 0x3e : 0x3f;
    const external = source === "irq" || source === "nmi";
    for (let bits = 0; bits < 64; bits++) {
      for (const sp of [0, 1, 3, 6, 7, 0x2000, 0xfff9, 0xfffb, 0xfffd, 0xffff]) {
        for (const pc of [0, 0x2000, 0xffff]) {
          const before = initialState({ pc, sp, flags: flags(bits), a: bits * 3, b: 255 - bits, x: bits * 1025 });
          ram.write(vector, 0x45);
          ram.write(vector + 1, 0x67);
          ram.write(pc, opcode);
          const image = new Map([[vector, ram.read(vector)], [vector + 1, ram.read(vector + 1)]]);
          const accesses: Cpu6800MemoryAccess[] = external ? [] : [{ kind: "read", address: pc, value: opcode }];
          const returnPc = external ? pc : (pc + 1) % 65536;
          const ignored = source === "irq" && before.flags.i;
          if (!ignored) {
            for (const [offset, value] of interruptFrame(before, returnPc).reverse().entries()) {
              const address = (sp - offset + 65536) % 65536;
              accesses.push({ kind: "write", address, value });
              image.set(address, value);
              // Unchanged writes still belong in the record.
              if (address !== pc && address !== vector && address !== vector + 1) ram.write(address, value);
            }
          }
          const target = image.get(vector)! * 256 + image.get(vector + 1)!;
          if (!ignored && source !== "wai") {
            accesses.push({ kind: "read", address: vector, value: image.get(vector)! },
              { kind: "read", address: vector + 1, value: image.get(vector + 1)! });
          }
          const after = ignored ? before : { ...before, sp: (sp - 7 + 65536) % 65536,
            pc: source === "wai" ? returnPc : target, waiting: source === "wai",
            flags: source === "wai" ? before.flags : { ...before.flags, i: true } };
          ram.accesses.length = 0;
          const cpu = new Cpu6800(ram, before);
          const record = external ? cpu.interrupt(source) : cpu.step();
          const outcome = external ? { source, outcome: ignored ? "ignored" : "accepted", ...(ignored ? { reason: "masked" } : {}) }
            : { outcome: source === "wai" ? "waiting" : "executed" };
          assert.deepEqual(record, { before, after, instruction: external ? null : { address: pc, bytes: [opcode] }, accesses, ...outcome });
          assert.deepEqual(cpu.snapshot(), after);
          assert.deepEqual(ram.accesses, accesses);
          for (const access of accesses) if (access.kind === "write") assert.equal(ram.read(access.address), access.value);
        }
      }
    }
  });
}

test("6800 RTI restores every packed status byte from live RAM, with full-width stack and return-address wrapping", () => {
  const ram = new ObservedRam();
  for (let cc = 0; cc < 256; cc++) {
    for (const sp of [0, 0xfff8, 0xfffa, 0xfffc, 0xfffe, 0xffff, 0x1ffc, 0x1fff]) {
      const before = initialState({ sp });
      const bytes = [cc, 255 - cc, cc, cc, 255 - cc, cc, cc];
      for (const [offset, value] of bytes.entries()) ram.write((sp + offset + 1) % 65536, value);
      // The opcode wins an overlap; RTI must read the actual edited byte again as data.
      ram.write(before.pc, 0x3b);
      const reads = bytes.map((_, index) => {
        const address = (sp + index + 1) % 65536;
        return { kind: "read" as const, address, value: ram.read(address) };
      });
      const values = Buffer.from(reads.map(access => access.value));
      const after = { ...before, sp: (sp + 7) % 65536, flags: flags(values[0]!), b: values[1]!, a: values[2]!,
        x: values.readUInt16BE(3), pc: values.readUInt16BE(5) };
      ram.accesses.length = 0;
      const cpu = new Cpu6800(ram, before);
      const accesses = [{ kind: "read", address: before.pc, value: 0x3b }, ...reads];
      assert.deepEqual(cpu.step(), { before, after, instruction: { address: before.pc, bytes: [0x3b] }, outcome: "executed", accesses });
      assert.deepEqual(ram.accesses, accesses);
      assert.deepEqual(cpu.snapshot(), after);
      // Restored flag objects must be the ones subsequent instructions use.
      ram.write(after.pc, 0x07); // TPA
      assert.equal(cpu.step().after.a, 192 + values[0]! % 64);
    }
  }
});

test("6800 WAI stays idle, ignores masked IRQ, and wakes through either vector without stacking twice", () => {
  for (const source of ["irq", "nmi"] as const) {
    for (const i of [false, true]) {
      const ram = new ObservedRam();
      load(ram, [0x3e, 0x01], 0x2000); // WAI; NOP
      load(ram, [0x30, 0x00, 0x40, 0x00, 0x50, 0x00, 0x60, 0x00], 0xfff8);
      const before = initialState({ sp: 3, flags: { ...flags(0x2b), i } });
      const cpu = new Cpu6800(ram, before);
      const wait = cpu.step();
      const saved = structuredClone(wait);
      const resumed = new Cpu6800(ram, cpu.snapshot());
      ram.accesses.length = 0;
      for (let attempt = 0; attempt < 2; attempt++) {
        assert.deepEqual(resumed.step(), { before: wait.after, after: wait.after, instruction: null, accesses: [], outcome: "waiting" });
      }
      assert.deepEqual(ram.accesses, []);
      if (i && source === "irq") {
        assert.equal(resumed.interrupt(source).outcome, "ignored");
        assert.equal(resumed.snapshot().waiting, true);
        assert.deepEqual(ram.accesses, []);
        continue;
      }
      const vector = source === "irq" ? 0xfff8 : 0xfffc;
      // WAI's wrapped frame overwrote some vectors. Host edits are observed on wake.
      load(ram, [0x70, 0x00], vector);
      ram.write(0x7000, 0x3b); // RTI
      ram.accesses.length = 0;
      const entry = resumed.interrupt(source);
      assert.deepEqual(entry, { before: wait.after, after: { ...wait.after, waiting: false, pc: 0x7000,
        flags: { ...before.flags, i: true } }, instruction: null, source, outcome: "accepted",
        accesses: [{ kind: "read", address: vector, value: 0x70 }, { kind: "read", address: vector + 1, value: 0 }] });
      assert.deepEqual(ram.accesses, entry.accesses);
      // Reset the frame after the intentional vector overlap, then edit the saved B and PC.
      const frame = interruptFrame(before, 0x2001);
      for (const [offset, byte] of frame.entries()) ram.write((wait.after.sp + offset + 1) % 65536, byte);
      ram.write((wait.after.sp + 2) % 65536, 0x99);
      ram.write((wait.after.sp + 7) % 65536, 0x02);
      assert.deepEqual(resumed.step().after, { ...before, b: 0x99, pc: 0x2002 });
      assert.deepEqual(wait, saved);
    }
  }
});

test("6800 boundary IRQ offers use current I after CLI, SEI, TAP, RTI, and reset; ignored offers are not queued", () => {
  for (const [opcode, i] of [[0x0e, false], [0x0f, true], [0x06, false], [0x3b, false]] as const) {
    const ram = new ObservedRam();
    load(ram, [opcode, 0x01], 0x2000);
    load(ram, [0x30, 0x00], 0xfff8);
    load(ram, [0xc0, 0, 0, 0, 0, 0x20, 0x01], 0x1001);
    const cpu = new Cpu6800(ram, initialState({ a: 0xc0, sp: 0x1000, flags: flags(16) }));
    ram.accesses.length = 0;
    const ignored = cpu.interrupt("irq");
    assert.equal(ignored.outcome, "ignored");
    assert.deepEqual(ram.accesses, []);
    assert.equal(cpu.step().after.flags.i, i);
    assert.equal(cpu.step().after.pc, 0x2002); // No remembered request interrupts this NOP.
    assert.equal(cpu.interrupt("irq").outcome, i ? "ignored" : "accepted");
    cpu.reset();
    assert.equal(cpu.interrupt("irq").outcome, "ignored");
  }
});

class CallbackRam extends ObservedRam {
  onAccess: (() => void) | undefined;
  override read(address: number): number { this.onAccess?.(); return super.read(address); }
  override write(address: number, value: number): void { this.onAccess?.(); super.write(address, value); }
}

test("6800 entry and WAI failures preserve each completed write, PC advance, mask change, and wait release", () => {
  for (const source of ["swi", "wai", "irq", "nmi", "wake"] as const) {
    const instruction = source === "swi" || source === "wai";
    const count = source === "wai" ? 8 : source === "wake" ? 2 : instruction ? 10 : 9;
    for (let failed = 0; failed < count; failed++) {
      const ram = new CallbackRam();
      const before = initialState({ waiting: source === "wake", sp: 0 });
      ram.write(before.pc, source === "wai" ? 0x3e : 0x3f);
      const cpu = new Cpu6800(ram, before);
      const marker = new Error("RAM failure");
      let calls = 0;
      ram.accesses.length = 0;
      ram.onAccess = () => { if (calls++ === failed) throw marker; };
      assert.throws(() => instruction ? cpu.step() : cpu.interrupt(source === "irq" ? "irq" : "nmi"), error => error === marker);
      assert.equal(calls, failed + 1);
      assert.equal(ram.accesses.length, failed);
      const writes = source === "wake" ? 0 : Math.min(7, Math.max(0, failed - Number(instruction)));
      const entered = source === "wake" || writes === 7;
      const expected = { ...before, sp: (65536 - writes) % 65536,
        pc: before.pc + Number(instruction && failed > 0), waiting: false,
        flags: entered ? { ...before.flags, i: true } : before.flags };
      assert.deepEqual(cpu.snapshot(), expected);
      ram.onAccess = undefined;
      const values = interruptFrame(before, expected.pc).reverse();
      for (let offset = 0; offset < writes; offset++) assert.equal(ram.read((65536 - offset) % 65536), values[offset]);
      assert.doesNotThrow(() => cpu.reset()); // Guard is released even when a transition throws.
    }
  }
});

test("6800 RTI failure preserves completed fields and preincremented SP, committing words only after both reads", () => {
  for (let failed = 0; failed < 8; failed++) {
    const ram = new CallbackRam();
    const before = initialState({ sp: 0xfffc });
    const values = [0xc4, 0x98, 0x76, 0x54, 0x32, 0x10, 0xff];
    for (const [offset, value] of values.entries()) ram.write((before.sp + offset + 1) % 65536, value);
    ram.write(before.pc, 0x3b);
    const cpu = new Cpu6800(ram, before);
    const marker = new Error("RTI read failure");
    let calls = 0;
    ram.accesses.length = 0;
    ram.onAccess = () => { if (calls++ === failed) throw marker; };
    assert.throws(() => cpu.step(), error => error === marker);
    assert.equal(ram.accesses.length, failed);
    assert.equal(calls, failed + 1);
    assert.deepEqual(cpu.snapshot(), { ...before, pc: before.pc + Number(failed > 0),
      sp: (before.sp + failed) % 65536, flags: failed >= 2 ? flags(4) : before.flags,
      b: failed >= 3 ? 0x98 : before.b, a: failed >= 4 ? 0x76 : before.a, x: failed >= 6 ? 0x5432 : before.x });
    ram.onAccess = undefined;
    assert.doesNotThrow(() => cpu.reset());
  }
});

test("6800 reset releases waiting only after both vector reads, preserving the saved frame and other state", () => {
  for (const failed of [0, 1, 2]) {
    const ram = new CallbackRam();
    const before = initialState({ waiting: true });
    load(ram, [0x12, 0x34], 0xfffe);
    const cpu = new Cpu6800(ram, before);
    const marker = new Error("reset read failure");
    let calls = 0;
    ram.accesses.length = 0;
    ram.onAccess = () => { if (calls++ === failed) throw marker; };
    if (failed < 2) {
      assert.throws(() => cpu.reset(), error => error === marker);
      assert.deepEqual(cpu.snapshot(), before);
    } else {
      assert.deepEqual(cpu.reset(), { before, after: { ...before, pc: 0x1234, waiting: false, flags: { ...before.flags, i: true } },
        accesses: [{ kind: "read", address: 0xfffe, value: 0x12 }, { kind: "read", address: 0xffff, value: 0x34 }] });
    }
    assert.ok(ram.accesses.every(access => access.kind === "read"));
  }
});

test("6800 rejects nested mutations at every memory callback but permits snapshots, then releases its guard", () => {
  for (const operation of ["swi", "wai", "rti", "irq", "nmi", "reset"] as const) {
    const ram = new CallbackRam();
    ram.write(0x2000, operation === "wai" ? 0x3e : operation === "rti" ? 0x3b : 0x3f);
    const cpu = new Cpu6800(ram, initialState());
    let callbacks = 0;
    ram.onAccess = () => {
      callbacks++;
      const before = cpu.snapshot();
      for (const nested of [() => cpu.step(), () => cpu.reset(), () => cpu.interrupt("irq"), () => cpu.interrupt("nmi")]) {
        assert.throws(nested, /must not be reentrant/);
        assert.deepEqual(cpu.snapshot(), before);
      }
    };
    if (operation === "reset") cpu.reset();
    else if (operation === "irq" || operation === "nmi") cpu.interrupt(operation);
    else cpu.step();
    assert.ok(callbacks > 0);
    ram.onAccess = undefined;
    assert.doesNotThrow(() => cpu.reset());
  }
});

test("6800 validates interrupt sources and waiting state without RAM access and detaches the waiting latch", () => {
  const ram = new ObservedRam();
  for (const value of [0, 1, "false", undefined, null]) {
    const state = initialState();
    Reflect.set(state, "waiting", value);
    assert.throws(() => new Cpu6800(ram, state), TypeError);
  }
  const state = initialState({ waiting: true });
  const cpu = new Cpu6800(ram, state);
  state.waiting = false;
  const snapshot = cpu.snapshot();
  Reflect.set(snapshot, "waiting", false);
  assert.equal(cpu.snapshot().waiting, true);
  for (const source of ["swi", "firq", "IRQ", "", 0, null, undefined]) {
    assert.throws(() => Reflect.apply(cpu.interrupt, cpu, [source]), RangeError);
  }
  assert.deepEqual(ram.accesses, []);
});
