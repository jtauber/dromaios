import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu68000 } from "../../../src/components/cpus/68000.js";
import type { Cpu68000Flags, Cpu68000State, Cpu68000Snapshot, Cpu68000MemoryAccess, Cpu68000Exception, Cpu68000StepRecord } from "../../../src/components/cpus/68000.js";
import { Ram } from "../../../src/components/memory/ram.js";
import { ObservedRam } from "../../helpers/observed-ram.js";

// Literal operation words from the manual, independent of the core's pattern expansion.
// Each transfer row has this destination and sources D0–D7, in that order.
const registerForms = [
  { register: "d0", load: 0x203c, add: 0x0680, store: 0x23c0, quick: 0x7000, moves: [0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007] },
  { register: "d1", load: 0x223c, add: 0x0681, store: 0x23c1, quick: 0x7200, moves: [0x2200, 0x2201, 0x2202, 0x2203, 0x2204, 0x2205, 0x2206, 0x2207] },
  { register: "d2", load: 0x243c, add: 0x0682, store: 0x23c2, quick: 0x7400, moves: [0x2400, 0x2401, 0x2402, 0x2403, 0x2404, 0x2405, 0x2406, 0x2407] },
  { register: "d3", load: 0x263c, add: 0x0683, store: 0x23c3, quick: 0x7600, moves: [0x2600, 0x2601, 0x2602, 0x2603, 0x2604, 0x2605, 0x2606, 0x2607] },
  { register: "d4", load: 0x283c, add: 0x0684, store: 0x23c4, quick: 0x7800, moves: [0x2800, 0x2801, 0x2802, 0x2803, 0x2804, 0x2805, 0x2806, 0x2807] },
  { register: "d5", load: 0x2a3c, add: 0x0685, store: 0x23c5, quick: 0x7a00, moves: [0x2a00, 0x2a01, 0x2a02, 0x2a03, 0x2a04, 0x2a05, 0x2a06, 0x2a07] },
  { register: "d6", load: 0x2c3c, add: 0x0686, store: 0x23c6, quick: 0x7c00, moves: [0x2c00, 0x2c01, 0x2c02, 0x2c03, 0x2c04, 0x2c05, 0x2c06, 0x2c07] },
  { register: "d7", load: 0x2e3c, add: 0x0687, store: 0x23c7, quick: 0x7e00, moves: [0x2e00, 0x2e01, 0x2e02, 0x2e03, 0x2e04, 0x2e05, 0x2e06, 0x2e07] },
] as const;
type DataRegister = typeof registerForms[number]["register"];

function wordBytes(value: number): number[] {
  return [Math.floor(value / 256), value % 256];
}

// Instruction-family sweeps leave tracing disabled; dedicated tests below check trace sequencing.
function flags(bits: number): Cpu68000Flags {
  return { x: Boolean(bits & 1), n: Boolean(bits & 2), z: Boolean(bits & 4), v: Boolean(bits & 8),
    c: Boolean(bits & 16), t: false, s: Boolean(bits & 64) };
}

function initialState(overrides: Partial<Cpu68000State> = {}): Cpu68000State {
  return { d0: 0x11223344, d1: 0x55667788, d2: 0x99aabbcc, d3: 0xddeeff00,
    d4: 0x01234567, d5: 0x89abcdef, d6: 0xfedcba98, d7: 0x76543210,
    a0: 0x10000000, a1: 0x20000000, a2: 0x30000000, a3: 0x40000000,
    a4: 0x50000000, a5: 0x60000000, a6: 0x70000000, usp: 0x34ffe000, ssp: 0x56ffd000,
    pc: 0xab001000, ir: 0, faulted: false, halted: false, tracePending: false, interruptMask: 2, flags: flags(127), ...overrides };
}

function snapshot(state: Cpu68000State): Cpu68000Snapshot {
  return { ...state, flags: { ...state.flags }, a7: state.flags.s ? state.ssp : state.usp, physicalPc: state.pc % 16777216 };
}

function longBytes(value: number): number[] {
  return [Math.floor(value / 16777216), Math.floor(value / 65536) % 256, Math.floor(value / 256) % 256, value % 256];
}

function moveFlags(before: Cpu68000Flags, value: number): Cpu68000Flags {
  return { ...before, n: value >= 2147483648, z: value === 0, v: false, c: false };
}

// BigInt unsigned arithmetic and signed ranges are independent of the core's bitwise formulas.
function addition(before: Cpu68000State, operand: number, register: DataRegister = "d0"): Cpu68000State {
  const total = BigInt(before[register]) + BigInt(operand);
  const result = Number(total % 4294967296n);
  const signedTotal = BigInt.asIntN(32, BigInt(before[register])) + BigInt.asIntN(32, BigInt(operand));
  return { ...before, [register]: result, pc: (before.pc + 6) % 4294967296,
    flags: { ...before.flags, x: total >= 4294967296n, c: total >= 4294967296n, n: result >= 2147483648,
      z: result === 0, v: signedTotal < -2147483648n || signedTotal > 2147483647n } };
}

function checkStep(ram: ObservedRam, before: Cpu68000State, bytes: readonly number[], after: Cpu68000State,
  writes: readonly Cpu68000MemoryAccess[] = [], runningCpu?: Cpu68000): void {
  const reads = bytes.map((value, offset) => ({ kind: "read" as const, address: (before.pc + offset) % 16777216, value }));
  for (const { address, value } of reads) ram.write(address, value);
  ram.accesses.length = 0;
  const cpu = runningCpu ?? new Cpu68000(ram, before);
  const accesses = [...reads, ...writes];
  after.ir = bytes[0]! * 256 + bytes[1]!;
  assert.deepEqual(cpu.step(), { before: snapshot(before), after: snapshot(after),
    instruction: { address: before.pc, bytes }, outcome: "executed", accesses });
  assert.deepEqual(cpu.snapshot(), snapshot(after));
  assert.deepEqual(ram.accesses, accesses);
  for (const { address, value } of writes) assert.equal(ram.read(address), value);
}

function addressErrorRecord({ before, instruction, accesses, fault }: {
  before: Cpu68000Snapshot; instruction: { address: number; bytes: readonly number[] } | null;
  accesses: readonly Cpu68000MemoryAccess[]; fault: { operation: "fetch" | "read" | "write"; address: number };
}): Cpu68000StepRecord {
  const ir = instruction ? instruction.bytes[0]! * 256 + instruction.bytes[1]! : before.ir;
  const returnPc = unsignedLong(before.pc + (instruction?.bytes.length ?? 0));
  const program = fault.operation === "fetch" || (fault.operation === "read" && [58, 59].includes(ir % 64));
  const functionCode: 1 | 2 | 5 | 6 = before.flags.s ? (program ? 6 : 5) : (program ? 2 : 1);
  const stack = unsignedLong(before.ssp - 14);
  const base = { ...before, ir, ssp: stack, halted: false, tracePending: false, flags: { ...before.flags, s: true, t: false } };
  const exception = { source: "address-error" as const, vector: 3 as const, returnPc,
    fault: { ...fault, instructionRegister: ir, functionCode, processingInstruction: true } };
  if (before.ssp % 2) return { before, after: snapshot({ ...base, faulted: true }), instruction, accesses,
    outcome: "halted", exception: { ...exception, entryFault: { operation: "write", address: unsignedLong(before.ssp - 2) } } };
  const words = [returnPc % 65536, Math.floor(returnPc / 65536), statusWord(before), ir,
    fault.address % 65536, Math.floor(fault.address / 65536), (fault.operation === "write" ? 0 : 16) + functionCode];
  const writes = words.flatMap((word, i) => memoryAccesses("write", before.ssp - 2 - 2 * i, wordBytes(word)));
  // These fixtures use a zero vector. Dedicated address-error tests below exercise nonzero and overlapping vectors.
  return { before, after: snapshot({ ...base, pc: 0 }), instruction, outcome: "executed", exception,
    accesses: [...accesses, ...writes, ...memoryAccesses("read", 12, [0, 0, 0, 0])] };
}

test("68000 construction owns all stored state and derives A7 and physical PC without reading RAM", () => {
  const ram = new ObservedRam(0x1000000);
  for (const s of [false, true]) {
    const state = initialState({ flags: { ...flags(127), s } });
    const expected = snapshot(state);
    const cpu = new Cpu68000(ram, state);
    const first = cpu.snapshot();
    const restored = new Cpu68000(ram, first);
    state.d0 = state.pc = state.usp = state.ssp = 0;
    state.flags.s = !s;
    Reflect.set(first, "a7", 0);
    Reflect.set(first, "physicalPc", 0);
    Reflect.set(first.flags, "s", !s);
    assert.deepEqual(cpu.snapshot(), expected);
    assert.deepEqual(restored.snapshot(), expected);
  }
  assert.deepEqual(ram.accesses, []);
});

test("68000 reads declared getters once and ignores contradictory derived views and extra metadata", () => {
  const state = initialState();
  const expected = snapshot(state);
  const calls = new Map<string, number>();
  for (const [label, object] of [["state", state], ["flags", state.flags]] as const) {
    for (const [name, value] of Object.entries(object)) {
      Object.defineProperty(object, name, { enumerable: false, get: () => {
        const key = `${label}.${name}`;
        calls.set(key, (calls.get(key) ?? 0) + 1);
        return value;
      } });
    }
    for (const name of ["metadata", "a7", "physicalPc"]) {
      Object.defineProperty(object, name, { get: () => { throw new Error(`Unexpected ${label}.${name}`); } });
    }
  }
  assert.deepEqual(new Cpu68000(new Ram(0x1000000), state).snapshot(), expected);
  assert.equal(calls.size, 31);
  assert.ok([...calls.values()].every(count => count === 1));
});

test("68000 validates eighteen unsigned long registers, a three-bit mask, seven flags, and 16 MiB RAM", () => {
  const ram = new ObservedRam(0x1000000);
  for (const name of ["d0", "d1", "d2", "d3", "d4", "d5", "d6", "d7", "a0", "a1", "a2", "a3", "a4", "a5", "a6", "usp", "ssp", "pc"] as const) {
    for (const value of [0, 0xffffffff]) assert.equal(new Cpu68000(ram, initialState({ [name]: value })).snapshot()[name], value);
    for (const value of [-1, 0x100000000, 0.5, NaN, Infinity, "00", undefined]) {
      const state = initialState();
      Reflect.set(state, name, value);
      assert.throws(() => new Cpu68000(ram, state), RangeError);
    }
  }
  for (let value = 0; value < 8; value++) assert.equal(new Cpu68000(ram, initialState({ interruptMask: value })).snapshot().interruptMask, value);
  for (const value of [-1, 8, 0.5, NaN]) assert.throws(() => new Cpu68000(ram, initialState({ interruptMask: value })), RangeError);
  for (const name of ["x", "n", "z", "v", "c", "t", "s"]) {
    for (const value of [0, 1, "false", undefined]) {
      const state = initialState();
      Reflect.set(state.flags, name, value);
      assert.throws(() => new Cpu68000(ram, state), TypeError);
    }
  }
  for (const size of [1, 0x10000, 0x100000, 0xffffff, 0x1000001]) {
    assert.throws(() => new Cpu68000(new Ram(size), initialState()), /exactly 16 MiB/);
  }
  assert.deepEqual(ram.accesses, []);
});

test("68000 long loads and stores select every data register, set NZ, clear VC, and preserve X and control state", () => {
  const ram = new ObservedRam(0x1000000);
  for (const { register, load, store } of registerForms) {
    for (let bits = 0; bits < 128; bits++) {
      for (const value of [0, 1, 0xffff, 0x10000, 0x7fffffff, 0x80000000, 0xff00ff00, 0xffffffff]) {
        const before = initialState({ [register]: value, flags: flags(bits), interruptMask: bits % 8 });
        const after = { ...before, pc: 0xab001006, flags: moveFlags(before.flags, value) };
        checkStep(ram, { ...before, [register]: 0x12345678 }, [...wordBytes(load), ...longBytes(value)], after);
        checkStep(ram, before, [...wordBytes(store), 0xcd, 2, 0, 0x82], after,
          longBytes(value).map((byte, offset) => ({ kind: "write", address: 0x20082 + offset, value: byte })));
      }
    }
  }
});

test("68000 ADDI.L checks carry and signed overflow at byte, word, and long boundaries for every flag pattern", () => {
  const ram = new ObservedRam(0x1000000);
  const values = [0, 1, 0x7f, 0xff, 0x7fff, 0xffff, 0x10000, 0x7ffffffe, 0x7fffffff, 0x80000000, 0x80000001, 0xfffffffe, 0xffffffff];
  for (let bits = 0; bits < 128; bits++) {
    for (const d0 of values) {
      for (const operand of values) {
        const before = initialState({ d0, flags: flags(bits), interruptMask: bits % 8 });
        checkStep(ram, before, [6, 0x80, ...longBytes(operand)], addition(before, operand));
      }
    }
  }
});

test("68000 ADDI.L selects every data register and replaces XNZVC without changing other state", () => {
  const ram = new ObservedRam(0x1000000);
  const pairs = [[0, 0], [0xffff, 1], [0x7fffffff, 1], [0x80000000, 0x80000000],
    [0xffffffff, 1], [0xffffffff, 0xffffffff], [0x80000000, 0xffffffff]] as const;
  for (const { register, add } of registerForms) {
    for (let bits = 0; bits < 128; bits++) {
      for (const [value, operand] of pairs) {
        const before = initialState({ [register]: value, flags: flags(bits), interruptMask: bits % 8 });
        checkStep(ram, before, [...wordBytes(add), ...longBytes(operand)], addition(before, operand, register));
      }
    }
  }
});

test("68000 register MOVE covers all 64 pairs including self-transfers, preserves sources, and updates flags", () => {
  const ram = new ObservedRam(0x1000000);
  const values = [0, 1, 0xffff, 0x10000, 0x7fffffff, 0x80000000, 0xff00ff00, 0xffffffff];
  for (const { register: destination, moves } of registerForms) {
    for (const [sourceIndex, { register: source }] of registerForms.entries()) {
      for (let bits = 0; bits < 128; bits++) {
        const value = values[(bits + sourceIndex) % values.length]!;
        const before = initialState({ [source]: value, flags: flags(bits), interruptMask: bits % 8 });
        const after = { ...before, [destination]: value, pc: 0xab001002, flags: moveFlags(before.flags, value) };
        checkStep(ram, before, wordBytes(moves[sourceIndex]!), after);
      }
    }
  }
});

test("68000 MOVEQ covers every embedded byte and destination, sign-extends to the full long, and fetches no extension", () => {
  const ram = new ObservedRam(0x1000000);
  for (const { register, quick } of registerForms) {
    for (let byte = 0; byte < 256; byte++) {
      const value = Number(BigInt.asUintN(32, BigInt.asIntN(8, BigInt(byte))));
      for (const bits of [0, 127]) {
        const before = initialState({ flags: flags(bits), interruptMask: bits % 8 });
        const after = { ...before, [register]: value, pc: 0xab001002, flags: moveFlags(before.flags, value) };
        checkStep(ram, before, wordBytes(quick + byte), after);
      }
    }
    for (let bits = 0; bits < 128; bits++) {
      for (const [byte, value] of [[0, 0], [0x7f, 0x7f], [0x80, 0xffffff80], [0xff, 0xffffffff]] as const) {
        const before = initialState({ flags: flags(bits), interruptMask: bits % 8 });
        checkStep(ram, before, wordBytes(quick + byte),
          { ...before, [register]: value, pc: 0xab001002, flags: moveFlags(before.flags, value) });
      }
    }
  }
});

test("68000 ADDI.L sweeps every low word across positive, negative, and unsigned carry boundaries", () => {
  const ram = new ObservedRam(0x1000000);
  for (const high of [0, 0x7fff0000, 0xffff0000]) {
    let before = initialState();
    const cpu = new Cpu68000(ram, before);
    for (let low = 0; low < 65536; low++) {
      // Run a sequence of load/add pairs, retaining independently predicted state.
      // This exercises the same operand sweep without rebuilding a decoder for each pair.
      const loaded = { ...before, d0: high + low, pc: before.pc + 6, flags: moveFlags(before.flags, high + low) };
      checkStep(ram, before, [0x20, 0x3c, ...longBytes(high + low)], loaded, [], cpu);
      const after = addition(loaded, 0x10001);
      checkStep(ram, loaded, [6, 0x80, 0, 1, 0, 1], after, [], cpu);
      before = after;
    }
  }
});

test("68000 fetches wrap the physical bus independently of the full PC and read big-endian operation words", () => {
  const ram = new ObservedRam(0x1000000);
  for (const pc of [0, 0x123456, 0x12fffffc, 0x12fffffe, 0xfffffffc, 0xfffffffe]) {
    const before = initialState({ pc });
    checkStep(ram, before, [0x20, 0x3c, 0x89, 0xab, 0xcd, 0xef],
      { ...before, d0: 0x89abcdef, pc: (pc + 6) % 4294967296, flags: moveFlags(before.flags, 0x89abcdef) });
  }
});

test("68000 register and quick moves wrap PC after one operation word and keep the full selected value", () => {
  const ram = new ObservedRam(0x1000000);
  for (const pc of [0x12fffffe, 0xfffffffe]) {
    for (const { register, moves, quick } of registerForms) {
      const before = initialState({ pc });
      checkStep(ram, before, wordBytes(moves[7]), { ...before, [register]: before.d7,
        pc: (pc + 2) % 4294967296, flags: moveFlags(before.flags, before.d7) });
      checkStep(ram, before, wordBytes(quick + 0x80), { ...before, [register]: 0xffffff80,
        pc: (pc + 2) % 4294967296, flags: moveFlags(before.flags, 0xffffff80) });
    }
  }
});

test("68000 long stores accept two-byte alignment and wrap the physical bus after translating the full address", () => {
  const ram = new ObservedRam(0x1000000);
  for (const address of [0, 2, 0xfffffc, 0x12fffffe, 0x89abcdef - 1, 0xfffffffe]) {
    const before = initialState({ d0: 0x89abcdef });
    checkStep(ram, before, [0x23, 0xc0, ...longBytes(address)],
      { ...before, pc: 0xab001006, flags: moveFlags(before.flags, before.d0) },
      longBytes(before.d0).map((value, offset) => ({ kind: "write", address: (address + offset) % 16777216, value })));
  }
});

test("68000 decodes every non-instruction opword into its illegal or emulator-line exception", () => {
  const ram = new ObservedRam(0x1000000);
  const before = initialState();
  const supported = new Set(registerForms.flatMap(({ load, add, store, quick, moves }) =>
    [load, add, store, ...moves, ...Array.from({ length: 256 }, (_, byte) => quick + byte)]));
  // Independent manual address sets: byte excludes An; destination excludes PC/immediate.
  const allSources = Array.from({ length: 61 }, (_, code) => code);
  const byteSources = allSources.filter(code => code < 8 || code >= 16);
  const dataDestinations = [...Array.from({ length: 8 }, (_, code) => code),
    ...Array.from({ length: 42 }, (_, code) => code + 16)];
  for (const [base, sources, destinations] of [
    [0x1000, byteSources, dataDestinations], [0x2000, allSources, [...dataDestinations, 8, 9, 10, 11, 12, 13, 14, 15]],
    [0x3000, allSources, [...dataDestinations, 8, 9, 10, 11, 12, 13, 14, 15]],
  ] as const) {
    for (const source of sources) for (const destination of destinations) {
      supported.add(base + (destination % 8) * 512 + Math.floor(destination / 8) * 64 + source);
    }
  }
  for (const base of [0x0000, 0x0200, 0x0400, 0x0600, 0x0a00, 0x0c00]) {
    for (const size of [0, 0x40, 0x80]) for (const destination of dataDestinations) {
      supported.add(base + size + destination);
    }
  }
  for (let opcode = 0x6000; opcode < 0x7000; opcode++) supported.add(opcode);
  for (const base of [0x50c8, 0x51c8, 0x52c8, 0x53c8, 0x54c8, 0x55c8, 0x56c8, 0x57c8,
    0x58c8, 0x59c8, 0x5ac8, 0x5bc8, 0x5cc8, 0x5dc8, 0x5ec8, 0x5fc8]) {
    for (let register = 0; register < 8; register++) supported.add(base + register);
  }
  supported.add(0x4e75);
  for (const { base, size, destination } of arithmeticForms) {
    const addresses = destination === "memory" ? allSources.filter(code => code >= 16 && code <= 57)
      : size === 1 ? byteSources : allSources;
    for (let register = 0; register < 8; register++) for (const ea of addresses) supported.add(base + register * 512 + ea);
  }
  for (const { base, destination } of logicForms) {
    const addresses = destination === "data" ? byteSources : destination === "ea" ? dataDestinations
      : allSources.filter(code => code >= 16 && code <= 57);
    for (let register = 0; register < 8; register++) for (const ea of addresses) supported.add(base + register * 512 + ea);
  }
  for (const ea of controlAddresses) {
    for (const base of [0x4840, 0x4e80, 0x4ec0]) supported.add(base + ea);
    for (const base of [0x41c0, 0x43c0, 0x45c0, 0x47c0, 0x49c0, 0x4bc0, 0x4dc0, 0x4fc0]) supported.add(base + ea);
  }
  for (let register = 0; register < 8; register++) {
    supported.add(0x4e50 + register);
    supported.add(0x4e58 + register);
  }
  for (const { base, addresses } of multipleForms) for (const ea of addresses) supported.add(base + ea);
  for (const { opcodes } of unaryFamilies) for (const base of opcodes) {
    for (const ea of dataDestinations) supported.add(base + ea);
  }
  for (const { opcodes } of quickFamilies) for (const [size, base] of opcodes.entries()) {
    for (const { field } of quickAmounts) for (const ea of size === 0 ? dataDestinations : allSources.filter(ea => ea < 58)) {
      supported.add(base + field + ea);
    }
  }
  for (const { opcode } of setConditions) for (const ea of dataDestinations) supported.add(opcode + ea);
  for (const { immediate, register, memory } of shiftFamilies) {
    for (const base of [...immediate, ...register]) for (const { field } of quickAmounts) {
      for (let destination = 0; destination < 8; destination++) supported.add(base + field + destination);
    }
    for (const ea of dataDestinations.filter(code => code >= 16)) supported.add(memory + ea);
  }
  for (const { name, immediate, dynamic } of bitFamilies) {
    for (const ea of byteSources) {
      if (ea <= (name === "BTST" ? 59 : 57)) supported.add(immediate + ea);
      if (ea <= (name === "BTST" ? 60 : 57)) {
        for (let register = 0; register < 8; register++) supported.add(dynamic + register * 512 + ea);
      }
    }
  }
  for (const { opcodes } of pairedFamilies) for (const base of opcodes) {
    for (let source = 0; source < 8; source++) for (let destination = 0; destination < 8; destination++) {
      supported.add(base + destination * 512 + source);
    }
  }
  for (const base of [0x40c0, 0x4800, 0x4ac0]) for (const ea of dataDestinations) supported.add(base + ea);
  for (const base of [0x44c0, 0x46c0]) for (const ea of byteSources) supported.add(base + ea);
  for (let vector = 0; vector < 16; vector++) supported.add(0x4e40 + vector);
  for (const opcode of [0x4e70, 0x4afc, 0x4e73, 0x4e76, 0x003c, 0x007c, 0x023c, 0x027c, 0x0a3c, 0x0a7c, 0x4e71, 0x4e72, 0x4e77]) supported.add(opcode);
  for (let register = 0; register < 8; register++) {
    for (const base of [0x4840, 0x4880, 0x48c0, 0x4e60, 0x4e68]) supported.add(base + register);
    for (const base of [0x4180, 0x80c0, 0x81c0, 0xc0c0, 0xc1c0]) {
      for (const ea of byteSources) supported.add(base + register * 512 + ea);
    }
    for (let other = 0; other < 8; other++) {
      for (const base of [0x0108, 0x0148, 0x0188, 0x01c8, 0x8100, 0x8108, 0xc100, 0xc108, 0xc140, 0xc148, 0xc188]) {
        supported.add(base + register * 512 + other);
      }
    }
  }
  assert.equal(supported.size, 45816); // Includes embedded MOVEQ, branch, quick, and shift counts, unlike coverage forms.
  const counts = { "illegal-instruction": 0, "line-a": 0, "line-f": 0 };
  for (let opcode = 0; opcode < 65536; opcode++) {
    if (supported.has(opcode)) continue;
    const bytes = [Math.floor(opcode / 256), opcode % 256];
    const line = opcode.toString(16).padStart(4, "0")[0];
    const source = line === "a" ? "line-a" : line === "f" ? "line-f" : "illegal-instruction";
    checkException(ram, before, bytes, source, line === "a" ? 10 : line === "f" ? 11 : 4);
    counts[source]++;
  }
  assert.deepEqual(counts, { "illegal-instruction": 11528, "line-a": 4096, "line-f": 4096 });
});

test("68000 odd fetches and stores enter vector 3 without making the rejected access", () => {
  const ram = new ObservedRam(0x1000000);
  for (const address of [1, 0x1001, 0x12ffffff, 0xffffffff]) {
    const before = snapshot(initialState({ pc: address }));
    ram.accesses.length = 0;
    for (let attempt = 0; attempt < 2; attempt++) {
      ram.accesses.length = 0;
      const expected = addressErrorRecord({ before, instruction: null, accesses: [], fault: { operation: "fetch", address } });
      assert.deepEqual(new Cpu68000(ram, before).step(), expected);
      assert.deepEqual(ram.accesses, expected.accesses);
    }
    const storeBefore = snapshot(initialState());
    const bytes = [0x23, 0xc0, ...longBytes(address)];
    const accesses = bytes.map((value, offset) => ({ kind: "read" as const, address: 0x1000 + offset, value }));
    for (const { address, value } of accesses) ram.write(address, value);
    for (let attempt = 0; attempt < 2; attempt++) {
      ram.accesses.length = 0;
      const expected = addressErrorRecord({ before: storeBefore, accesses, instruction: { address: storeBefore.pc, bytes }, fault: { operation: "write", address } });
      assert.deepEqual(new Cpu68000(ram, storeBefore).step(), expected);
      assert.deepEqual(ram.accesses, expected.accesses);
    }
  }
});

test("68000 every register store faults before writeback and writes current values after restoring a corrected boundary", () => {
  const ram = new ObservedRam(0x1000000);
  for (const { register, store } of registerForms) {
    const state = initialState();
    const bytes = [...wordBytes(store), 0xff, 0xff, 0xff, 0xff];
    bytes.forEach((value, offset) => ram.write(0x1000 + offset, value));
    ram.accesses.length = 0;
    const cpu = new Cpu68000(ram, state);
    const accesses = bytes.map((value, offset) => ({ kind: "read" as const, address: 0x1000 + offset, value }));
    const rejected = cpu.step();
    const expected = addressErrorRecord({ before: snapshot(state), instruction: { address: state.pc, bytes }, accesses, fault: { operation: "write", address: 0xffffffff } });
    assert.deepEqual(rejected, expected);
    assert.deepEqual(ram.accesses, expected.accesses);
    const saved = structuredClone(rejected);
    const writes = longBytes(state[register]).map((value, offset) => ({ kind: "write" as const,
      address: (0xfffffe + offset) % 16777216, value }));
    checkStep(ram, state, [...wordBytes(store), 0xff, 0xff, 0xff, 0xfe],
      { ...state, pc: 0xab001006, flags: moveFlags(state.flags, state[register]) }, writes);
    assert.deepEqual(rejected, saved);
  }
});

test("68000 handlers read current registers and fetch modified embedded immediates on later steps", () => {
  const ram = new ObservedRam(0x1000000);
  const before = initialState();
  const cpu = new Cpu68000(ram, before);
  const quick = { ...before, d7: 0xffffff80, pc: 0xab001002, flags: moveFlags(before.flags, 0xffffff80) };
  checkStep(ram, before, [0x7e, 0x80], quick, [], cpu);
  const move = { ...quick, d2: 0xffffff80, pc: 0xab001004 };
  checkStep(ram, quick, [0x24, 0x07], move, [], cpu);
  const add = addition(move, 0x80, "d2");
  checkStep(ram, move, [6, 0x82, 0, 0, 0, 0x80], add, [], cpu);
  // Store D2=0 over a later MOVEQ operand word that originally encodes -1.
  ram.write(0x1011, 0xff);
  const stored = { ...add, pc: 0xab001010, flags: moveFlags(add.flags, 0) };
  checkStep(ram, add, [0x23, 0xc2, 0xab, 0, 0x10, 0x10], stored,
    [0, 1, 2, 3].map(offset => ({ kind: "write", address: 0x1010 + offset, value: 0 })), cpu);
  ram.write(0x1010, 0x76); // Restore only the opcode's high byte: the next immediate is now zero.
  ram.accesses.length = 0;
  const record = cpu.step();
  assert.deepEqual(record, { before: snapshot(stored), after: snapshot({ ...stored, ir: 0x7600, d3: 0, pc: 0xab001012 }),
    instruction: { address: 0xab001010, bytes: [0x76, 0] }, outcome: "executed",
    accesses: [{ kind: "read", address: 0x1010, value: 0x76 }, { kind: "read", address: 0x1011, value: 0 }] });
  assert.deepEqual(ram.accesses, record.accesses);
});

test("68000 reset reads current vectors high byte first and preserves unspecified registers, USP, and condition codes", () => {
  const ram = new ObservedRam(0x1000000);
  for (let bits = 0; bits < 128; bits++) {
    for (const [ssp, pc] of [[0x12fff000, 0xab001000], [0xffffffff, 0xffffffff], [0, 0]] as const) {
      const bytes = [...longBytes(ssp), ...longBytes(pc)];
      bytes.forEach((value, offset) => ram.write(offset, value));
      ram.accesses.length = 0;
      const state = initialState({ flags: flags(bits), interruptMask: bits % 8 });
      const cpu = new Cpu68000(ram, state);
      const accesses = bytes.map((value, address) => ({ kind: "read", address, value }));
      const after = snapshot({ ...state, faulted: pc % 2 !== 0, ssp, pc, interruptMask: 7, flags: { ...state.flags, t: false, s: true } });
      const record = cpu.reset();
      assert.deepEqual(record, { before: snapshot(state), after, accesses });
      assert.deepEqual(ram.accesses, accesses);
      assert.deepEqual(cpu.snapshot(), after);
      if (pc % 2) assert.equal(cpu.step().outcome, "halted");
      ram.write(0, 0);
      cpu.reset();
      assert.deepEqual(record.after, after);
    }
  }
});

test("68000 execution reads current code and operands, fetches before overlapping stores, and detaches records", () => {
  const ram = new ObservedRam(0x1000000);
  const cpu = new Cpu68000(ram, initialState());
  [0x20, 0x3c, 0, 0, 0, 0, 6, 0x80, 0, 0, 0, 1, 0x23, 0xc0, 0xab, 0, 0x10, 0x0c]
    .forEach((value, offset) => ram.write(0x1000 + offset, value));
  ram.write(0x1002, 0x80);
  const load = cpu.step();
  assert.equal(load.after.d0, 0x80000000);
  const saved = structuredClone(load);
  ram.write(0x100b, 2);
  assert.equal(cpu.step().after.d0, 0x80000002);
  const store = cpu.step();
  assert.deepEqual(store.instruction?.bytes, [0x23, 0xc0, 0xab, 0, 0x10, 0x0c]);
  assert.deepEqual(store.accesses.slice(-4), [
    { kind: "write", address: 0x100c, value: 0x80 }, { kind: "write", address: 0x100d, value: 0 },
    { kind: "write", address: 0x100e, value: 0 }, { kind: "write", address: 0x100f, value: 2 },
  ]);
  assert.deepEqual(load, saved);
  const final = cpu.snapshot();
  Reflect.set(store.after.flags, "x", false);
  Reflect.set(store.before, "d0", 0);
  Reflect.set(store.instruction!.bytes, 0, 0);
  cpu.reset();
  assert.deepEqual(final.flags, { x: false, n: true, z: false, v: false, c: false, t: false, s: true });
  assert.deepEqual(load, saved);
});

// Address fixtures use literal EA codes from the manual. Expected addresses and updates
// are ordinary integer arithmetic, independent of the production decoder and bitwise helpers.
type AddressName = "a0" | "a1" | "a2" | "a3" | "a4" | "a5" | "a6" | "usp" | "ssp";
type TransferFixture = {
  readonly code: number;
  readonly extension: readonly number[];
  readonly register?: DataRegister | AddressName;
  readonly address?: number;
  readonly immediate?: number;
  readonly update?: readonly [AddressName, number];
};
const unsignedLong = (value: number): number => (value % 4294967296 + 4294967296) % 4294967296;
const signedWord = (value: number): number => value % 65536 < 32768 ? value % 65536 : value % 65536 - 65536;
const bytesFor = (size: number, value: number): number[] => longBytes(value).slice(4 - size);
const physical = (address: number): number => unsignedLong(address) % 16777216;
const addressNames = (state: Cpu68000State): readonly AddressName[] =>
  ["a0", "a1", "a2", "a3", "a4", "a5", "a6", state.flags.s ? "ssp" : "usp"];

// Literal manual EA sets: control, alterable control plus predecrement, control plus postincrement.
const controlAddresses = [16, 17, 18, 19, 20, 21, 22, 23, 40, 41, 42, 43, 44, 45, 46, 47,
  48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59];
const multipleStores = [16, 17, 18, 19, 20, 21, 22, 23, 32, 33, 34, 35, 36, 37, 38, 39,
  40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57];
const multipleLoads = [16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31,
  40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59];
const multipleForms = [
  { base: 0x4880, size: 2, load: false, addresses: multipleStores },
  { base: 0x48c0, size: 4, load: false, addresses: multipleStores },
  { base: 0x4c80, size: 2, load: true, addresses: multipleLoads },
  { base: 0x4cc0, size: 4, load: true, addresses: multipleLoads },
] as const;

function transferState(bits = 0): Cpu68000State {
  return initialState({ a0: 0xab020000, a1: 0xcd020100, a2: 0xef020200, a3: 0x12020300,
    a4: 0x34020400, a5: 0x56020500, a6: 0x78020600, usp: 0x9a020700, ssp: 0xbc020800,
    flags: flags(bits), interruptMask: bits % 8 });
}

function transferFixtures(state: Cpu68000State, size: number, extensionPc: number): TransferFixture[] {
  const result: TransferFixture[] = [];
  for (const [n, register] of addressNames(state).entries()) {
    const base = state[register];
    const increment = size === 1 && n === 7 ? 2 : size;
    const previous = unsignedLong(base - increment);
    result.push(
      { code: n, extension: [], register: registerForms[n]!.register },
      { code: 8 + n, extension: [], register },
      { code: 16 + n, extension: [], address: base },
      { code: 24 + n, extension: [], address: base, update: [register, unsignedLong(base + increment)] },
      { code: 32 + n, extension: [], address: previous, update: [register, previous] },
      { code: 40 + n, extension: [0xff, 0xfc], address: unsignedLong(base - 4) },
      { code: 48 + n, extension: [0x70, 0xfe], address: unsignedLong(base + signedWord(state.d7) - 2) },
    );
  }
  result.push(
    { code: 56, extension: [0xff, 0x82], address: 0xffffff82 },
    { code: 57, extension: [0xcd, 0x02, 0x00, 0x82], address: 0xcd020082 },
    { code: 58, extension: [0xfe, 0xee], address: unsignedLong(extensionPc - 274) },
    { code: 59, extension: [0x70, 0xfe], address: unsignedLong(extensionPc + signedWord(state.d7) - 2) },
    { code: 60, extension: size === 4 ? [0x80, 0, 0, 0] : size === 2 ? [0x80, 0] : [0xa5, 0x80], immediate: 2 ** (size * 8 - 1) },
  );
  return result;
}

function checkTransfer(ram: ObservedRam, before: Cpu68000State, opcode: number, size: number,
  source: TransferFixture, destination: TransferFixture): void {
  const bytes = [...wordBytes(opcode), ...source.extension, ...destination.extension];
  const after = { ...before, flags: { ...before.flags }, pc: unsignedLong(before.pc + bytes.length) };
  const memory = new Map<number, number>();
  for (const operand of [source, destination]) {
    if (operand.address === undefined) continue;
    for (let offset = -1; offset <= size; offset++) {
      const address = physical(operand.address + offset);
      memory.set(address, (address * 37 + 165) % 256);
    }
  }
  bytes.forEach((byte, offset) => memory.set(physical(before.pc + offset), byte));
  for (const [address, value] of memory) ram.write(address, value);
  const accesses: Cpu68000MemoryAccess[] = [];
  const read = (address: number): number => {
    const value = memory.get(physical(address))!;
    accesses.push({ kind: "read", address: physical(address), value });
    return value;
  };
  for (let offset = 0; offset < 2 + source.extension.length; offset++) read(before.pc + offset);
  let value = source.immediate ?? (source.register === undefined ? 0 : before[source.register] % 2 ** (size * 8));
  if (source.address !== undefined) {
    for (let offset = 0; offset < size; offset++) value = value * 256 + read(source.address + offset);
  }
  if (source.update) after[source.update[0]] = source.update[1];
  for (let offset = 2 + source.extension.length; offset < bytes.length; offset++) read(before.pc + offset);
  if (destination.update) after[destination.update[0]] = destination.update[1];
  if (destination.address !== undefined) {
    bytesFor(size, value).forEach((byte, offset) => {
      const address = physical(destination.address! + offset);
      accesses.push({ kind: "write", address, value: byte });
      memory.set(address, byte);
    });
  } else if (destination.register) {
    const register = destination.register;
    after[register] = register.startsWith("d")
      ? Math.floor(after[register] / 2 ** (size * 8)) * 2 ** (size * 8) + value
      : size === 2 ? unsignedLong(signedWord(value)) : value;
  }
  if (destination.code < 8 || destination.code >= 16) {
    after.flags = { ...after.flags, n: value >= 2 ** (size * 8 - 1), z: value === 0, v: false, c: false };
  }
  const cpu = new Cpu68000(ram, before);
  ram.accesses.length = 0;
  const record = cpu.step();
  after.ir = bytes[0]! * 256 + bytes[1]!;
  assert.deepEqual(record, { before: snapshot(before), after: snapshot(after), instruction: { address: before.pc, bytes },
    outcome: "executed", accesses }, `operation word ${opcode.toString(16)}`);
  assert.deepEqual(ram.accesses, accesses);
  for (const [address, value] of memory) assert.equal(ram.read(address), value);
}

for (const [base, size, count] of [[0x1000, 1, 2650], [0x2000, 4, 3538], [0x3000, 2, 3538]] as const) {
  test(`68000 ${size}-byte MOVE/MOVEA executes all ${count} legal source/destination forms with both active stacks`, () => {
    const ram = new ObservedRam(0x1000000);
    for (const bits of [0, 127]) {
      const before = transferState(bits);
      const sources = transferFixtures(before, size, before.pc + 2).filter(f => size !== 1 || f.code < 8 || f.code >= 16);
      let forms = 0;
      for (const source of sources) {
        const advanced = { ...before };
        if (source.update) advanced[source.update[0]] = source.update[1];
        const destinations = transferFixtures(advanced, size, before.pc + 2 + source.extension.length)
          .filter(f => f.code < 58 && (size !== 1 || f.code < 8 || f.code >= 16));
        for (const destination of destinations) {
          const opcode = base + (destination.code % 8) * 512 + Math.floor(destination.code / 8) * 64 + source.code;
          checkTransfer(ram, before, opcode, size, source, destination);
          forms++;
        }
      }
      assert.equal(forms, count);
    }
  });
}

for (const [size, immediate, fromAddress, toAddress] of [[1, 0x103c, undefined, undefined],
  [2, 0x303c, 0x3008, 0x3040], [4, 0x203c, 0x2008, 0x2040]] as const) {
  test(`68000 ${size}-byte transfers preserve upper Dn bits, apply size-specific flags, and keep MOVEA flags`, () => {
    const ram = new ObservedRam(0x1000000);
    for (let bits = 0; bits < 128; bits++) {
      for (const value of [0, 1, 2 ** (size * 8 - 1) - 1, 2 ** (size * 8 - 1), 2 ** (size * 8) - 1]) {
        const before = transferState(bits);
        const source = { code: 60, extension: size === 1 ? [0xa5, value] : bytesFor(size, value), immediate: value };
        checkTransfer(ram, before, immediate, size, source, { code: 0, extension: [], register: "d0" });
        if (toAddress !== undefined && fromAddress !== undefined) {
          checkTransfer(ram, { ...before, d0: value }, toAddress, size,
            { code: 0, extension: [], register: "d0" }, { code: 8, extension: [], register: "a0" });
          checkTransfer(ram, { ...before, a0: value }, fromAddress, size,
            { code: 8, extension: [], register: "a0" }, { code: 0, extension: [], register: "d0" });
        }
      }
    }
  });
}

test("68000 all 65,536 brief index words select signed word/long Dn/An indexes and ignore bits 10–8", () => {
  const ram = new ObservedRam(0x1000000);
  // Byte accesses also check odd results; use both An and extension-word PC bases.
  for (const bits of [0, 127]) {
    const state = transferState(bits);
    for (const [opcode, code, base] of [[0x1030, 48, state.a0], [0x103b, 59, state.pc + 2]] as const) {
      for (let extension = 0; extension < 65536; extension++) {
        const register = Math.floor(extension / 4096) % 8;
        const value = extension >= 32768 ? state[addressNames(state)[register]!] : state[registerForms[register]!.register];
        const index = Math.floor(extension / 2048) % 2 ? value : signedWord(value);
        const low = extension % 256;
        const displacement = low < 128 ? low : low - 256;
        checkTransfer(ram, state, opcode, 1,
          { code, extension: wordBytes(extension), address: unsignedLong(base + index + displacement) },
          { code: 0, extension: [], register: "d0" });
      }
    }
  }
});

test("68000 displacement and absolute-word addresses sign-extend every word and preserve full logical addresses", () => {
  const ram = new ObservedRam(0x1000000);
  const state = transferState();
  for (const [opcode, code, base] of [[0x1028, 40, state.a0], [0x1038, 56, 0], [0x103a, 58, state.pc + 2]] as const) {
    for (let displacement = 0; displacement < 65536; displacement++) {
      checkTransfer(ram, state, opcode, 1,
        { code, extension: wordBytes(displacement), address: unsignedLong(base + signedWord(displacement)) },
        { code: 0, extension: [], register: "d0" });
    }
  }
});

test("68000 byte immediates consume a word and ignore every high extension byte", () => {
  const ram = new ObservedRam(0x1000000);
  for (let high = 0; high < 256; high++) for (const value of [0, 0x7f, 0x80, 0xff]) {
    checkTransfer(ram, transferState(), 0x103c, 1, { code: 60, extension: [high, value], immediate: value },
      { code: 0, extension: [], register: "d0" });
  }
});

test("68000 auto-updates wrap at 32 bits and byte A7 uses two bytes in either privilege mode", () => {
  const ram = new ObservedRam(0x1000000);
  for (const bits of [0, 127]) for (const [base, size] of [[0x1000, 1], [0x3000, 2], [0x2000, 4]] as const) {
    for (const [n, register] of addressNames(transferState(bits)).entries()) {
      for (const address of [0, 2, 0x12fffffe, 0xfffffffe]) {
        const state = { ...transferState(bits), [register]: address };
        for (const code of [24 + n, 32 + n]) {
          const operand = transferFixtures(state, size, state.pc + 2).find(f => f.code === code)!;
          checkTransfer(ram, state, base + code, size, operand, { code: 0, extension: [], register: "d0" });
          checkTransfer(ram, state, base + n * 512 + Math.floor(code / 8) * 64, size,
            { code: 0, extension: [], register: "d0" }, operand);
        }
      }
    }
  }
});

test("68000 source increments feed destination indexes and MOVEA overwrites the pending source update", () => {
  const ram = new ObservedRam(0x1000000);
  for (const bits of [0, 127]) {
    const before = transferState(bits);
    // MOVE.L (A0)+,(0,A1,A0.L): destination uses the updated A0 as its index.
    checkTransfer(ram, before, 0x2398, 4,
      { code: 24, extension: [], address: before.a0, update: ["a0", before.a0 + 4] },
      { code: 49, extension: [0x88, 0], address: unsignedLong(before.a1 + before.a0 + 4) });
    // MOVEA.W (A0)+,A0: the loaded word wins over the increment.
    checkTransfer(ram, before, 0x3058, 2,
      { code: 24, extension: [], address: before.a0, update: ["a0", before.a0 + 2] },
      { code: 8, extension: [], register: "a0" });
  }
});

test("68000 reads overlapping source bytes before destination extensions and writes, with no synthetic destination reads", () => {
  const ram = new ObservedRam(0x1000000);
  for (const pc of [0x1000, 0x12fffffe, 0xfffffffe]) {
    const before = transferState();
    before.pc = pc;
    for (const sourceOffset of [0, 2, 4, 6, 8]) for (const destinationOffset of [0, 2, 4, 6, 8]) {
      const source = unsignedLong(pc + sourceOffset);
      const destination = unsignedLong(pc + destinationOffset);
      checkTransfer(ram, before, 0x23f9, 4,
        { code: 57, extension: longBytes(source), address: source },
        { code: 57, extension: longBytes(destination), address: destination });
    }
  }
});

test("68000 read and write address errors discard pending address updates before exception entry", () => {
  const ram = new ObservedRam(0x1000000);
  const cases = [
    { opcode: 0x22d8, a0: 0xab020001, a1: 0xcd030000, address: 0xab020001, operation: "read", reads: 0 }, // (A0)+,(A1)+
    { opcode: 0x22d8, a0: 0xab020000, a1: 0xcd030001, address: 0xcd030001, operation: "write", reads: 4 },
    { opcode: 0x2320, a0: 0xab020005, a1: 0xcd030004, address: 0xab020001, operation: "read", reads: 0 }, // -(A0),-(A1)
    { opcode: 0x2320, a0: 0xab020004, a1: 0xcd030005, address: 0xcd030001, operation: "write", reads: 4 },
  ] as const;
  for (const item of cases) for (const bits of [0, 127]) {
    const state = transferState(bits);
    state.a0 = item.a0;
    state.a1 = item.a1;
    const bytes = wordBytes(item.opcode);
    bytes.forEach((value, offset) => ram.write(0x1000 + offset, value));
    [0x81, 0x23, 0x45, 0x67].forEach((value, offset) => ram.write(0x20000 + offset, value));
    ram.write(0x30000, 0xaa);
    const before = snapshot(state);
    const accesses = [
      ...bytes.map((value, offset) => ({ kind: "read" as const, address: 0x1000 + offset, value })),
      ...[0x81, 0x23, 0x45, 0x67].slice(0, item.reads).map((value, offset) => ({ kind: "read" as const, address: 0x20000 + offset, value })),
    ];
    for (let repeat = 0; repeat < 2; repeat++) {
      ram.accesses.length = 0;
      const expected = addressErrorRecord({ before, instruction: { address: state.pc, bytes }, accesses, fault: { operation: item.operation, address: item.address } });
      assert.deepEqual(new Cpu68000(ram, before).step(), expected);
      assert.deepEqual(ram.accesses, expected.accesses);
      assert.equal(ram.read(0x30000), 0xaa);
    }
  }
});

test("68000 MOVE host errors retain only completed accesses and commit address updates before destination writes", () => {
  const failure = new Error("MOVE access failed");
  class FailingRam extends ObservedRam {
    failAddress = -1;
    override read(address: number): number {
      if (address === this.failAddress) throw failure;
      return super.read(address);
    }
    override write(address: number, value: number): void {
      if (address === this.failAddress) throw failure;
      super.write(address, value);
    }
  }
  const value = [0x12, 0x34, 0x56, 0x78];
  for (const writing of [false, true]) for (let byte = 0; byte < 4; byte++) {
    const ram = new FailingRam(0x1000000);
    const before = initialState({ a0: 0xab020000, a1: 0xcd030000 });
    ram.write(0x1000, 0x22); ram.write(0x1001, 0xd8); // MOVE.L (A0)+,(A1)+
    value.forEach((v, i) => { ram.write(0x20000 + i, v); ram.write(0x30000 + i, 0xcc); });
    const cpu = new Cpu68000(ram, before);
    ram.accesses.length = 0; ram.failAddress = (writing ? 0x30000 : 0x20000) + byte;
    assert.throws(() => cpu.step(), error => error === failure);
    const after = writing ? { ...before, a0: 0xab020004, a1: 0xcd030004 } : before;
    // Flags wait for the full write; PC waits for a successful instruction. Neither changes here.
    assert.deepEqual(cpu.snapshot(), snapshot({ ...after, ir: 0x22d8 }));
    assert.deepEqual(ram.accesses, [
      { kind: "read", address: 0x1000, value: 0x22 }, { kind: "read", address: 0x1001, value: 0xd8 },
      ...value.slice(0, writing ? 4 : byte).map((v, i) => ({ kind: "read", address: 0x20000 + i, value: v })),
      ...value.slice(0, writing ? byte : 0).map((v, i) => ({ kind: "write", address: 0x30000 + i, value: v })),
    ]);
    ram.failAddress = -1;
    value.forEach((v, i) => {
      assert.equal(ram.read(0x20000 + i), v);
      assert.equal(ram.read(0x30000 + i), writing && i < byte ? v : 0xcc);
    });
  }
});

test("68000 every word/long memory mode reports full odd read/write addresses with exact attempted fetches", () => {
  const ram = new ObservedRam(0x1000000);
  for (const [base, size] of [[0x3000, 2], [0x2000, 4]] as const) for (const bits of [0, 127]) {
    const state = transferState(bits);
    for (const register of addressNames(state)) state[register]++;
    for (const fixture of transferFixtures(state, size, state.pc + 2)) {
      if (fixture.address === undefined) continue;
      const extension = [...fixture.extension];
      let address = fixture.address;
      if (address % 2 === 0) {
        address = unsignedLong(address + 1);
        extension[extension.length - 1]!++;
      }
      for (const operation of ["read", "write"] as const) {
        if (operation === "write" && fixture.code > 57) continue;
        const opcode = operation === "read" ? base + fixture.code
          : base + (fixture.code % 8) * 512 + Math.floor(fixture.code / 8) * 64;
        const bytes = [...wordBytes(opcode), ...extension];
        bytes.forEach((value, offset) => ram.write(0x1000 + offset, value));
        ram.accesses.length = 0;
        const before = snapshot(state);
        const accesses = bytes.map((value, offset) => ({ kind: "read" as const, address: 0x1000 + offset, value }));
        const expected = addressErrorRecord({ before, instruction: { address: state.pc, bytes }, accesses, fault: { operation, address } });
        assert.deepEqual(new Cpu68000(ram, before).step(), expected);
        assert.deepEqual(ram.accesses, expected.accesses);
      }
    }
  }
});

test("68000 PC-relative reads use the extension address even across logical and physical wrap", () => {
  const ram = new ObservedRam(0x1000000);
  for (const pc of [0, 0x12fffffc, 0x12fffffe, 0xfffffffc, 0xfffffffe]) {
    const state = { ...transferState(), pc };
    for (const [base, size] of [[0x1000, 1], [0x3000, 2], [0x2000, 4]] as const) {
      for (const [code, extension, address] of [
        [58, [0xff, 0xfc], unsignedLong(pc + 2 - 4)],
        [59, [0x70, 0xfe], unsignedLong(pc + 2 + signedWord(state.d7) - 2)],
      ] as const) {
        checkTransfer(ram, state, base + code, size, { code, extension, address },
          { code: 0, extension: [], register: "d0" });
      }
    }
  }
});

// Literal opmode bases (Dn/An selector zero) from the original 68000 instruction tables.
const arithmeticForms = [
  { name: "ADD", size: 1, base: 0xd000, destination: "data" },
  { name: "ADD", size: 2, base: 0xd040, destination: "data" },
  { name: "ADD", size: 4, base: 0xd080, destination: "data" },
  { name: "ADD", size: 1, base: 0xd100, destination: "memory" },
  { name: "ADD", size: 2, base: 0xd140, destination: "memory" },
  { name: "ADD", size: 4, base: 0xd180, destination: "memory" },
  { name: "SUB", size: 1, base: 0x9000, destination: "data" },
  { name: "SUB", size: 2, base: 0x9040, destination: "data" },
  { name: "SUB", size: 4, base: 0x9080, destination: "data" },
  { name: "SUB", size: 1, base: 0x9100, destination: "memory" },
  { name: "SUB", size: 2, base: 0x9140, destination: "memory" },
  { name: "SUB", size: 4, base: 0x9180, destination: "memory" },
  { name: "CMP", size: 1, base: 0xb000, destination: "data" },
  { name: "CMP", size: 2, base: 0xb040, destination: "data" },
  { name: "CMP", size: 4, base: 0xb080, destination: "data" },
  { name: "ADDA", size: 2, base: 0xd0c0, destination: "address" },
  { name: "ADDA", size: 4, base: 0xd1c0, destination: "address" },
  { name: "SUBA", size: 2, base: 0x90c0, destination: "address" },
  { name: "SUBA", size: 4, base: 0x91c0, destination: "address" },
  { name: "CMPA", size: 2, base: 0xb0c0, destination: "address" },
  { name: "CMPA", size: 4, base: 0xb1c0, destination: "address" },
] as const;
const logicForms = [
  { name: "AND", size: 1, base: 0xc000, destination: "data" },
  { name: "AND", size: 2, base: 0xc040, destination: "data" },
  { name: "AND", size: 4, base: 0xc080, destination: "data" },
  { name: "AND", size: 1, base: 0xc100, destination: "memory" },
  { name: "AND", size: 2, base: 0xc140, destination: "memory" },
  { name: "AND", size: 4, base: 0xc180, destination: "memory" },
  { name: "OR", size: 1, base: 0x8000, destination: "data" },
  { name: "OR", size: 2, base: 0x8040, destination: "data" },
  { name: "OR", size: 4, base: 0x8080, destination: "data" },
  { name: "OR", size: 1, base: 0x8100, destination: "memory" },
  { name: "OR", size: 2, base: 0x8140, destination: "memory" },
  { name: "OR", size: 4, base: 0x8180, destination: "memory" },
  { name: "EOR", size: 1, base: 0xb100, destination: "ea" },
  { name: "EOR", size: 2, base: 0xb140, destination: "ea" },
  { name: "EOR", size: 4, base: 0xb180, destination: "ea" },
] as const;
type AluForm = typeof arithmeticForms[number] | typeof logicForms[number];

function checkAlu(ram: ObservedRam, before: Cpu68000State, form: AluForm,
  selector: number, ea: TransferFixture, memoryValue = 0x81234567): void {
  const { name, size, base, destination } = form;
  const modulus = 2 ** (size * 8);
  const bytes = [...wordBytes(base + selector * 512 + ea.code), ...ea.extension];
  const memory = new Map<number, number>();
  if (ea.address !== undefined) {
    memory.set(physical(ea.address - 1), 0xde);
    memory.set(physical(ea.address + size), 0xad);
    bytesFor(size, memoryValue).forEach((byte, offset) => memory.set(physical(ea.address! + offset), byte));
  }
  // Seed code last so a source or read/modify/write destination may overlap its own instruction.
  bytes.forEach((byte, offset) => memory.set(physical(before.pc + offset), byte));
  for (const [address, byte] of memory) ram.write(address, byte);
  const accesses: Cpu68000MemoryAccess[] = bytes.map((value, offset) => ({ kind: "read", address: physical(before.pc + offset), value }));
  let value = ea.immediate ?? (ea.register === undefined ? 0 : before[ea.register] % modulus);
  if (ea.address !== undefined) {
    value = 0;
    for (let offset = 0; offset < size; offset++) {
      const address = physical(ea.address + offset);
      const byte = memory.get(address)!;
      accesses.push({ kind: "read", address, value: byte });
      value = value * 256 + byte;
    }
  }
  const after = { ...before, flags: { ...before.flags }, pc: unsignedLong(before.pc + bytes.length) };
  if (ea.update) after[ea.update[0]] = ea.update[1];
  const toEa = destination === "memory" || destination === "ea";
  const register = destination === "address" ? addressNames(before)[selector]!
    : destination === "ea" && ea.register !== undefined ? ea.register : registerForms[selector]!.register;
  const left = toEa ? value : after[register] % (destination === "address" ? 4294967296 : modulus);
  const right = toEa ? before[registerForms[selector]!.register] % modulus
    : destination === "address" && size === 2 ? unsignedLong(signedWord(value)) : value;
  let result: number;
  if (name === "ADDA" || name === "SUBA") {
    result = Number(BigInt.asUintN(32, BigInt(left) + (name === "ADDA" ? 1n : -1n) * BigInt(right)));
  } else {
    const operation = { ADD: "ADDI", SUB: "SUBI", CMP: "CMPI", CMPA: "CMPI", AND: "ANDI", OR: "ORI", EOR: "EORI" } as const;
    const expected = immediateResult(operation[name],
      destination === "address" ? 4 : size, left, right, before.flags);
    result = expected.result;
    after.flags = expected.flags;
  }
  if (name !== "CMP" && name !== "CMPA") {
    if (toEa && ea.address !== undefined) bytesFor(size, result).forEach((byte, offset) => {
      const address = physical(ea.address! + offset);
      accesses.push({ kind: "write", address, value: byte });
      memory.set(address, byte);
    });
    else after[register] = destination === "address" ? result : Math.floor(before[register] / modulus) * modulus + result;
  }
  const cpu = new Cpu68000(ram, before);
  ram.accesses.length = 0;
  after.ir = bytes[0]! * 256 + bytes[1]!;
  assert.deepEqual(cpu.step(), { before: snapshot(before), after: snapshot(after), outcome: "executed",
    instruction: { address: before.pc, bytes }, accesses }, `${name} ${bytes.slice(0, 2).map(b => b.toString(16)).join(" ")}`);
  assert.deepEqual(cpu.snapshot(), snapshot(after));
  assert.deepEqual(ram.accesses, accesses);
  for (const [address, byte] of memory) assert.equal(ram.read(address), byte);
}

for (const [name, count] of [["ADD", 2408], ["SUB", 2408], ["CMP", 1400], ["ADDA", 976], ["SUBA", 976], ["CMPA", 976]] as const) {
  test(`68000 ${name} executes all ${count} forms with both stacks, register aliases, and exact accesses`, () => {
    const ram = new ObservedRam(0x1000000);
    for (const bits of [0, 31, 64, 127]) {
      const before = transferState(bits);
      let forms = 0;
      for (const form of arithmeticForms.filter(form => form.name === name)) {
        for (let register = 0; register < 8; register++) for (const ea of transferFixtures(before, form.size, before.pc + 2)) {
          if (form.destination === "memory" ? ea.code < 16 || ea.code > 57 : form.size === 1 && ea.code >= 8 && ea.code < 16) continue;
          checkAlu(ram, before, form, register, ea);
          forms++;
        }
      }
      assert.equal(forms, count);
    }
  });
}

for (const [name, opcode, oracle] of [["ADD", 0xd001, "ADDI"], ["SUB", 0x9001, "SUBI"], ["CMP", 0xb001, "CMPI"]] as const) {
  test(`68000 ${name}.B checks every register operand pair and preserves the upper destination bytes`, () => {
    const ram = new ObservedRam(0x1000000);
    for (let left = 0; left < 256; left++) for (let right = 0; right < 256; right++) {
      const before = initialState({ d0: 0xabcdef00 + left, d1: 0x12345600 + right, flags: flags((left + right) % 128) });
      const expected = immediateResult(oracle, 1, left, right, before.flags);
      checkStep(ram, before, wordBytes(opcode), { ...before, pc: before.pc + 2, flags: expected.flags,
        d0: name === "CMP" ? before.d0 : 0xabcdef00 + expected.result });
    }
  });
}

test("68000 word/long data and address arithmetic checks signed boundaries with every incoming flag pattern", () => {
  const ram = new ObservedRam(0x1000000);
  const values = [0, 1, 0x7fff, 0x8000, 0xffff, 0x10000, 0x7fffffff, 0x80000000, 0xfffffffe, 0xffffffff];
  for (const form of arithmeticForms.filter(form => form.size !== 1)) for (let bits = 0; bits < 128; bits++) {
    for (const left of values) for (const right of values) {
      const before = { ...transferState(bits), d0: left, d1: right, a0: left };
      const ea: TransferFixture = form.destination === "memory" ? { code: 57, extension: [0x12, 0, 0x30, 0], address: 0x12003000 }
        : { code: 1, extension: [], register: "d1" };
      checkAlu(ram, before, form, 0, ea, right);
    }
  }
});

test("68000 ADDA/SUBA/CMPA sign-extend every word and use all 32 destination bits", () => {
  const ram = new ObservedRam(0x1000000);
  for (const form of arithmeticForms.filter(form => form.destination === "address" && form.size === 2)) {
    for (let value = 0; value < 65536; value++) {
      const before = initialState({ d1: 0xabcd0000 + value, a0: 0x80000000, flags: flags(value % 128) });
      checkAlu(ram, before, form, 0, { code: 1, extension: [], register: "d1" });
    }
  }
});

test("68000 arithmetic and logic resolve memory once, accept odd bytes, and wrap operands, A7 updates, and PC", () => {
  const ram = new ObservedRam(0x1000000);
  for (const form of [...arithmeticForms, ...logicForms]) for (const bits of [0, 127]) {
    for (const address of [form.size === 1 ? 0xffffffff : 0xfffffffe, 0xab001000]) {
      const before = { ...transferState(bits), pc: 0xfffffffe, usp: address, ssp: address, d7: 0xffff8000 };
      for (const code of [31, 39, 57]) {
        const step = form.size === 1 ? 2 : form.size;
        const ea: TransferFixture = code === 57 ? { code, extension: longBytes(address), address }
          : { code, extension: [], address: code === 31 ? address : unsignedLong(address - step),
              update: [bits === 0 ? "usp" : "ssp", unsignedLong(address + (code === 31 ? step : -step))] };
        checkAlu(ram, before, form, 7, ea);
      }
      if (form.destination === "data" || form.destination === "address") {
        checkAlu(ram, before, form, 7, { code: 58, extension: [0xff, 0xfe], address: 0xfffffffe });
        checkAlu(ram, before, form, 7, { code: 59, extension: [0x70, 0xfe], address: 0xffff7ffe });
      }
    }
  }
});

test("68000 CMPA compares against its own updated source pointer, preserving X and committing the update", () => {
  const ram = new ObservedRam(0x1000000);
  for (const form of arithmeticForms.filter(form => form.name === "CMPA")) for (let bits = 0; bits < 128; bits++) {
    for (const base of [0x1000, 0xffff9000]) for (const [selector, register] of addressNames(initialState({ flags: flags(bits) })).entries()) {
      const before = { ...transferState(bits), pc: 0xab004000, [register]: base };
      for (const [code, address, updated] of [[24 + selector, base, unsignedLong(base + form.size)],
        [32 + selector, unsignedLong(base - form.size), unsignedLong(base - form.size)]] as const) {
        // Memory equals An after auto-update, so CMPA must set Z; reading old An would fail.
        checkAlu(ram, before, form, selector, { code, extension: [], address, update: [register, updated] }, updated);
      }
    }
  }
});

test("68000 all word/long arithmetic and logic memory modes enter vector 3 before committing pending An updates", () => {
  const ram = new ObservedRam(0x1000000);
  for (const form of [...arithmeticForms, ...logicForms].filter(form => form.size !== 1)) for (const bits of [0, 127]) {
    const state = transferState(bits);
    for (const register of addressNames(state)) state[register]++;
    for (const ea of transferFixtures(state, form.size, state.pc + 2)) {
      if (ea.address === undefined || ((form.destination === "memory" || form.destination === "ea") && ea.code > 57)) continue;
      const extension = [...ea.extension];
      let address = ea.address;
      if (address % 2 === 0) {
        address = unsignedLong(address + 1);
        extension[extension.length - 1]!++;
      }
      const bytes = [...wordBytes(form.base + 7 * 512 + ea.code), ...extension];
      bytes.forEach((value, offset) => ram.write(0x1000 + offset, value));
      ram.write(physical(address), 0xa5);
      const before = snapshot(state);
      const accesses = bytes.map((value, offset) => ({ kind: "read" as const, address: 0x1000 + offset, value }));
      for (let attempt = 0; attempt < 2; attempt++) {
        ram.accesses.length = 0;
        const expected = addressErrorRecord({ before, instruction: { address: state.pc, bytes }, accesses, fault: { operation: "read", address } });
        assert.deepEqual(new Cpu68000(ram, before).step(), expected);
        assert.deepEqual(ram.accesses, expected.accesses);
        assert.equal(ram.read(physical(address)), 0xa5);
      }
    }
  }
});

for (const [name, count] of [["AND", 2280], ["OR", 2280], ["EOR", 1200]] as const) {
  test(`68000 ${name} executes all ${count} forms with both stacks, register aliases, and exact accesses`, () => {
    const ram = new ObservedRam(0x1000000);
    for (const bits of [0, 31, 64, 127]) {
      const before = transferState(bits);
      let forms = 0;
      for (const form of logicForms.filter(form => form.name === name)) {
        for (let register = 0; register < 8; register++) for (const ea of transferFixtures(before, form.size, before.pc + 2)) {
          if (ea.code >= 8 && ea.code < 16) continue;
          if (form.destination === "memory" && ea.code < 16) continue;
          if (form.destination !== "data" && ea.code > 57) continue;
          checkAlu(ram, before, form, register, ea);
          forms++;
        }
      }
      assert.equal(forms, count);
    }
  });
}

for (const [name, opcode, oracle] of [["AND", 0xc001, "ANDI"], ["OR", 0x8001, "ORI"], ["EOR", 0xb300, "EORI"]] as const) {
  test(`68000 ${name}.B checks every register operand pair against bit truth tables and preserves upper bytes`, () => {
    const ram = new ObservedRam(0x1000000);
    for (let left = 0; left < 256; left++) for (let right = 0; right < 256; right++) {
      const before = initialState({ d0: 0xabcdef00 + left, d1: 0x12345600 + right, flags: flags((left + right) % 128) });
      const expected = immediateResult(oracle, 1, left, right, before.flags);
      checkStep(ram, before, wordBytes(opcode), { ...before, pc: before.pc + 2, flags: expected.flags,
        d0: 0xabcdef00 + expected.result });
    }
  });
}

test("68000 logic tests every result bit, high-bit longs, identities, and incoming flag pattern in both directions", () => {
  const ram = new ObservedRam(0x1000000);
  for (const form of logicForms) {
    const modulus = 2 ** (form.size * 8);
    for (let bits = 0; bits < 128; bits++) {
      const bit = 2 ** (bits % (form.size * 8));
      for (const [left, right] of [[0, 0], [bit, bit], [bit, modulus - 1 - bit], [bit, 0],
        [bit, modulus - 1], [0xaaaaaaaa % modulus, 0x55555555 % modulus]] as const) {
        const before = { ...transferState(bits), d0: 0xabcd0000 + left % 65536, d1: right };
        if (form.size === 4) before.d0 = left;
        // EA-to-Dn reads D1; Dn-to-EA reads D0 and modifies RAM or D1.
        if (form.destination !== "data") before.d0 = right;
        if (form.destination === "ea") {
          before.d1 = form.size === 4 ? left : 0xef120000 + left;
          checkAlu(ram, before, form, 0, { code: 1, extension: [], register: "d1" });
        } else {
          const ea: TransferFixture = form.destination === "data" ? { code: 1, extension: [], register: "d1" }
            : { code: 57, extension: [0x12, 0, 0x30, 0], address: 0x12003000 };
          checkAlu(ram, before, form, 0, ea, left);
        }
      }
    }
  }
});

test("68000 EOR memory writes, including unchanged values, cover every size, result bit, and flag pattern", () => {
  const ram = new ObservedRam(0x1000000);
  for (const form of logicForms.filter(form => form.name === "EOR")) for (let bits = 0; bits < 128; bits++) {
    const value = 2 ** (bits % (form.size * 8));
    for (const source of [0, value, 2 ** (form.size * 8) - 1]) {
      const before = { ...transferState(bits), d0: source };
      for (const ea of transferFixtures(before, form.size, before.pc + 2).filter(ea => [31, 39, 57].includes(ea.code))) {
        checkAlu(ram, before, form, 0, ea, value);
      }
    }
  }
});

test("68000 invalid logic address forms enter vector 4 before any operand accesses", () => {
  const ram = new ObservedRam(0x1000000);
  const before = initialState();
  // OR/AND An sources; EOR PC/immediate destinations. Mode 001 in EOR's slot is CMPM.
  for (const opcode of [0x8008, 0x8048, 0x8088, 0xc008, 0xc048, 0xc088, 0xb17a, 0xb1bb, 0xb1bc]) {
    checkException(ram, before, wordBytes(opcode), "illegal-instruction", 4);
  }
});

const immediateFamilies = [
  { name: "ORI", base: 0x0000 }, { name: "ANDI", base: 0x0200 }, { name: "SUBI", base: 0x0400 },
  { name: "ADDI", base: 0x0600 }, { name: "EORI", base: 0x0a00 }, { name: "CMPI", base: 0x0c00 },
] as const;
type ImmediateName = typeof immediateFamilies[number]["name"];

// Independently derive arithmetic from BigInt signed ranges and logic from bit truth tables.
function immediateResult(name: ImmediateName, size: number, left: number, right: number, before: Cpu68000Flags) {
  const width = size * 8;
  const modulus = 2 ** width;
  const sign = modulus / 2;
  let result: number;
  let carry = false;
  let overflow = false;
  let extend = before.x;
  if (name === "ADDI" || name === "SUBI" || name === "CMPI") {
    const direction = name === "ADDI" ? 1n : -1n;
    const total = BigInt(left) + direction * BigInt(right);
    result = Number(BigInt.asUintN(width, total));
    const signed = BigInt.asIntN(width, BigInt(left)) + direction * BigInt.asIntN(width, BigInt(right));
    carry = total < 0n || total >= BigInt(modulus);
    overflow = signed < -BigInt(sign) || signed >= BigInt(sign);
    if (name !== "CMPI") extend = carry;
  } else {
    result = 0;
    for (let bit = 0; bit < width; bit++) {
      const l = Math.floor(left / 2 ** bit) % 2 === 1;
      const r = Math.floor(right / 2 ** bit) % 2 === 1;
      if (name === "ANDI" ? l && r : name === "ORI" ? l || r : l !== r) result += 2 ** bit;
    }
  }
  return { result, flags: { ...before, x: extend, n: result >= sign, z: result === 0, v: overflow, c: carry } };
}

function checkImmediate(ram: ObservedRam, before: Cpu68000State, name: ImmediateName, opcode: number,
  size: number, destination: TransferFixture, value: number, immediate: number, highByte = 0xa5): void {
  const bytes = [...wordBytes(opcode), ...(size === 4 ? longBytes(immediate) : wordBytes(immediate + (size === 1 ? highByte * 256 : 0))),
    ...destination.extension];
  const memory = new Map<number, number>();
  if (destination.register) before = { ...before, [destination.register]:
    Math.floor(before[destination.register] / 2 ** (size * 8)) * 2 ** (size * 8) + value };
  if (destination.address !== undefined) {
    memory.set(physical(destination.address - 1), 0xde);
    memory.set(physical(destination.address + size), 0xad);
    bytesFor(size, value).forEach((byte, offset) => memory.set(physical(destination.address! + offset), byte));
  }
  // Code can overlap the operand: fetching completes before its read or write.
  bytes.forEach((byte, offset) => memory.set(physical(before.pc + offset), byte));
  for (const [address, byte] of memory) ram.write(address, byte);
  const accesses: Cpu68000MemoryAccess[] = bytes.map((byte, offset) =>
    ({ kind: "read", address: physical(before.pc + offset), value: byte }));
  if (destination.address !== undefined) {
    value = 0;
    for (let offset = 0; offset < size; offset++) {
      const address = physical(destination.address + offset);
      const byte = memory.get(address)!;
      accesses.push({ kind: "read", address, value: byte });
      value = value * 256 + byte;
    }
  }
  const expected = immediateResult(name, size, value, immediate, before.flags);
  const after = { ...before, flags: expected.flags, pc: unsignedLong(before.pc + bytes.length) };
  if (destination.update) after[destination.update[0]] = destination.update[1];
  if (name !== "CMPI") {
    if (destination.register) after[destination.register] =
      Math.floor(before[destination.register] / 2 ** (size * 8)) * 2 ** (size * 8) + expected.result;
    else bytesFor(size, expected.result).forEach((byte, offset) => {
      const address = physical(destination.address! + offset);
      accesses.push({ kind: "write", address, value: byte });
      memory.set(address, byte);
    });
  }
  const cpu = new Cpu68000(ram, before);
  ram.accesses.length = 0;
  after.ir = bytes[0]! * 256 + bytes[1]!;
  assert.deepEqual(cpu.step(), { before: snapshot(before), after: snapshot(after), outcome: "executed",
    instruction: { address: before.pc, bytes }, accesses }, `${name} ${opcode.toString(16)}`);
  assert.deepEqual(cpu.snapshot(), snapshot(after));
  assert.deepEqual(ram.accesses, accesses);
  for (const [address, byte] of memory) assert.equal(ram.read(address), byte);
}

for (const { name, base } of immediateFamilies) {
  test(`68000 ${name} executes all 150 size/address forms with every incoming flag pattern`, () => {
    const ram = new ObservedRam(0x1000000);
    for (let bits = 0; bits < 128; bits++) {
      const before = transferState(bits);
      let forms = 0;
      for (const [size, code] of [[1, 0], [2, 0x40], [4, 0x80]] as const) {
        const sign = 2 ** (size * 8 - 1);
        const pairs = [[0, 0], [0, 1], [sign - 1, 1], [sign, 1], [sign, sign], [sign * 2 - 1, sign * 2 - 1]];
        for (const destination of transferFixtures(before, size, before.pc + (size === 4 ? 6 : 4))) {
          if ((destination.code >= 8 && destination.code < 16) || destination.code > 57) continue;
          const [left, right] = pairs[(bits + destination.code) % pairs.length]!;
          checkImmediate(ram, before, name, base + code + destination.code, size, destination, left!, right!);
          forms++;
        }
      }
      assert.equal(forms, 150);
    }
  });

  test(`68000 ${name}.B checks every operand pair against an independent oracle`, () => {
    const ram = new ObservedRam(0x1000000);
    for (let left = 0; left < 256; left++) for (let right = 0; right < 256; right++) {
      const before = initialState({ d0: 0xabcdef00 + left, flags: flags((left + right) % 128) });
      const expected = immediateResult(name, 1, left, right, before.flags);
      checkStep(ram, before, [...wordBytes(base), 0xa5, right], { ...before, pc: before.pc + 4,
        d0: name === "CMPI" ? before.d0 : 0xabcdef00 + expected.result, flags: expected.flags });
    }
  });

  test(`68000 ${name}.W/L checks signed and unsigned boundaries in registers and memory`, () => {
    const ram = new ObservedRam(0x1000000);
    for (const [size, code] of [[2, 0x40], [4, 0x80]] as const) {
      const sign = 2 ** (size * 8 - 1);
      const values = [0, 1, 0xff, 0x100, 0x7fff, 0x8000, 0xffff, sign - 1, sign, sign + 1, sign * 2 - 1];
      for (const bits of [0, 127]) for (const left of values) for (const right of values) {
        const before = transferState(bits);
        for (const destination of [{ code: 0, extension: [], register: "d0" },
          { code: 24, extension: [], address: before.a0, update: ["a0", before.a0 + size] }] as const) {
          checkImmediate(ram, before, name, base + code + destination.code, size, destination, left, right);
        }
      }
    }
  });
}

test("68000 byte immediates ignore every high byte and still write memory for identity operations", () => {
  const ram = new ObservedRam(0x1000000);
  const before = transferState(127);
  for (const { name, base } of immediateFamilies) for (let high = 0; high < 256; high++) {
    checkImmediate(ram, before, name, base + 16, 1, { code: 16, extension: [], address: before.a0 },
      0x80, name === "ANDI" ? 0xff : 0, high);
  }
});

test("68000 immediate read/modify/write wraps addresses, updates either stack once, and fetches before code overlap", () => {
  const ram = new ObservedRam(0x1000000);
  for (const { name, base } of immediateFamilies) for (const [size, code] of [[1, 0], [2, 0x40], [4, 0x80]] as const) {
    for (const bits of [0, 127]) for (const address of [0, 0x12fffffe, 0xfffffffe]) {
      const before = transferState(bits);
      before.usp = before.ssp = address;
      const stack = before.flags.s ? "ssp" : "usp";
      const step = size === 1 ? 2 : size;
      checkImmediate(ram, before, name, base + code + 31, size,
        { code: 31, extension: [], address, update: [stack, unsignedLong(address + step)] }, 0, 1);
      const previous = unsignedLong(address - step);
      checkImmediate(ram, before, name, base + code + 39, size,
        { code: 39, extension: [], address: previous, update: [stack, previous] }, 0, 1);
    }
    for (const pc of [0xab001000, 0x12fffffe, 0xfffffffe]) {
      const before = initialState({ pc });
      for (const offset of [0, 2, 4]) {
        const address = unsignedLong(pc + offset);
        checkImmediate(ram, before, name, base + code + 57, size,
          { code: 57, extension: longBytes(address), address }, 0, 1);
      }
    }
  }
});

test("68000 immediate ALU enters vector 3 for every odd word/long EA before operand access or writeback", () => {
  const ram = new ObservedRam(0x1000000);
  for (const { base } of immediateFamilies) for (const [size, code] of [[2, 0x40], [4, 0x80]] as const) {
    for (const bits of [0, 127]) {
      const state = transferState(bits);
      for (const register of addressNames(state)) state[register]++;
      const destinations = transferFixtures(state, size, state.pc + (size === 4 ? 6 : 4));
      destinations.push({ code: 56, extension: [0xff, 0xff], address: 0xffffffff },
        { code: 57, extension: [0xab, 0xff, 0xff, 0xff], address: 0xabffffff });
      for (const destination of destinations) {
        if (destination.code > 57 || destination.address === undefined || destination.address % 2 === 0) continue;
        const bytes = [...wordBytes(base + code + destination.code), ...bytesFor(size, 1), ...destination.extension];
        const accesses = bytes.map((value, offset) => ({ kind: "read" as const, address: 0x1000 + offset, value }));
        for (const { address, value } of accesses) ram.write(address, value);
        const before = snapshot(state);
        for (let attempt = 0; attempt < 2; attempt++) {
          ram.accesses.length = 0;
          const expected = addressErrorRecord({ before, instruction: { address: state.pc, bytes }, accesses, fault: { operation: "read", address: destination.address } });
          assert.deepEqual(new Cpu68000(ram, before).step(), expected);
          assert.deepEqual(ram.accesses, expected.accesses);
        }
      }
    }
  }
});

test("68000 immediate address errors retain detached records while restored boundaries use changed RAM", () => {
  const ram = new ObservedRam(0x1000000);
  const state = transferState(127);
  const cpu = new Cpu68000(ram, state);
  [0x04, 0x79, 0, 1, 0xff, 0xff, 0xff, 0xff].forEach((value, offset) => ram.write(0x1000 + offset, value));
  const rejected = cpu.step();
  assert.equal(rejected.exception?.source, "address-error");
  const saved = structuredClone(rejected);
  ram.write(0x1007, 0xfe);
  ram.write(0x1003, 2);
  ram.write(0xfffffe, 0);
  ram.write(0xffffff, 1);
  const record = new Cpu68000(ram, state).step();
  assert.equal(record.outcome, "executed");
  assert.deepEqual(record.after, snapshot({ ...state, ir: 0x0479, pc: state.pc + 8,
    flags: { ...state.flags, x: true, n: true, z: false, v: false, c: true } }));
  assert.deepEqual(record.accesses.slice(-4), [
    { kind: "read", address: 0xfffffe, value: 0 }, { kind: "read", address: 0xffffff, value: 1 },
    { kind: "write", address: 0xfffffe, value: 0xff }, { kind: "write", address: 0xffffff, value: 0xff },
  ]);
  assert.deepEqual(rejected, saved);
});

// Literal manual encodings and sixteen-row truth tables, indexed by NZVC (N is bit 3).
// These expected tests do not reuse the core's predicates or a branch decoder.
const conditionForms = [
  { name: "T", branch: 0x6000, db: 0x50c8, truth: 0xffff },
  { name: "F", branch: 0x6100, db: 0x51c8, truth: 0x0000 },
  { name: "HI", branch: 0x6200, db: 0x52c8, truth: 0x0505 },
  { name: "LS", branch: 0x6300, db: 0x53c8, truth: 0xfafa },
  { name: "CC", branch: 0x6400, db: 0x54c8, truth: 0x5555 },
  { name: "CS", branch: 0x6500, db: 0x55c8, truth: 0xaaaa },
  { name: "NE", branch: 0x6600, db: 0x56c8, truth: 0x0f0f },
  { name: "EQ", branch: 0x6700, db: 0x57c8, truth: 0xf0f0 },
  { name: "VC", branch: 0x6800, db: 0x58c8, truth: 0x3333 },
  { name: "VS", branch: 0x6900, db: 0x59c8, truth: 0xcccc },
  { name: "PL", branch: 0x6a00, db: 0x5ac8, truth: 0x00ff },
  { name: "MI", branch: 0x6b00, db: 0x5bc8, truth: 0xff00 },
  { name: "GE", branch: 0x6c00, db: 0x5cc8, truth: 0xcc33 },
  { name: "LT", branch: 0x6d00, db: 0x5dc8, truth: 0x33cc },
  { name: "GT", branch: 0x6e00, db: 0x5ec8, truth: 0x0c03 },
  { name: "LE", branch: 0x6f00, db: 0x5fc8, truth: 0xf3fc },
] as const;

function conditionResult(truth: number, { n, z, v, c }: Cpu68000Flags): boolean {
  const row = Number(n) * 8 + Number(z) * 4 + Number(v) * 2 + Number(c);
  return Math.floor(truth / 2 ** row) % 2 === 1;
}

function checkControlAddressError(ram: ObservedRam, before: Cpu68000State, bytes: readonly number[],
  operation: "fetch" | "read" | "write", address: number, data: readonly Cpu68000MemoryAccess[] = []): void {
  const fetches = bytes.map((value, offset) => ({ kind: "read" as const, address: physical(before.pc + offset), value }));
  for (const { address, value } of fetches) ram.write(address, value);
  ram.accesses.length = 0;
  const expected = addressErrorRecord({ before: snapshot(before), instruction: { address: before.pc, bytes }, fault: { operation, address }, accesses: [...fetches, ...data] });
  assert.deepEqual(new Cpu68000(ram, before).step(), expected);
  assert.deepEqual(ram.accesses, expected.accesses);
}

function checkBranch(ram: ObservedRam, before: Cpu68000State, branch: number, byte: number, word: number, take: boolean): void {
  const bytes = [...wordBytes(branch + byte), ...(byte === 0 ? wordBytes(word) : [])];
  const displacement = byte === 0 ? (word < 32768 ? word : word - 65536) : (byte < 128 ? byte : byte - 256);
  const target = unsignedLong(before.pc + 2 + displacement);
  const returnAddress = unsignedLong(before.pc + bytes.length);
  const after = { ...before, flags: { ...before.flags }, pc: take ? target : returnAddress };
  if (take && target % 2 !== 0) {
    checkControlAddressError(ram, before, bytes, "fetch", target);
    return;
  }
  const writes: Cpu68000MemoryAccess[] = [];
  if (branch === 0x6100) {
    const stack = before.flags.s ? "ssp" : "usp";
    after[stack] = unsignedLong(before[stack] - 4);
    longBytes(returnAddress).forEach((value, offset) => writes.push({ kind: "write", address: physical(after[stack] + offset), value }));
  }
  checkStep(ram, before, bytes, after, writes);
}

for (const { name, branch, truth } of conditionForms) {
  test(`68000 ${name === "T" ? "BRA" : name === "F" ? "BSR" : `B${name}`} checks every embedded displacement and all incoming flags`, () => {
    const ram = new ObservedRam(0x1000000);
    for (let bits = 0; bits < 128; bits++) {
      const before = initialState({ flags: flags(bits), interruptMask: bits % 8 });
      const take = branch === 0x6100 || conditionResult(truth, before.flags);
      for (let byte = 0; byte < 256; byte++) checkBranch(ram, before, branch, byte, 0xff80, take);
      for (const word of [0, 1, 2, 3, 0x7ffe, 0x7fff, 0x8000, 0x8001, 0xfffc, 0xfffe, 0xffff]) {
        checkBranch(ram, before, branch, 0, word, take);
      }
    }
  });
}

test("68000 BRA and BSR exhaust every word displacement and preserve full logical branch/return addresses", () => {
  const ram = new ObservedRam(0x1000000);
  const addresses = [0, 0x12fffffe, 0x80000000, 0xfffffffe];
  for (let word = 0; word < 65536; word++) {
    const before = initialState({ pc: addresses[word % addresses.length]!, flags: flags(word % 128) });
    checkBranch(ram, before, 0x6000, 0, word, true);
    checkBranch(ram, before, 0x6100, 0, word, true);
  }
});

function checkDecrementBranch(ram: ObservedRam, before: Cpu68000State, opcode: number, register: DataRegister,
  word: number, condition: boolean): void {
  const bytes = [...wordBytes(opcode), ...wordBytes(word)];
  const counter = condition ? before[register] % 65536 : (before[register] % 65536 + 65535) % 65536;
  const take = !condition && counter !== 65535;
  const target = unsignedLong(before.pc + 2 + (word < 32768 ? word : word - 65536));
  if (take && target % 2 !== 0) {
    checkControlAddressError(ram, before, bytes, "fetch", target);
    return;
  }
  checkStep(ram, before, bytes, { ...before, pc: take ? target : unsignedLong(before.pc + 4),
    [register]: Math.floor(before[register] / 65536) * 65536 + counter });
}

test("68000 DBcc checks all conditions and registers against every flag pattern, preserving upper words and flags", () => {
  const ram = new ObservedRam(0x1000000);
  for (const { db, truth } of conditionForms) for (const [code, { register }] of registerForms.entries()) {
    for (let bits = 0; bits < 128; bits++) for (const low of [0, 1, 2, 0x7fff, 0x8000, 0xffff]) {
      const before = initialState({ [register]: 0xabcd0000 + low, flags: flags(bits), interruptMask: bits % 8 });
      for (const word of [0xfffc, 0xffff]) {
        checkDecrementBranch(ram, before, db + code, register, word, conditionResult(truth, before.flags));
      }
    }
  }
});

test("68000 DBT and DBF exhaust low-word counters, including zero and FFFF, without arithmetic flags", () => {
  const ram = new ObservedRam(0x1000000);
  for (let low = 0; low < 65536; low++) {
    const before = initialState({ d7: 0xffff0000 + low, flags: flags(low % 128) });
    checkDecrementBranch(ram, before, 0x50cf, "d7", 0xfffe, true);
    checkDecrementBranch(ram, before, 0x51cf, "d7", 0xfffe, false);
  }
});

test("68000 DBF exhausts word displacements while fetching across the physical bus and logical PC boundaries", () => {
  const ram = new ObservedRam(0x1000000);
  for (let word = 0; word < 65536; word++) {
    const before = initialState({ pc: word % 2 ? 0x12fffffe : 0xfffffffe, d3: 0x80000002, flags: flags(word % 128) });
    checkDecrementBranch(ram, before, 0x51cb, "d3", word, false);
  }
});

test("68000 calls and returns use the active stack, two-byte alignment, and physical/32-bit wrapping", () => {
  const ram = new ObservedRam(0x1000000);
  for (let bits = 0; bits < 128; bits++) {
    for (const stackAddress of [0, 2, 0x12000002, 0x34fffffe, 0xfffffffe]) {
      const stack = bits & 64 ? "ssp" : "usp";
      const before = initialState({ [stack]: stackAddress, flags: flags(bits), interruptMask: bits % 8 });
      const pushed = unsignedLong(stackAddress - 4);
      for (const [byte, word] of [[0x7e, 0], [0x80, 0], [0, 0x100], [0, 0x8000]] as const) {
        const cpu = new Cpu68000(ram, before);
        const bytes = [0x61, byte, ...(byte === 0 ? wordBytes(word) : [])];
        const returnAddress = before.pc + bytes.length;
        const target = unsignedLong(before.pc + 2 + (byte === 0 ? signedWord(word) : (byte < 128 ? byte : byte - 256)));
        const entered = { ...before, pc: target, [stack]: pushed };
        const writes = longBytes(returnAddress).map((value, offset) => ({ kind: "write" as const, address: physical(pushed + offset), value }));
        checkStep(ram, before, bytes, entered, writes, cpu);
        const reads = writes.map(access => ({ ...access, kind: "read" as const }));
        checkStep(ram, entered, [0x4e, 0x75], { ...before, pc: returnAddress }, reads, cpu);
      }
    }
  }
});

test("68000 RTS reads current big-endian return addresses, including zero, high bits, and odd targets", () => {
  const ram = new ObservedRam(0x1000000);
  for (const s of [false, true]) for (const target of [0, 2, 0x80000000, 0xabcdef02, 0xfffffffe, 1, 0xffffffff]) {
    const before = initialState({ flags: { ...flags(127), s } });
    const stack = s ? "ssp" : "usp";
    const reads = longBytes(target).map((value, offset) => ({ kind: "read" as const, address: physical(before[stack] + offset), value }));
    for (const { address, value } of reads) ram.write(address, value);
    if (target % 2) checkControlAddressError(ram, before, [0x4e, 0x75], "fetch", target, reads);
    else checkStep(ram, before, [0x4e, 0x75], { ...before, pc: target, [stack]: unsignedLong(before[stack] + 4) }, reads);
  }
});

test("68000 odd call and return stack addresses enter vector 3 before instruction stack changes", () => {
  const ram = new ObservedRam(0x1000000);
  for (const s of [false, true]) for (const address of [1, 3, 0x12ffffff, 0xffffffff]) {
    const stack = s ? "ssp" : "usp";
    const before = initialState({ [stack]: address, flags: { ...flags(127), s } });
    for (const bytes of [[0x61, 2], [0x61, 0, 0x80, 0], [0x61, 1]]) {
      // Stack alignment takes priority when both the stack and taken target are odd.
      checkControlAddressError(ram, before, bytes, "write", unsignedLong(address - 4));
    }
    checkControlAddressError(ram, before, [0x4e, 0x75], "read", address);
  }
});

test("68000 call fetches finish before overlapping stack writes, and return reads can overlap its opcode", () => {
  const ram = new ObservedRam(0x1000000);
  const before = initialState({ usp: 0xab001006, flags: flags(0) });
  checkStep(ram, before, [0x61, 0, 0, 0xfe], { ...before, pc: 0xab001100, usp: 0xab001002 }, [
    { kind: "write", address: 0x1002, value: 0xab }, { kind: "write", address: 0x1003, value: 0 },
    { kind: "write", address: 0x1004, value: 0x10 }, { kind: "write", address: 0x1005, value: 4 },
  ]);
  ram.write(0x1002, 0x10);
  ram.write(0x1003, 0);
  const returning = { ...before, usp: 0xab001000 };
  checkStep(ram, returning, [0x4e, 0x75], { ...returning, pc: 0x4e751000, usp: 0xab001004 }, [
    { kind: "read", address: 0x1000, value: 0x4e }, { kind: "read", address: 0x1001, value: 0x75 },
    { kind: "read", address: 0x1002, value: 0x10 }, { kind: "read", address: 0x1003, value: 0 },
  ]);
});

test("68000 restored control-transfer boundaries use current RAM and retain detached address-error records", () => {
  const ram = new ObservedRam(0x1000000);
  for (const kind of ["call", "counter", "return"] as const) {
    const before = initialState({ d0: 0xabcd0002, flags: flags(0) });
    const cpu = new Cpu68000(ram, before);
    const bytes = kind === "call" ? [0x61, 0, 0, 1] : kind === "counter" ? [0x51, 0xc8, 0, 1] : [0x4e, 0x75];
    bytes.forEach((value, offset) => ram.write(0x1000 + offset, value));
    longBytes(0xab001001).forEach((value, offset) => ram.write(physical(before.usp + offset), value));
    const fault = cpu.step();
    assert.equal(fault.exception?.source, "address-error");
    const saved = structuredClone(fault);
    assert.deepEqual(new Cpu68000(ram, before).step(), fault);
    ram.write(kind === "return" ? physical(before.usp + 3) : 0x1003, kind === "return" ? 4 : 2);
    const executed = new Cpu68000(ram, before).step();
    assert.equal(executed.outcome, "executed");
    assert.equal(executed.after.pc, 0xab001004);
    assert.equal(executed.after.d0, kind === "counter" ? 0xabcd0001 : before.d0);
    assert.equal(executed.after.usp, before.usp + (kind === "return" ? 4 : kind === "call" ? -4 : 0));
    assert.deepEqual(executed.after.flags, before.flags);
    assert.deepEqual(fault, saved);
    Reflect.set(fault.after.flags, "x", true);
    assert.deepEqual(new Cpu68000(ram, before).snapshot().flags, before.flags);
  }
});

test("68000 branches wrap from the last instruction word on taken and untaken paths, including a zero return address", () => {
  const ram = new ObservedRam(0x1000000);
  for (const pc of [0x12fffffc, 0x12fffffe, 0xfffffffc, 0xfffffffe]) for (const bits of [0, 127]) {
    const before = initialState({ pc, flags: flags(bits) });
    for (const { branch, truth } of conditionForms) {
      const take = branch === 0x6100 || conditionResult(truth, before.flags);
      for (const [byte, word] of [[2, 0], [0xfe, 0], [0, 0], [0, 2], [0, 0xfffe]] as const) {
        checkBranch(ram, before, branch, byte, word, take);
      }
    }
  }
});

const memoryAccesses = (kind: "read" | "write", address: number, bytes: readonly number[]): Cpu68000MemoryAccess[] =>
  bytes.map((value, offset) => ({ kind, address: physical(address + offset), value }));

test("68000 LEA/PEA/JMP/JSR cover all control EAs and destinations, preserving every flag pattern", () => {
  const ram = new ObservedRam(0x1000000);
  for (let bits = 0; bits < 128; bits++) {
    const before = transferState(bits);
    const stack = before.flags.s ? "ssp" : "usp";
    const pushed = unsignedLong(before[stack] - 4);
    const fixtures = transferFixtures(before, 4, before.pc + 2).filter(ea => controlAddresses.includes(ea.code));
    assert.equal(fixtures.length, 28);
    for (const ea of fixtures) {
      const address = ea.address!;
      for (const [n, register] of addressNames(before).entries()) {
        const bytes = [...wordBytes(0x41c0 + n * 512 + ea.code), ...ea.extension];
        checkStep(ram, before, bytes, { ...before, [register]: address, pc: before.pc + bytes.length });
      }
      const pea = [...wordBytes(0x4840 + ea.code), ...ea.extension];
      checkStep(ram, before, pea, { ...before, [stack]: pushed, pc: before.pc + pea.length },
        memoryAccesses("write", pushed, longBytes(address)));
      checkStep(ram, before, [...wordBytes(0x4ec0 + ea.code), ...ea.extension], { ...before, pc: address });
      const jsr = [...wordBytes(0x4e80 + ea.code), ...ea.extension];
      checkStep(ram, before, jsr, { ...before, [stack]: pushed, pc: address },
        memoryAccesses("write", pushed, longBytes(before.pc + jsr.length)));
    }
  }
});

test("68000 address operations preserve odd EAs, validate taken targets, and resolve A7 before a push", () => {
  const ram = new ObservedRam(0x1000000);
  for (const bits of [0, 127]) for (const address of [1, 0x12ffffff, 0xffffffff]) {
    const before = { ...transferState(bits), a0: address };
    const stack = before.flags.s ? "ssp" : "usp";
    const pushed = unsignedLong(before[stack] - 4);
    checkStep(ram, before, [0x41, 0xd0], { ...before, pc: before.pc + 2 }); // LEA (A0),A0
    checkStep(ram, before, [0x48, 0x50], { ...before, [stack]: pushed, pc: before.pc + 2 },
      memoryAccesses("write", pushed, longBytes(address))); // PEA (A0), no target read
    for (const opcode of [0x4e90, 0x4ed0]) checkControlAddressError(ram, before, wordBytes(opcode), "fetch", address);
    for (const opcode of [0x4850, 0x4e90]) {
      checkControlAddressError(ram, { ...before, [stack]: 3 }, wordBytes(opcode), "write", 0xffffffff);
    }
    // A7 as both source and destination must not be changed until its EA has been captured.
    const even = transferState(bits);
    checkStep(ram, even, [0x48, 0x57], { ...even, [stack]: pushed, pc: even.pc + 2 },
      memoryAccesses("write", pushed, longBytes(even[stack])));
    checkStep(ram, even, [0x4e, 0x97], { ...even, [stack]: pushed, pc: even[stack] },
      memoryAccesses("write", pushed, longBytes(even.pc + 2)));
  }
});

test("68000 control EAs and return addresses wrap logical PC and physical stack independently", () => {
  const ram = new ObservedRam(0x1000000);
  for (const pc of [0x12fffffe, 0xfffffffe]) for (const sp of [0, 2, 0x12fffffe, 0xfffffffe]) {
    const before = initialState({ pc, ssp: sp });
    const target = unsignedLong(pc + 2 + 6);
    const pushed = unsignedLong(sp - 4);
    checkStep(ram, before, [0x4e, 0xba, 0, 6], { ...before, ssp: pushed, pc: target },
      memoryAccesses("write", pushed, longBytes(unsignedLong(pc + 4))));
    checkStep(ram, before, [0x43, 0xf8, 0xff, 0xff], { ...before, a1: 0xffffffff, pc: unsignedLong(pc + 4) });
  }
});

test("68000 LINK/UNLK select every An and active stack, preserving flags and handling A7 aliases", () => {
  const ram = new ObservedRam(0x1000000);
  for (let bits = 0; bits < 128; bits++) for (const displacement of [0, 1, 0x7fff, 0x8000, 0xfffe, 0xffff]) {
    const before = transferState(bits);
    const stack = before.flags.s ? "ssp" : "usp";
    const frame = before[stack] - 4;
    for (const [code, register] of addressNames(before).entries()) {
      const saved = code === 7 ? frame : before[register];
      checkStep(ram, before, [...wordBytes(0x4e50 + code), ...wordBytes(displacement)],
        { ...before, [register]: frame, [stack]: unsignedLong(frame + signedWord(displacement)), pc: before.pc + 4 },
        memoryAccesses("write", frame, longBytes(saved)));
      const restored = unsignedLong(0xfedc0000 + displacement); // Odd restored pointers are valid.
      longBytes(restored).forEach((value, offset) => ram.write(physical(before[register] + offset), value));
      checkStep(ram, before, wordBytes(0x4e58 + code),
        { ...before, [stack]: unsignedLong(before[register] + 4), [register]: restored, pc: before.pc + 2 },
        memoryAccesses("read", before[register], longBytes(restored)));
    }
  }
});

test("68000 LINK signed allocations cover every word; frames wrap and fault before operand commits", () => {
  const ram = new ObservedRam(0x1000000);
  const before = initialState({ ssp: 2 });
  for (let displacement = 0; displacement < 65536; displacement++) {
    checkStep(ram, before, [0x4e, 0x56, ...wordBytes(displacement)],
      { ...before, a6: 0xfffffffe, ssp: unsignedLong(0xfffffffe + signedWord(displacement)), pc: before.pc + 4 },
      memoryAccesses("write", 0xfffffffe, longBytes(before.a6)));
  }
  for (const bits of [0, 127]) {
    const state = transferState(bits);
    const stack = state.flags.s ? "ssp" : "usp";
    checkControlAddressError(ram, { ...state, [stack]: 3 }, [0x4e, 0x56, 0xff, 0xf0], "write", 0xffffffff);
    checkControlAddressError(ram, { ...state, a6: 0xffffffff }, [0x4e, 0x5e], "read", 0xffffffff);
    longBytes(0x12345679).forEach((value, offset) => ram.write(physical(0xfffffffe + offset), value));
    checkStep(ram, { ...state, a6: 0xfffffffe }, [0x4e, 0x5e],
      { ...state, a6: 0x12345679, [stack]: 2, pc: state.pc + 2 }, memoryAccesses("read", 0xfffffffe, longBytes(0x12345679)));
  }
});

// Enumerate selected register names from the manual's list, independently of the CPU's bit loop.
// A memory map supplies data/guards and accounts for code/data overlap before execution.
function checkMultiple(ram: ObservedRam, before: Cpu68000State, form: typeof multipleForms[number],
  ea: TransferFixture, mask: number): void {
  const predecrement = ea.code >= 32 && ea.code <= 39;
  const postincrement = ea.code >= 24 && ea.code <= 31;
  const names = [...registerForms.map(row => row.register), ...addressNames(before)];
  const selected = names.filter((_name, index) => Math.floor(mask / 2 ** (predecrement ? 15 - index : index)) % 2 === 1);
  if (predecrement) selected.reverse();
  const bytes = [...wordBytes(form.base + ea.code), ...wordBytes(mask), ...ea.extension];
  const after = { ...before, pc: unsignedLong(before.pc + bytes.length) };
  const memory = new Map<number, number>();
  const addresses = selected.map((_name, index) => unsignedLong(ea.address! + (predecrement ? -index : index) * form.size));
  for (const [index, address] of addresses.entries()) {
    // Signed word boundaries, distinct long values, and guards around every transfer.
    const value = unsignedLong(0x89ab7fff + index * 0x10001);
    for (let offset = -1; offset <= form.size; offset++) memory.set(physical(address + offset), 0xa5);
    bytesFor(form.size, value).forEach((byte, offset) => memory.set(physical(address + offset), byte));
  }
  bytes.forEach((value, offset) => memory.set(physical(before.pc + offset), value));
  for (const [address, value] of memory) ram.write(address, value);
  const accesses = memoryAccesses("read", before.pc, bytes);
  for (const [index, register] of selected.entries()) {
    const address = addresses[index]!;
    if (form.load) {
      const data = Array.from({ length: form.size }, (_unused, offset) => memory.get(physical(address + offset))!);
      const value = data.reduce((total, byte) => total * 256 + byte, 0);
      after[register] = unsignedLong(form.size === 2 ? signedWord(value) : value);
      accesses.push(...memoryAccesses("read", address, data));
    } else {
      const data = bytesFor(form.size, before[register]);
      accesses.push(...memoryAccesses("write", address, data));
      data.forEach((value, offset) => memory.set(physical(address + offset), value));
    }
  }
  if (selected.length && (predecrement || postincrement)) {
    const register = addressNames(before)[ea.code % 8]!;
    after[register] = unsignedLong(before[register] + (predecrement ? -1 : 1) * form.size * selected.length);
  }
  ram.accesses.length = 0;
  const cpu = new Cpu68000(ram, before);
  after.ir = bytes[0]! * 256 + bytes[1]!;
  assert.deepEqual(cpu.step(), { before: snapshot(before), after: snapshot(after), outcome: "executed",
    instruction: { address: before.pc, bytes }, accesses });
  assert.deepEqual(ram.accesses, accesses);
  assert.deepEqual(cpu.snapshot(), snapshot(after));
  for (const [address, value] of memory) assert.equal(ram.read(address), value);
}

test("68000 MOVEM covers all 140 forms, mask extremes, both stacks, and bases included in the list", () => {
  const ram = new ObservedRam(0x1000000);
  for (const bits of [0, 127]) {
    const before = transferState(bits);
    let forms = 0;
    for (const form of multipleForms) {
      for (const ea of transferFixtures(before, form.size, before.pc + 4).filter(ea => form.addresses.includes(ea.code))) {
        forms++;
        for (const mask of [0, 1, 0x8000, 0xffff, 0x5aa5, 0x8181]) checkMultiple(ram, before, form, ea, mask);
      }
    }
    assert.equal(forms, 140);
  }
});

test("68000 MOVEM sweeps every mask in both sizes and directions, including reversed and discarded base values", () => {
  const ram = new ObservedRam(0x1000000);
  for (let mask = 0; mask < 65536; mask++) {
    const before = transferState(mask % 128);
    for (const form of multipleForms) {
      // Saving/restoring through A7 includes it in both ends of the normal/reversed mask.
      const code = form.load ? 31 : 39;
      const ea = transferFixtures(before, form.size, before.pc + 4).find(ea => ea.code === code)!;
      checkMultiple(ram, before, form, ea, mask);
    }
  }
});

test("68000 MOVEM.W sign-extends every word into full data and address registers without setting flags", () => {
  const ram = new ObservedRam(0x1000000);
  for (let value = 0; value < 65536; value++) {
    const before = transferState(value % 128);
    const data = [...wordBytes(value), ...wordBytes(value)];
    data.forEach((byte, offset) => ram.write(0x20000 + offset, byte));
    const extended = value < 32768 ? value : value + 0xffff0000;
    checkStep(ram, before, [0x4c, 0x90, 1, 1], { ...before, d0: extended, a0: extended, pc: before.pc + 4 },
      memoryAccesses("read", before.a0, data)); // MOVEM.W (A0),D0/A0; latch EA before loading A0.
  }
});

test("68000 MOVEM resolves extensions once before register changes, wraps transfers, and fetches before overlapping stores", () => {
  const ram = new ObservedRam(0x1000000);
  for (const bits of [0, 127]) for (const address of [0, 2, 0x12fffffe, 0xfffffffe]) {
    const before = { ...transferState(bits), a0: address, a1: address };
    for (const form of multipleForms) for (const code of [16, form.load ? 25 : 33]) {
      const ea = transferFixtures(before, form.size, before.pc + 4).find(ea => ea.code === code)!;
      checkMultiple(ram, before, form, ea, 0xffff);
    }
  }
  for (const form of multipleForms) {
    const before = { ...transferState(), a0: 0xab001000, d7: 0 };
    for (const ea of [
      { code: 16, extension: [], address: before.pc },
      { code: 48, extension: [0x70, 0], address: before.pc },
      ...(form.load ? [{ code: 58, extension: [0xff, 0xfc], address: before.pc }] : []),
    ]) checkMultiple(ram, before, form, ea, 0xffff);
    // The PC base follows the register mask, even when both fetches cross the address boundary.
    const wrapped = { ...transferState(), pc: 0xfffffffe };
    if (form.load) checkMultiple(ram, wrapped, form, { code: 58, extension: [0, 0x80], address: 0x82 }, 0xffff);
  }
});

test("68000 MOVEM rejects odd transfers before writes or register changes, but an empty list accesses no data", () => {
  const ram = new ObservedRam(0x1000000);
  for (const bits of [0, 127]) for (const form of multipleForms) {
    const before = { ...transferState(bits), a0: 1 };
    for (const code of [16, form.load ? 24 : 32]) {
      const ea = transferFixtures(before, form.size, before.pc + 4).find(ea => ea.code === code)!;
      checkMultiple(ram, before, form, ea, 0);
      for (const mask of [1, 0x8000, 0xffff]) {
        checkControlAddressError(ram, before, [...wordBytes(form.base + code), ...wordBytes(mask)],
          form.load ? "read" : "write", ea.address!);
      }
    }
  }
  // Correct the address extension, then restore the original boundary to retry.
  const before = transferState();
  [0x48, 0xf9, 0xff, 0xff, 0xab, 0, 0x30, 1].forEach((value, offset) => ram.write(0x1000 + offset, value));
  const cpu = new Cpu68000(ram, before);
  assert.equal(cpu.step().exception?.source, "address-error");
  ram.write(0x1007, 0);
  const saved = new Cpu68000(ram, before).step();
  assert.equal(saved.outcome, "executed");
  const expected = structuredClone(saved);
  cpu.reset();
  assert.deepEqual(saved, expected);
});

const unaryFamilies = [
  { name: "NEGX", opcodes: [0x4000, 0x4040, 0x4080] },
  { name: "CLR", opcodes: [0x4200, 0x4240, 0x4280] },
  { name: "NEG", opcodes: [0x4400, 0x4440, 0x4480] },
  { name: "NOT", opcodes: [0x4600, 0x4640, 0x4680] },
  { name: "TST", opcodes: [0x4a00, 0x4a40, 0x4a80] },
] as const;
const quickFamilies = [
  { name: "ADDQ", opcodes: [0x5000, 0x5040, 0x5080] },
  { name: "SUBQ", opcodes: [0x5100, 0x5140, 0x5180] },
] as const;
const quickAmounts = [
  { field: 0x000, amount: 8 }, { field: 0x200, amount: 1 }, { field: 0x400, amount: 2 }, { field: 0x600, amount: 3 },
  { field: 0x800, amount: 4 }, { field: 0xa00, amount: 5 }, { field: 0xc00, amount: 6 }, { field: 0xe00, amount: 7 },
];
// Manual operation words and independent NZVC truth tables; do not import the CPU condition selector.
const setConditions = [
  { opcode: 0x50c0, truth: 0xffff }, { opcode: 0x51c0, truth: 0x0000 },
  { opcode: 0x52c0, truth: 0x0505 }, { opcode: 0x53c0, truth: 0xfafa },
  { opcode: 0x54c0, truth: 0x5555 }, { opcode: 0x55c0, truth: 0xaaaa },
  { opcode: 0x56c0, truth: 0x0f0f }, { opcode: 0x57c0, truth: 0xf0f0 },
  { opcode: 0x58c0, truth: 0x3333 }, { opcode: 0x59c0, truth: 0xcccc },
  { opcode: 0x5ac0, truth: 0x00ff }, { opcode: 0x5bc0, truth: 0xff00 },
  { opcode: 0x5cc0, truth: 0xcc33 }, { opcode: 0x5dc0, truth: 0x33cc },
  { opcode: 0x5ec0, truth: 0x0c03 }, { opcode: 0x5fc0, truth: 0xf3fc },
] as const;
type SingleOperation = typeof unaryFamilies[number]["name"] | typeof quickFamilies[number]["name"] | "Scc";

function singleResult(name: SingleOperation, size: number, value: number, argument: number, before: Cpu68000Flags) {
  if (name === "ADDQ" || name === "SUBQ") return immediateResult(name === "ADDQ" ? "ADDI" : "SUBI", size, value, argument, before);
  if (name === "Scc") return { result: argument, flags: { ...before } };
  const width = size * 8;
  const modulus = 2 ** width;
  if (name === "NEG" || name === "NEGX") {
    const extend = name === "NEGX" && before.x ? 1n : 0n;
    const total = -BigInt(value) - extend;
    const signedTotal = -BigInt.asIntN(width, BigInt(value)) - extend;
    const result = Number(BigInt.asUintN(width, total));
    return { result, flags: { ...before, x: total < 0n, c: total < 0n, n: result >= modulus / 2,
      z: result === 0 && (name !== "NEGX" || before.z), v: signedTotal < -modulus / 2 || signedTotal >= modulus / 2 } };
  }
  const result = name === "CLR" ? 0 : name === "NOT" ? modulus - 1 - value : value;
  return { result, flags: { ...before, n: result >= modulus / 2, z: result === 0, v: false, c: false } };
}

function checkSingleOperand(ram: ObservedRam, before: Cpu68000State, name: SingleOperation, opcode: number, size: number,
  ea: TransferFixture, argument = 0, memoryValue = 0x89abcdef): void {
  const bytes = [...wordBytes(opcode), ...ea.extension];
  const memory = new Map<number, number>();
  if (ea.address !== undefined) {
    memory.set(physical(ea.address - 1), 0xde);
    memory.set(physical(ea.address + size), 0xad);
    bytesFor(size, memoryValue).forEach((value, offset) => memory.set(physical(ea.address! + offset), value));
  }
  bytes.forEach((value, offset) => memory.set(physical(before.pc + offset), value));
  for (const [address, value] of memory) ram.write(address, value);
  const accesses = memoryAccesses("read", before.pc, bytes);
  const addressRegister = ea.code >= 8 && ea.code < 16;
  const modulus = addressRegister ? 4294967296 : 2 ** (size * 8);
  let value = ea.register === undefined ? 0 : before[ea.register] % modulus;
  if (ea.address !== undefined) {
    const data = Array.from({ length: size }, (_unused, offset) => memory.get(physical(ea.address! + offset))!);
    value = data.reduce((total, byte) => total * 256 + byte, 0);
    accesses.push(...memoryAccesses("read", ea.address, data)); // Includes CLR and Scc, even for unchanged writes.
  }
  const expected = addressRegister
    ? { result: unsignedLong(value + (name === "ADDQ" ? argument : -argument)), flags: { ...before.flags } }
    : singleResult(name, size, value, argument, before.flags);
  const after = { ...before, flags: expected.flags, pc: unsignedLong(before.pc + bytes.length) };
  if (ea.update) after[ea.update[0]] = ea.update[1];
  if (name !== "TST") {
    if (ea.register !== undefined) after[ea.register] = Math.floor(before[ea.register] / modulus) * modulus + expected.result;
    else bytesFor(size, expected.result).forEach((byte, offset) => {
      const address = physical(ea.address! + offset);
      accesses.push({ kind: "write", address, value: byte });
      memory.set(address, byte);
    });
  }
  const cpu = new Cpu68000(ram, before);
  ram.accesses.length = 0;
  after.ir = bytes[0]! * 256 + bytes[1]!;
  assert.deepEqual(cpu.step(), { before: snapshot(before), after: snapshot(after), instruction: { address: before.pc, bytes },
    accesses, outcome: "executed" }, `${name} ${opcode.toString(16)}`);
  assert.deepEqual(cpu.snapshot(), snapshot(after));
  assert.deepEqual(ram.accesses, accesses);
  for (const [address, byte] of memory) assert.equal(ram.read(address), byte);
}

for (const { name, opcodes } of unaryFamilies) {
  test(`68000 ${name} covers all 150 original-chip forms and every byte with every incoming flag pattern`, () => {
    const ram = new ObservedRam(0x1000000);
    for (const bits of [0, 127]) {
      const before = transferState(bits);
      let forms = 0;
      for (const [index, base] of opcodes.entries()) {
        const size = 2 ** index;
        for (const ea of transferFixtures(before, size, before.pc + 2).filter(ea => ea.code < 8 || ea.code >= 16 && ea.code <= 57)) {
          checkSingleOperand(ram, before, name, base + ea.code, size, ea);
          forms++;
        }
      }
      assert.equal(forms, 150);
    }
    for (let value = 0; value < 256; value++) for (let bits = 0; bits < 128; bits++) {
      const before = initialState({ d0: 0xabcdef00 + value, flags: flags(bits) });
      const expected = singleResult(name, 1, value, 0, before.flags);
      checkStep(ram, before, wordBytes(opcodes[0]), { ...before, pc: before.pc + 2, flags: expected.flags,
        d0: name === "TST" ? before.d0 : 0xabcdef00 + expected.result });
    }
  });
}

for (const { name, opcodes } of quickFamilies) {
  test(`68000 ${name} covers all 166 forms with every quick operand and full-width address registers`, () => {
    const ram = new ObservedRam(0x1000000);
    for (const bits of [0, 127]) for (const { field, amount } of quickAmounts) {
      const before = transferState(bits);
      let forms = 0;
      for (const [index, base] of opcodes.entries()) {
        const size = 2 ** index;
        for (const ea of transferFixtures(before, size, before.pc + 2)) {
          if (ea.code > 57 || size === 1 && ea.code >= 8 && ea.code < 16) continue;
          checkSingleOperand(ram, before, name, base + field + ea.code, size, ea, amount);
          forms++;
        }
      }
      assert.equal(forms, 166);
    }
    for (let value = 0; value < 256; value++) for (const { field, amount } of quickAmounts) for (const bits of [0, 127]) {
      const before = initialState({ d7: 0xabcdef00 + value, flags: flags(bits) });
      const expected = singleResult(name, 1, value, amount, before.flags);
      checkStep(ram, before, wordBytes(opcodes[0] + field + 7), { ...before, pc: before.pc + 2,
        d7: 0xabcdef00 + expected.result, flags: expected.flags });
    }
  });
}

test("68000 Scc covers all 800 forms and incoming flags, including ST/SF and preserved upper Dn bytes", () => {
  const ram = new ObservedRam(0x1000000);
  for (let bits = 0; bits < 128; bits++) {
    const before = transferState(bits);
    let forms = 0;
    for (const { opcode, truth } of setConditions) {
      const value = conditionResult(truth, before.flags) ? 255 : 0;
      for (const ea of transferFixtures(before, 1, before.pc + 2).filter(ea => ea.code < 8 || ea.code >= 16 && ea.code <= 57)) {
        checkSingleOperand(ram, before, "Scc", opcode + ea.code, 1, ea, value, value);
        forms++;
      }
    }
    assert.equal(forms, 800);
  }
});

test("68000 unary and quick word/long results cover every bit boundary and incoming flag pattern", () => {
  const ram = new ObservedRam(0x1000000);
  for (const size of [2, 4]) {
    const modulus = 2 ** (size * 8);
    const values = new Set([0, modulus - 1]);
    for (let bit = 0; bit < size * 8; bit++) for (const delta of [-1, 0, 1]) values.add((2 ** bit + delta) % modulus);
    for (const value of values) for (let bits = 0; bits < 128; bits++) {
      const before = initialState({ d0: size === 2 ? 0x89ab0000 + value : value, flags: flags(bits) });
      for (const { name, opcodes } of unaryFamilies) {
        const expected = singleResult(name, size, value, 0, before.flags);
        checkStep(ram, before, wordBytes(opcodes[size === 2 ? 1 : 2]), { ...before, pc: before.pc + 2,
          d0: name === "TST" ? before.d0 : size === 2 ? 0x89ab0000 + expected.result : expected.result, flags: expected.flags });
      }
      for (const { name, opcodes } of quickFamilies) for (const { field, amount } of quickAmounts) {
        const expected = singleResult(name, size, value, amount, before.flags);
        checkStep(ram, before, wordBytes(opcodes[size === 2 ? 1 : 2] + field), { ...before, pc: before.pc + 2,
          d0: size === 2 ? 0x89ab0000 + expected.result : expected.result, flags: expected.flags });
      }
    }
  }
});

test("68000 NEGX sweeps every word with both extend/zero inputs, preserving cumulative zero on wrapped results", () => {
  const ram = new ObservedRam(0x1000000);
  for (let value = 0; value < 65536; value++) for (const bits of [0, 1, 4, 5]) {
    const before = initialState({ d3: 0xabcd0000 + value, flags: flags(bits) });
    const expected = singleResult("NEGX", 2, value, 0, before.flags);
    checkStep(ram, before, [0x40, 0x43], { ...before, pc: before.pc + 2, d3: 0xabcd0000 + expected.result, flags: expected.flags });
  }
});

test("68000 quick An operations ignore the encoded word size and preserve all flags through 32-bit wrap", () => {
  const ram = new ObservedRam(0x1000000);
  for (let bits = 0; bits < 128; bits++) for (const value of [0, 1, 7, 0xffff, 0x7fffffff, 0x80000000, 0xfffffffe, 0xffffffff]) {
    for (const { name, opcodes } of quickFamilies) for (const { field, amount } of quickAmounts) {
      const before = transferState(bits);
      for (const [n, register] of addressNames(before).entries()) {
        before[register] = value;
        for (const base of opcodes.slice(1)) checkStep(ram, before, wordBytes(base + field + 8 + n),
          { ...before, [register]: unsignedLong(value + (name === "ADDQ" ? amount : -amount)), pc: before.pc + 2 });
      }
    }
  }
});

test("68000 unary/quick/Scc memory access wraps, updates active A7 once, and fetches before overlapping writes", () => {
  const ram = new ObservedRam(0x1000000);
  for (const family of [...unaryFamilies, ...quickFamilies]) for (const [index, base] of family.opcodes.entries()) {
    const size = 2 ** index;
    const argument = family.name === "ADDQ" || family.name === "SUBQ" ? 8 : 0;
    for (const bits of [0, 127]) for (const address of [0, 1, 0x12fffffe, 0xfffffffe, 0xffffffff]) {
      if (size !== 1 && address % 2 !== 0) continue;
      const before = { ...transferState(bits), usp: address, ssp: address };
      for (const ea of transferFixtures(before, size, before.pc + 2).filter(ea => [31, 39].includes(ea.code))) {
        checkSingleOperand(ram, before, family.name, base + ea.code, size, ea, argument, 0);
      }
    }
    for (const pc of [0xab001000, 0x12fffffe, 0xfffffffe]) {
      const before = initialState({ pc });
      for (const offset of [0, 2, 4]) {
        const address = unsignedLong(pc + offset);
        checkSingleOperand(ram, before, family.name, base + 57, size, { code: 57, address, extension: longBytes(address) }, argument);
      }
    }
  }
  for (const { opcode, truth } of setConditions) for (const bits of [0, 127]) for (const address of [1, 0xffffffff]) {
    const before = { ...transferState(bits), usp: address, ssp: address };
    const value = conditionResult(truth, before.flags) ? 255 : 0;
    for (const ea of transferFixtures(before, 1, before.pc + 2).filter(ea => [31, 39].includes(ea.code))) {
      checkSingleOperand(ram, before, "Scc", opcode + ea.code, 1, ea, value, value);
    }
    checkSingleOperand(ram, before, "Scc", opcode + 57, 1, { code: 57, extension: longBytes(before.pc), address: before.pc }, value);
  }
});

test("68000 unary/quick word and long address errors discard pending operand updates in every memory mode", () => {
  const ram = new ObservedRam(0x1000000);
  for (const { opcodes } of [...unaryFamilies, ...quickFamilies]) for (const [index, base] of opcodes.entries()) {
    if (index === 0) continue;
    const size = 2 ** index;
    for (const bits of [0, 127]) {
      const before = transferState(bits);
      for (const register of addressNames(before)) before[register]++;
      const destinations = transferFixtures(before, size, before.pc + 2);
      destinations.push({ code: 56, extension: [0xff, 0xff], address: 0xffffffff },
        { code: 57, extension: [0xab, 0xff, 0xff, 0xff], address: 0xabffffff });
      for (const ea of destinations) {
        if (ea.code > 57 || ea.address === undefined || ea.address % 2 === 0) continue;
        checkControlAddressError(ram, before, [...wordBytes(base + ea.code), ...ea.extension], "read", ea.address);
      }
    }
  }
});

test("68000 unary alignment faults retry from live RAM without changing retained records", () => {
  const ram = new ObservedRam(0x1000000);
  const before = transferState(127);
  [0x42, 0xb9, 0xab, 0, 0x30, 1].forEach((value, offset) => ram.write(0x1000 + offset, value));
  const cpu = new Cpu68000(ram, before);
  const fault = cpu.step();
  const savedFault = structuredClone(fault);
  assert.equal(fault.exception?.source, "address-error");
  assert.equal(cpu.snapshot().ssp, before.ssp - 14);
  ram.write(0x1005, 0);
  [0x12, 0x34, 0x56, 0x78].forEach((value, offset) => ram.write(0x3000 + offset, value));
  const record = new Cpu68000(ram, before).step();
  const saved = structuredClone(record);
  assert.equal(record.outcome, "executed");
  assert.deepEqual(record.accesses.slice(-8), [...memoryAccesses("read", 0x3000, [0x12, 0x34, 0x56, 0x78]), ...memoryAccesses("write", 0x3000, [0, 0, 0, 0])]);
  assert.equal(record.after.flags.z, true);
  assert.equal(record.after.flags.x, true);
  cpu.reset();
  assert.deepEqual(record, saved);
  assert.deepEqual(fault, savedFault);
});

// Manual operation words for D0, with immediate count 8 or register count D0.
// Columns are byte/word/long; the memory encoding always shifts a word once.
const shiftFamilies = [
  { name: "ASR", immediate: [0xe000, 0xe040, 0xe080], register: [0xe020, 0xe060, 0xe0a0], memory: 0xe0c0 },
  { name: "ASL", immediate: [0xe100, 0xe140, 0xe180], register: [0xe120, 0xe160, 0xe1a0], memory: 0xe1c0 },
  { name: "LSR", immediate: [0xe008, 0xe048, 0xe088], register: [0xe028, 0xe068, 0xe0a8], memory: 0xe2c0 },
  { name: "LSL", immediate: [0xe108, 0xe148, 0xe188], register: [0xe128, 0xe168, 0xe1a8], memory: 0xe3c0 },
  { name: "ROXR", immediate: [0xe010, 0xe050, 0xe090], register: [0xe030, 0xe070, 0xe0b0], memory: 0xe4c0 },
  { name: "ROXL", immediate: [0xe110, 0xe150, 0xe190], register: [0xe130, 0xe170, 0xe1b0], memory: 0xe5c0 },
  { name: "ROR", immediate: [0xe018, 0xe058, 0xe098], register: [0xe038, 0xe078, 0xe0b8], memory: 0xe6c0 },
  { name: "ROL", immediate: [0xe118, 0xe158, 0xe198], register: [0xe138, 0xe178, 0xe1b8], memory: 0xe7c0 },
] as const;
type ShiftName = typeof shiftFamilies[number]["name"];

// Whole-value BigInt shifts and bit-string rotations are independent of the core's one-bit loop.
function shifted(name: ShiftName, width: number, value: number, count: number, before: Cpu68000Flags) {
  let result = value;
  let x = before.x;
  let c = false;
  let v = false;
  if (name.startsWith("RO")) {
    const throughX = name === "ROXL" || name === "ROXR";
    const ring = value.toString(2).padStart(width, "0") + (throughX ? (x ? "1" : "0") : "");
    const offset = (name.endsWith("L") ? count : ring.length - count % ring.length) % ring.length;
    const rotated = ring.slice(offset) + ring.slice(0, offset);
    result = parseInt(rotated.slice(0, width), 2);
    if (throughX) c = x = rotated[width] === "1";
    else if (count) c = name === "ROL" ? rotated[width - 1] === "1" : rotated[0] === "1";
  } else if (count) {
    const original = BigInt(value);
    const distance = BigInt(count);
    const signed = BigInt.asIntN(width, original);
    let total: bigint;
    if (name.endsWith("L")) {
      total = original * 2n ** distance;
      c = (total / 2n ** BigInt(width)) % 2n === 1n;
      const signedTotal = signed * 2n ** distance;
      v = name === "ASL" && (signedTotal < -(2n ** BigInt(width - 1)) || signedTotal >= 2n ** BigInt(width - 1));
    } else {
      const operand = name === "ASR" ? signed : original;
      total = operand >> distance;
      c = ((operand >> (distance - 1n)) & 1n) !== 0n;
    }
    result = Number(BigInt.asUintN(width, total));
    x = c;
  }
  return { result, flags: { ...before, x, n: result >= 2 ** (width - 1), z: result === 0, v, c } };
}

function checkRegisterShift(ram: ObservedRam, before: Cpu68000State, name: ShiftName, opcode: number,
  width: number, register: DataRegister, count: number): void {
  const modulus = 2 ** width;
  const expected = shifted(name, width, before[register] % modulus, count, before.flags);
  checkStep(ram, before, wordBytes(opcode), { ...before, flags: expected.flags,
    [register]: Math.floor(before[register] / modulus) * modulus + expected.result, pc: unsignedLong(before.pc + 2) });
}

function checkMemoryShift(ram: ObservedRam, before: Cpu68000State, name: ShiftName, opcode: number,
  ea: TransferFixture, value: number): void {
  const address = ea.address!;
  const bytes = [...wordBytes(opcode), ...ea.extension];
  const memory = new Map<number, number>([[physical(address - 1), 0xde], [physical(address + 2), 0xad]]);
  wordBytes(value).forEach((byte, offset) => memory.set(physical(address + offset), byte));
  bytes.forEach((byte, offset) => memory.set(physical(before.pc + offset), byte));
  for (const [location, byte] of memory) ram.write(location, byte);
  const data = [memory.get(physical(address))!, memory.get(physical(address + 1))!];
  const expected = shifted(name, 16, data[0]! * 256 + data[1]!, 1, before.flags);
  const after = { ...before, pc: unsignedLong(before.pc + bytes.length), flags: expected.flags };
  if (ea.update) after[ea.update[0]] = ea.update[1];
  const accesses = [...memoryAccesses("read", before.pc, bytes), ...memoryAccesses("read", address, data),
    ...memoryAccesses("write", address, wordBytes(expected.result))];
  const cpu = new Cpu68000(ram, before);
  ram.accesses.length = 0;
  after.ir = bytes[0]! * 256 + bytes[1]!;
  assert.deepEqual(cpu.step(), { before: snapshot(before), after: snapshot(after), accesses,
    instruction: { address: before.pc, bytes }, outcome: "executed" });
  assert.deepEqual(cpu.snapshot(), snapshot(after));
  assert.deepEqual(ram.accesses, accesses);
  wordBytes(expected.result).forEach((byte, offset) => memory.set(physical(address + offset), byte));
  for (const [location, byte] of memory) assert.equal(ram.read(location), byte);
}

for (const { name, immediate, register, memory } of shiftFamilies) {
  test(`68000 ${name} covers all 258 forms, all immediate counts, and count/destination register aliases`, () => {
    const ram = new ObservedRam(0x1000000);
    for (const bits of [0, 127]) {
      let forms = 0;
      for (const [index, base] of immediate.entries()) {
        const width = 8 * 2 ** index;
        for (const [destination, { register: target }] of registerForms.entries()) {
          for (const { field, amount } of quickAmounts) {
            checkRegisterShift(ram, initialState({ flags: flags(bits) }), name, base + field + destination, width, target, amount);
          }
          forms++; // Immediate counts are operand values, so each destination/size counts once.
          for (const [source, { register: counter }] of registerForms.entries()) {
            for (const count of [0, 1, 8, 31, 32, 33, 63, 64, 65, 255, 0xffffffff]) {
              const before = initialState({ [counter]: count, flags: flags(bits) });
              checkRegisterShift(ram, before, name, register[index]! + source * 512 + destination, width, target, count % 64);
            }
            forms++;
          }
        }
      }
      const before = transferState(bits);
      for (const ea of transferFixtures(before, 2, before.pc + 2).filter(ea => ea.code >= 16 && ea.code <= 57)) {
        for (const value of [0, 1, 0x4000, 0x7fff, 0x8000, 0x8001, 0xffff]) checkMemoryShift(ram, before, name, memory + ea.code, ea, value);
        forms++;
      }
      assert.equal(forms, 258);
    }
  });

  test(`68000 ${name} checks every byte and count 0..63 with both incoming X values`, () => {
    const ram = new ObservedRam(0x1000000);
    for (let value = 0; value < 256; value++) for (let count = 0; count < 64; count++) for (const bits of [0, 127]) {
      const before = initialState({ d0: 0xabcdef00 + value, d1: 0xffff0000 + count, flags: flags(bits) });
      checkRegisterShift(ram, before, name, register[0] + 0x200, 8, "d0", count);
    }
  });
}

test("68000 shifts check word/long bit boundaries, all counts, and all flag patterns independently", () => {
  const ram = new ObservedRam(0x1000000);
  for (const width of [16, 32]) {
    const modulus = 2 ** width;
    const values = new Set([0, modulus - 1]);
    for (let bit = 0; bit < width; bit++) for (const value of [2 ** bit - 1, 2 ** bit, 2 ** bit + 1, modulus - 2 ** bit]) values.add(value);
    for (const { name, register } of shiftFamilies) {
      const opcode = register[width === 16 ? 1 : 2] + 0x200;
      for (const value of values) for (let count = 0; count < 64; count++) for (const bits of [0, 127]) {
        const before = initialState({ d0: width === 16 ? 0xabcd0000 + value : value, d1: 0xffff0000 + count, flags: flags(bits) });
        checkRegisterShift(ram, before, name, opcode, width, "d0", count);
      }
    }
  }
  for (const { name, register } of shiftFamilies) for (const [index, base] of register.entries()) {
    const width = 8 * 2 ** index;
    for (let bits = 0; bits < 128; bits++) for (const value of [0, 1, 2 ** (width - 1), 2 ** width - 1]) {
      for (const count of [0, 1, width - 1, width, width + 1, 63]) {
        checkRegisterShift(ram, initialState({ d0: value, d1: count, flags: flags(bits), interruptMask: bits % 8 }), name, base + 0x200, width, "d0", count);
      }
    }
  }
});

test("68000 shift flags distinguish zero counts, full rotations, and ASL sign changes that cancel", () => {
  const ram = new ObservedRam(0x1000000);
  // Literal outcomes anchor the independent oracle at cases that simple JavaScript shifts lose.
  for (const row of [
    { opcode: 0xe360, value: 0, count: 0, result: 0, x: true, n: false, z: true, v: false, c: false }, // ASL.W D1,D0
    { opcode: 0xe3b0, value: 0x80000000, count: 64, result: 0x80000000, x: true, n: true, z: false, v: false, c: true }, // ROXL.L D1,D0
    { opcode: 0xe328, value: 1, count: 32, result: 0, x: false, n: false, z: true, v: false, c: false }, // LSL.B D1,D0
    { opcode: 0xe338, value: 0x81, count: 8, result: 0x81, x: true, n: true, z: false, v: false, c: true }, // ROL.B D1,D0
    { opcode: 0xe230, value: 0x80, count: 9, result: 0x80, x: true, n: true, z: false, v: false, c: true }, // ROXR.B D1,D0
    { opcode: 0xe320, value: 0x40, count: 2, result: 0, x: true, n: false, z: true, v: true, c: true }, // ASL.B D1,D0
    { opcode: 0xe2a0, value: 0x80000000, count: 63, result: 0xffffffff, x: true, n: true, z: false, v: false, c: true }, // ASR.L D1,D0
  ]) {
    const before = initialState({ d0: row.value, d1: row.count });
    const { x, n, z, v, c } = row;
    checkStep(ram, before, wordBytes(row.opcode), { ...before, d0: row.result, pc: before.pc + 2,
      flags: { ...before.flags, x, n, z, v, c } });
  }
});

test("68000 memory shifts wrap, update either stack once, and fetch extensions before overlapping writes", () => {
  const ram = new ObservedRam(0x1000000);
  for (const { name, memory } of shiftFamilies) {
    for (const bits of [0, 127]) for (const address of [0, 0x12fffffe, 0xfffffffe]) {
      const before = { ...transferState(bits), usp: address, ssp: address };
      for (const ea of transferFixtures(before, 2, before.pc + 2).filter(ea => [31, 39].includes(ea.code))) {
        checkMemoryShift(ram, before, name, memory + ea.code, ea, 0);
      }
    }
    for (const pc of [0xab001000, 0x12fffffe, 0xfffffffe]) for (const offset of [0, 2, 4]) {
      const before = initialState({ pc });
      const address = unsignedLong(pc + offset);
      checkMemoryShift(ram, before, name, memory + 57, { code: 57, address, extension: longBytes(address) }, 0x8001);
    }
  }
});

test("68000 memory shifts reject odd addresses in every memory mode without reads, writes, or state changes", () => {
  const ram = new ObservedRam(0x1000000);
  for (const { memory } of shiftFamilies) for (const bits of [0, 127]) {
    const before = transferState(bits);
    for (const register of addressNames(before)) before[register]++;
    const addresses = transferFixtures(before, 2, before.pc + 2);
    addresses.push({ code: 56, extension: [0xff, 0xff], address: 0xffffffff },
      { code: 57, extension: [0xab, 0xff, 0xff, 0xff], address: 0xabffffff });
    for (const ea of addresses) {
      if (ea.code > 57 || ea.address === undefined || ea.address % 2 === 0) continue;
      checkControlAddressError(ram, before, [...wordBytes(memory + ea.code), ...ea.extension], "read", ea.address);
    }
  }
});

test("68000 register shifts use counts written by earlier instructions and wrap the full PC", () => {
  const ram = new ObservedRam(0x1000000);
  const before = initialState({ d0: 0x80000001, d1: 1, pc: 0xfffffffe });
  const cpu = new Cpu68000(ram, before);
  const count = { ...before, d1: 32, pc: 0, flags: { ...before.flags, x: false, n: false, z: false, v: false, c: false } };
  checkStep(ram, before, [0xeb, 0x89], count, [], cpu); // LSL.L #5,D1
  const shifted = { ...count, d0: 0, pc: 2, flags: { ...count.flags, x: true, z: true, c: true } };
  checkStep(ram, count, [0xe2, 0xa8], shifted, [], cpu); // LSR.L D1,D0
  const zeroCount = { ...shifted, d1: 0, pc: 4, flags: { ...shifted.flags, c: false } };
  checkStep(ram, shifted, [0x72, 0], zeroCount, [], cpu); // MOVEQ #0,D1
  checkStep(ram, zeroCount, [0xe3, 0xb0], { ...zeroCount, pc: 6, flags: { ...zeroCount.flags, c: true } }, [], cpu); // ROXL.L D1,D0
});

// Literal operation words from Motorola's static/dynamic format tables, independent of pattern expansion.
const bitFamilies = [
  { name: "BTST", immediate: 0x0800, dynamic: 0x0100, forms: 476 },
  { name: "BCHG", immediate: 0x0840, dynamic: 0x0140, forms: 450 },
  { name: "BCLR", immediate: 0x0880, dynamic: 0x0180, forms: 450 },
  { name: "BSET", immediate: 0x08c0, dynamic: 0x01c0, forms: 450 },
] as const;
type BitName = typeof bitFamilies[number]["name"];

// A bit-string oracle avoids the implementation's numeric masks and bitwise operations.
function bitResult(name: BitName, width: number, value: number, bitNumber: number, before: Cpu68000Flags) {
  const bits = [...value.toString(2).padStart(width, "0")];
  const index = width - 1 - bitNumber % width;
  const z = bits[index] === "0";
  if (name === "BCHG") bits[index] = z ? "1" : "0";
  if (name === "BCLR") bits[index] = "0";
  if (name === "BSET") bits[index] = "1";
  return { result: parseInt(bits.join(""), 2), flags: { ...before, z } };
}

function checkBit(ram: ObservedRam, before: Cpu68000State, name: BitName, opcode: number,
  source: number | DataRegister, ea: TransferFixture, value = 0xa5): void {
  const bitNumber = typeof source === "number" ? source : before[source];
  const bytes = [...wordBytes(opcode), ...(typeof source === "number" ? wordBytes(source) : []), ...ea.extension];
  const memory = new Map<number, number>();
  if (ea.address !== undefined) {
    memory.set(physical(ea.address - 1), 0xde);
    memory.set(physical(ea.address), value);
    memory.set(physical(ea.address + 1), 0xad);
  }
  bytes.forEach((byte, offset) => memory.set(physical(before.pc + offset), byte));
  for (const [address, byte] of memory) ram.write(address, byte);
  const accesses = memoryAccesses("read", before.pc, bytes);
  let operand = ea.immediate ?? (ea.register === undefined ? 0 : before[ea.register]);
  if (ea.address !== undefined) {
    operand = memory.get(physical(ea.address))!;
    accesses.push({ kind: "read", address: physical(ea.address), value: operand });
  }
  const expected = bitResult(name, ea.code < 8 ? 32 : 8, operand, bitNumber, before.flags);
  const after = { ...before, pc: unsignedLong(before.pc + bytes.length), flags: expected.flags };
  if (ea.update) after[ea.update[0]] = ea.update[1];
  if (name !== "BTST") {
    if (ea.register !== undefined) after[ea.register] = expected.result;
    else {
      const address = physical(ea.address!);
      accesses.push({ kind: "write", address, value: expected.result });
      memory.set(address, expected.result);
    }
  }
  const cpu = new Cpu68000(ram, before);
  ram.accesses.length = 0;
  after.ir = bytes[0]! * 256 + bytes[1]!;
  assert.deepEqual(cpu.step(), { before: snapshot(before), after: snapshot(after), accesses,
    instruction: { address: before.pc, bytes }, outcome: "executed" }, `${name} ${opcode.toString(16)}`);
  assert.deepEqual(cpu.snapshot(), snapshot(after));
  assert.deepEqual(ram.accesses, accesses);
  for (const [address, byte] of memory) assert.equal(ram.read(address), byte);
}

for (const { name, immediate, dynamic, forms } of bitFamilies) {
  test(`68000 ${name} covers all ${forms} documented forms and every bit-number register`, () => {
    const ram = new ObservedRam(0x1000000);
    for (const bits of [0, 127]) {
      let completed = 0;
      const before = transferState(bits);
      for (const ea of transferFixtures(before, 1, before.pc + 4)) {
        if (ea.code >= 8 && ea.code < 16 || ea.code > (name === "BTST" ? 59 : 57)) continue;
        for (const number of [0, 7, 8, 31, 32, 255]) checkBit(ram, before, name, immediate + ea.code, number, ea);
        completed++;
      }
      for (const [index, { register }] of registerForms.entries()) {
        for (const ea of transferFixtures(before, 1, before.pc + 2)) {
          if (ea.code >= 8 && ea.code < 16 || ea.code > (name === "BTST" ? 60 : 57)) continue;
          checkBit(ram, before, name, dynamic + index * 512 + ea.code, register, ea);
          completed++;
        }
      }
      assert.equal(completed, forms);
    }
  });

  test(`68000 ${name} checks every byte value and bit-number byte in static and dynamic memory forms`, () => {
    const ram = new ObservedRam(0x1000000);
    const ea = { code: 16, extension: [], address: 0xab003001 };
    for (let value = 0; value < 256; value++) for (let number = 0; number < 256; number++) {
      const before = initialState({ a0: ea.address, d1: 0xabcdef00 + number, flags: flags(value % 128) });
      checkBit(ram, before, name, immediate + 16, number, ea, value);
      checkBit(ram, before, name, dynamic + 0x210, "d1", ea, value);
    }
  });

  test(`68000 ${name} fetches every complete bit-number word while ignoring its upper byte`, () => {
    const ram = new ObservedRam(0x1000000);
    const before = initialState({ d0: 0x80000001 });
    for (let number = 0; number < 65536; number++) {
      checkBit(ram, before, name, immediate, number, { code: 0, extension: [], register: "d0" });
    }
  });
}

test("68000 bit operations check every long bit and incoming flag pattern, preserving XNVC and control state", () => {
  const ram = new ObservedRam(0x1000000);
  for (const { name, immediate, dynamic } of bitFamilies) for (let number = 0; number < 32; number++) {
    for (const value of [0, 2 ** number, 0xffffffff - 2 ** number, 0x80000000, 0xffffffff]) for (let bits = 0; bits < 128; bits++) {
      const before = initialState({ d0: value, d1: 0xffffffe0 + number, flags: flags(bits), interruptMask: bits % 8 });
      const ea = { code: 0, extension: [], register: "d0" } as const;
      checkBit(ram, before, name, immediate, number, ea);
      checkBit(ram, before, name, dynamic + 0x200, "d1", ea);
    }
  }
});

test("68000 bit-number registers can alias the changed register or index the memory operand", () => {
  const ram = new ObservedRam(0x1000000);
  for (const { name, dynamic } of bitFamilies) for (const [index, { register }] of registerForms.entries()) {
    for (const value of [0, 7, 8, 31, 32, 63, 255, 0x80000000, 0xffffffff]) {
      const before = initialState({ [register]: value, a0: 0xab003000 });
      checkBit(ram, before, name, dynamic + index * 512 + index, register, { code: index, extension: [], register });
      checkBit(ram, before, name, dynamic + index * 512 + 48, register,
        { code: 48, extension: [index * 16, 0xfd], address: unsignedLong(before.a0 + signedWord(value) - 3) });
    }
  }
});

test("68000 bit operations wrap byte accesses and both active stacks, and fetch before code-overlapping writes", () => {
  const ram = new ObservedRam(0x1000000);
  for (const { name, immediate, dynamic } of bitFamilies) for (const bits of [0, 127]) {
    for (const address of [0, 1, 0x12ffffff, 0xffffffff]) {
      const before = { ...transferState(bits), usp: address, ssp: address };
      for (const ea of transferFixtures(before, 1, before.pc + 4).filter(ea => [31, 39].includes(ea.code))) {
        for (const value of [0, 255]) {
          checkBit(ram, before, name, immediate + ea.code, 0, ea, value);
          checkBit(ram, before, name, dynamic + ea.code, "d0", ea, value);
        }
      }
    }
    for (const pc of [0xab001000, 0x12fffffe, 0xfffffffc, 0xfffffffe]) {
      const before = initialState({ pc, flags: flags(bits) });
      for (let offset = 0; offset < 8; offset++) {
        const address = unsignedLong(pc + offset);
        const ea = { code: 57, address, extension: longBytes(address) };
        checkBit(ram, before, name, immediate + 57, 7, ea);
        checkBit(ram, before, name, dynamic + 57, "d0", ea);
      }
    }
  }
});

test("68000 BTST bases PC-relative operands after the bit-number word and reads immediate bytes as instruction data", () => {
  const ram = new ObservedRam(0x1000000);
  for (const pc of [0xab001000, 0x12fffffe, 0xfffffffe]) for (const bits of [0, 127]) {
    const before = initialState({ pc, d0: 7, flags: flags(bits) });
    checkBit(ram, before, "BTST", 0x083a, 7, { code: 58, extension: [0xff, 0xff], address: unsignedLong(pc + 3) });
    checkBit(ram, before, "BTST", 0x013a, "d0", { code: 58, extension: [0xff, 0xff], address: unsignedLong(pc + 1) });
    checkBit(ram, before, "BTST", 0x083b, 7, { code: 59, extension: [0, 0xfc], address: unsignedLong(pc + 7) });
    checkBit(ram, before, "BTST", 0x013b, "d0", { code: 59, extension: [0, 0xfc], address: unsignedLong(pc + 5) });
    for (const value of [0, 0x7f, 0x80, 0xff]) {
      checkBit(ram, before, "BTST", 0x013c, "d0", { code: 60, extension: [0xa5, value], immediate: value });
    }
  }
});

test("68000 bit operations retain Z from the original bit and read changing bit-number registers at execution", () => {
  const ram = new ObservedRam(0x1000000);
  const before = initialState({ d0: 31, d1: 0, flags: flags(127) });
  const cpu = new Cpu68000(ram, before);
  const first = { ...before, d0: 0x8000001f, pc: before.pc + 2 }; // BSET D0,D0 sets bit 31; Z stays set.
  checkStep(ram, before, [0x01, 0xc0], first, [], cpu);
  const second = { ...first, pc: first.pc + 4, flags: { ...first.flags, z: false } }; // BTST #31,D0 clears Z.
  checkStep(ram, first, [0x08, 0, 0, 31], second, [], cpu);
  // A fresh immediate load changes the bit-number source while preserving the high bit of D0's data.
  const loaded = { ...second, d1: 0x20, pc: second.pc + 2, flags: { ...second.flags, n: false, z: false, v: false, c: false } };
  checkStep(ram, second, [0x72, 0x20], loaded, [], cpu); // MOVEQ #32,D1
  const cleared = { ...loaded, d0: 0x8000001e, pc: loaded.pc + 2 };
  checkStep(ram, loaded, [0x03, 0x80], cleared, [], cpu); // BCLR D1,D0 wraps to bit 0, with Z clear from the old one.
});

// Literal byte/word/long operation words; each row expands to 3 × 8 × 8 forms.
const pairedFamilies = [
  { name: "ADDX", mode: "register", opcodes: [0xd100, 0xd140, 0xd180] },
  { name: "ADDX", mode: "predecrement", opcodes: [0xd108, 0xd148, 0xd188] },
  { name: "SUBX", mode: "register", opcodes: [0x9100, 0x9140, 0x9180] },
  { name: "SUBX", mode: "predecrement", opcodes: [0x9108, 0x9148, 0x9188] },
  { name: "CMPM", mode: "postincrement", opcodes: [0xb108, 0xb148, 0xb188] },
] as const;
type PairedFamily = typeof pairedFamilies[number];

function pairedResult(name: PairedFamily["name"], size: number, left: number, right: number, before: Cpu68000Flags) {
  const width = size * 8;
  const limit = 2n ** BigInt(width);
  const direction = name === "ADDX" ? 1n : -1n;
  const extend = name !== "CMPM" && before.x ? 1n : 0n;
  const total = BigInt(left) + direction * (BigInt(right) + extend);
  const signed = BigInt.asIntN(width, BigInt(left)) + direction * (BigInt.asIntN(width, BigInt(right)) + extend);
  const result = Number(BigInt.asUintN(width, total));
  const carry = total < 0n || total >= limit;
  return { result, flags: { ...before, x: name === "CMPM" ? before.x : carry,
    n: result >= Number(limit / 2n), z: result === 0 && (name === "CMPM" || before.z),
    v: signed < -limit / 2n || signed >= limit / 2n, c: carry } };
}

function checkPaired(ram: ObservedRam, before: Cpu68000State, family: PairedFamily, sizeIndex: number,
  source: number, destination: number, sourceValue = 0x81234567, destinationValue = 0x7fffffff, runningCpu?: Cpu68000): void {
  const { name, mode, opcodes } = family;
  const size = 2 ** sizeIndex;
  const modulus = 2 ** (size * 8);
  const bytes = wordBytes(opcodes[sizeIndex]! + destination * 512 + source);
  const after = { ...before, pc: unsignedLong(before.pc + 2), flags: { ...before.flags } };
  const memory = new Map<number, number>();
  const dataRegisters = registerForms.map(form => form.register);
  let sourceAddress: number | undefined;
  let destinationAddress: number | undefined;
  if (mode !== "register") {
    const registers = addressNames(before);
    const from = registers[source]!;
    const to = registers[destination]!;
    const fromStep = source === 7 && size === 1 ? 2 : size;
    const toStep = destination === 7 && size === 1 ? 2 : size;
    const direction = mode === "predecrement" ? -1 : 1;
    after[from] = unsignedLong(before[from] + direction * fromStep);
    sourceAddress = mode === "predecrement" ? after[from] : before[from];
    destinationAddress = mode === "predecrement" ? unsignedLong(after[to] - toStep) : after[to];
    after[to] = unsignedLong(after[to] + direction * toStep);
    for (const address of [sourceAddress, destinationAddress]) {
      memory.set(physical(address - 1), 0xde);
      memory.set(physical(address + size), 0xad);
    }
    for (const [address, value] of [[sourceAddress, sourceValue], [destinationAddress, destinationValue]]) {
      longBytes(value! % modulus).slice(4 - size).forEach((byte, offset) => memory.set(physical(address! + offset), byte));
    }
  }
  bytes.forEach((byte, offset) => memory.set(physical(before.pc + offset), byte));
  for (const [address, byte] of memory) ram.write(address, byte);
  const accesses = memoryAccesses("read", before.pc, bytes);
  const readValue = (address: number) => {
    let value = 0;
    for (let offset = 0; offset < size; offset++) {
      const physicalAddress = physical(address + offset);
      const byte = memory.get(physicalAddress)!;
      accesses.push({ kind: "read", address: physicalAddress, value: byte });
      value = value * 256 + byte;
    }
    return value;
  };
  const invalidSource = size !== 1 && sourceAddress !== undefined && sourceAddress % 2 !== 0;
  const invalidDestination = size !== 1 && destinationAddress !== undefined && destinationAddress % 2 !== 0;
  const right = invalidSource ? 0 : sourceAddress === undefined ? before[dataRegisters[source]!] % modulus : readValue(sourceAddress);
  if (!invalidSource && !invalidDestination) {
    const left = destinationAddress === undefined ? before[dataRegisters[destination]!] % modulus : readValue(destinationAddress);
    const expected = pairedResult(name, size, left, right, before.flags);
    after.flags = expected.flags;
    if (name !== "CMPM") {
      if (destinationAddress === undefined) {
        const register = dataRegisters[destination]!;
        after[register] = Math.floor(before[register] / modulus) * modulus + expected.result;
      } else {
        for (const access of memoryAccesses("write", destinationAddress, longBytes(expected.result).slice(4 - size))) {
          accesses.push(access);
          memory.set(access.address, access.value);
        }
      }
    }
  }
  const cpu = runningCpu ?? new Cpu68000(ram, before);
  ram.accesses.length = 0;
  after.ir = bytes[0]! * 256 + bytes[1]!;
  const expected = invalidSource || invalidDestination
    ? addressErrorRecord({ before: snapshot(before), accesses, instruction: { address: before.pc, bytes },
      fault: { operation: "read", address: (invalidSource ? sourceAddress : destinationAddress)! } })
    : { before: snapshot(before), after: snapshot(after), accesses, instruction: { address: before.pc, bytes }, outcome: "executed" };
  assert.deepEqual(cpu.step(), expected, `${name} ${mode} ${size} ${source},${destination}`);
  assert.deepEqual(cpu.snapshot(), expected.after);
  assert.deepEqual(ram.accesses, expected.accesses);
  for (const access of expected.accesses) if (access.kind === "write") memory.set(access.address, access.value);
  for (const [address, byte] of memory) assert.equal(ram.read(address), byte);
}

for (const family of pairedFamilies) {
  test(`68000 ${family.name} ${family.mode} covers all 192 forms and every flag pattern`, () => {
    const ram = new ObservedRam(0x1000000);
    for (let bits = 0; bits < 128; bits++) {
      let completed = 0;
      for (let size = 0; size < 3; size++) for (let source = 0; source < 8; source++) for (let destination = 0; destination < 8; destination++) {
        checkPaired(ram, transferState(bits), family, size, source, destination);
        completed++;
      }
      assert.equal(completed, 192);
    }
  });

  test(`68000 ${family.name} ${family.mode} exhausts byte operands with every incoming X/Z combination`, () => {
    const ram = new ObservedRam(0x1000000);
    for (let left = 0; left < 256; left++) for (let right = 0; right < 256; right++) for (let xz = 0; xz < 4; xz++) {
      const before = initialState({ d0: 0x89abcd00 + right, d1: 0xfedcba00 + left, a0: 0xab003003, a1: 0xcd004005,
        flags: { ...flags((left + right) % 128), x: xz % 2 === 1, z: xz >= 2 } });
      checkPaired(ram, before, family, 0, 0, 1, right, left);
    }
  });

  test(`68000 ${family.name} ${family.mode} checks word and long carry, borrow, overflow, and partial registers`, () => {
    const ram = new ObservedRam(0x1000000);
    for (const index of [1, 2]) {
      const modulus = 2 ** (8 * 2 ** index);
      const values = [0, 1, 2, modulus / 2 - 1, modulus / 2, modulus / 2 + 1, modulus - 2, modulus - 1];
      for (const left of values) for (const right of values) for (let bits = 0; bits < 128; bits++) {
        const upper = index === 1 ? 0xabcd0000 : 0;
        const before = { ...transferState(bits), d0: upper + right, d1: upper + left };
        checkPaired(ram, before, family, index, 0, 1, right, left);
      }
    }
  });
}

test("68000 paired memory ALU discards pending operand changes on address errors and restored boundaries can execute as bytes", () => {
  const ram = new ObservedRam(0x1000000);
  for (const family of pairedFamilies.filter(family => family.mode !== "register")) for (const bits of [0, 127]) {
    for (let source = 0; source < 8; source++) for (let destination = 0; destination < 8; destination++) {
      for (const index of [1, 2]) for (const odd of ["source", "destination", "both"]) {
        const before = transferState(bits);
        const registers = addressNames(before);
        if (odd !== "destination") before[registers[source]!]++;
        if (odd !== "source" && (source !== destination || odd === "destination")) before[registers[destination]!]++;
        const cpu = new Cpu68000(ram, before);
        checkPaired(ram, before, family, index, source, destination, 0x01234567, 0x89abcdef, cpu);
        checkPaired(ram, before, family, 0, source, destination, 0x67, 0xef);
      }
    }
  }
});

test("68000 paired ALU handles same-register operands, both stacks, wrapping, overlapping data and code", () => {
  const ram = new ObservedRam(0x1000000);
  for (const family of pairedFamilies) for (const bits of [0, 127]) for (let index = 0; index < 3; index++) {
    for (const value of [0, 1, 0x7fffffff, 0x80000000, 0xffffffff]) for (let code = 0; code < 8; code++) {
      const before = transferState(bits);
      before[registerForms[code]!.register] = value;
      checkPaired(ram, before, family, index, code, code, value, 0xffffffff - value);
    }
    for (const pc of [0xab001000, 0x12fffffe, 0xfffffffe]) for (const address of [0, 1, 2, 0x12fffffe, 0xffffffff, pc, pc + 2]) {
      for (const offset of [0, 1, 2, 4, 0x1000000]) {
        const before = { ...transferState(bits), pc, a0: unsignedLong(address), a1: unsignedLong(address + offset),
          usp: unsignedLong(address), ssp: unsignedLong(address) };
        checkPaired(ram, before, family, index, 0, 1, 0x81234567, 0x7fffffff);
        checkPaired(ram, before, family, index, 7, 7, 0x81234567, 0x7fffffff);
      }
    }
  }
});

test("68000 ADDX and SUBX consume live X and cumulative Z across multiword results", () => {
  const ram = new ObservedRam(0x1000000);
  for (const subtracting of [false, true]) {
    const before = initialState({ d0: 1, d1: 0, d2: subtracting ? 0 : 0xffffffff, d3: 0, flags: flags(4) });
    const cpu = new Cpu68000(ram, before);
    const low = { ...before, pc: before.pc + 2, d2: subtracting ? 0xffffffff : 0,
      flags: { ...before.flags, x: true, n: subtracting, z: !subtracting, c: true } };
    checkStep(ram, before, subtracting ? [0x95, 0x80] : [0xd5, 0x80], low, [], cpu); // D0,D2
    const high = { ...low, pc: low.pc + 2, d3: subtracting ? 0xffffffff : 1,
      flags: { ...low.flags, x: subtracting, n: subtracting, z: false, c: subtracting } };
    checkStep(ram, low, subtracting ? [0x97, 0x81] : [0xd7, 0x81], high, [], cpu); // D1,D3
    // A zero result in a later instruction must retain the previous nonzero summary.
    const cleared = { ...high, pc: high.pc + 2, d0: subtracting ? 0 : high.d0,
      flags: { ...high.flags, x: false, n: false, v: false, c: false } };
    checkStep(ram, high, subtracting ? [0x91, 0x81] : [0x93, 0x81], cleared, [], cpu); // SUBX.L D1,D0 or D1,D1
  }
});

// Ordinary-instruction completion. These oracles use decimal integers, BigInt division,
// and literal manual opwords rather than the core's decoder or ALU helpers.
function checkOrdinary(ram: ObservedRam, before: Cpu68000State, bytes: readonly number[], after: Cpu68000State,
  data: readonly Cpu68000MemoryAccess[] = [], runningCpu?: Cpu68000, outcome: "executed" | "halted" = "executed"): void {
  bytes.forEach((value, offset) => ram.write(physical(before.pc + offset), value));
  ram.accesses.length = 0;
  const cpu = runningCpu ?? new Cpu68000(ram, before);
  const accesses = [...memoryAccesses("read", before.pc, bytes), ...data];
  after.ir = bytes[0]! * 256 + bytes[1]!;
  assert.deepEqual(cpu.step(), { before: snapshot(before), after: snapshot(after),
    instruction: { address: before.pc, bytes }, outcome, accesses });
  assert.deepEqual(ram.accesses, accesses);
  const finalBytes = new Map(data.map(({ address, value }) => [address, value]));
  for (const [address, value] of finalBytes) assert.equal(ram.read(address), value);
}

function decimalResult(left: number, right: number, direction: number, before: Cpu68000Flags) {
  const decode = (value: number) => Math.floor(value / 16) * 10 + value % 16;
  const total = decode(left) + direction * (decode(right) + Number(before.x));
  const normalized = (total % 100 + 100) % 100;
  const result = Math.floor(normalized / 10) * 16 + normalized % 10;
  return { result, flags: { ...before, x: total < 0 || total > 99, c: total < 0 || total > 99,
    z: before.z && result === 0 } };
}

for (const [name, opcode, direction] of [["ABCD", 0xc300, 1], ["SBCD", 0x8300, -1], ["NBCD", 0x4801, -1]] as const) {
  test(`68000 ${name} exhausts valid packed decimal operands, incoming X/Z, and preserves undefined N/V`, () => {
    const ram = new ObservedRam(0x1000000);
    const packed = Array.from({ length: 100 }, (_, n) => Math.floor(n / 10) * 16 + n % 10);
    for (const left of name === "NBCD" ? [0] : packed) for (const right of packed) for (const x of [false, true]) for (const z of [false, true]) {
      const before = initialState({ d0: 0x12340000 + right, d1: 0xabcd0000 + (name === "NBCD" ? right : left),
        flags: { ...flags((left + right) % 128), x, z } });
      const expected = decimalResult(left, right, direction, before.flags);
      checkOrdinary(ram, before, wordBytes(opcode), { ...before, d1: 0xabcd0000 + expected.result,
        pc: before.pc + 2, flags: expected.flags });
    }
  });
}

test("68000 decimal forms cover every register pair, predecrement aliases, both stacks, and chained zero", () => {
  const ram = new ObservedRam(0x1000000);
  for (const [base, direction] of [[0xc100, 1], [0x8100, -1]] as const) {
    for (const memory of [false, true]) for (let source = 0; source < 8; source++) for (let destination = 0; destination < 8; destination++) {
      for (const supervisor of [false, true]) {
        const before = transferState(supervisor ? 127 : 63);
        const after = { ...before, pc: before.pc + 2 };
        const data: Cpu68000MemoryAccess[] = [];
        const sourceRegister = registerForms[source]!.register;
        const destinationRegister = registerForms[destination]!.register;
        let right = 0x19, left = 0x80;
        if (memory) {
          const names = addressNames(before);
          const s = names[source]!, d = names[destination]!;
          after[s] = unsignedLong(after[s] - (source === 7 ? 2 : 1));
          const sourceAddress = after[s];
          after[d] = unsignedLong(after[d] - (destination === 7 ? 2 : 1));
          ram.write(physical(sourceAddress), right);
          ram.write(physical(after[d]), left);
          const expected = decimalResult(left, right, direction, before.flags);
          data.push(...memoryAccesses("read", sourceAddress, [right]), ...memoryAccesses("read", after[d], [left]),
            ...memoryAccesses("write", after[d], [expected.result]));
          after.flags = expected.flags;
        } else {
          before[sourceRegister] = 0x12340000 + right;
          before[destinationRegister] = 0xabcd0000 + left;
          right = before[sourceRegister] % 256;
          Object.assign(after, before, { pc: before.pc + 2 });
          const expected = decimalResult(left, right, direction, before.flags);
          after[destinationRegister] = 0xabcd0000 + expected.result;
          after.flags = expected.flags;
        }
        checkOrdinary(ram, before, wordBytes(base + destination * 512 + (memory ? 8 : 0) + source), after, data);
      }
    }
  }
  // Invalid BCD digits have an explicit deterministic policy, not claimed hardware flags.
  for (const [opcode, left, right, x, result, carry] of [
    [0xc300, 0xff, 0xff, false, 0x54, true], [0xc300, 0x0f, 0x0f, true, 0x15, false],
    [0x8300, 0x00, 0xff, false, 0xab, true], [0x4801, 0x00, 0xff, true, 0xaa, true],
  ] as const) {
    const before = initialState({ d0: right, d1: opcode === 0x4801 ? right : left, flags: { ...flags(127), x } });
    checkOrdinary(ram, before, wordBytes(opcode), { ...before, d1: result, pc: before.pc + 2,
      flags: { ...before.flags, x: carry, c: carry, z: false } });
  }
});

function productResult(left: number, right: number, signed: boolean, before: Cpu68000Flags) {
  const operand = (n: number) => signed ? BigInt.asIntN(16, BigInt(n)) : BigInt(n % 65536);
  const result = Number(BigInt.asUintN(32, operand(left) * operand(right)));
  return { result, flags: moveFlags(before, result) };
}
function quotientResult(left: number, right: number, signed: boolean, before: Cpu68000Flags) {
  if (!right) return { result: left, flags: { ...before, c: false }, fault: "divide-by-zero" as const };
  const dividend = signed ? BigInt.asIntN(32, BigInt(left)) : BigInt(left);
  const divisor = signed ? BigInt.asIntN(16, BigInt(right)) : BigInt(right);
  const quotient = dividend / divisor;
  if (quotient < (signed ? -32768n : 0n) || quotient > (signed ? 32767n : 65535n)) {
    return { result: left, flags: { ...before, v: true, c: false } };
  }
  const low = Number(BigInt.asUintN(16, quotient));
  const result = Number(BigInt.asUintN(16, dividend % divisor)) * 65536 + low;
  return { result, flags: { ...before, n: low >= 32768, z: low === 0, v: false, c: false } };
}

for (const [name, base, signed, divide] of [
  ["MULU", 0xc0c0, false, false], ["MULS", 0xc1c0, true, false],
  ["DIVU", 0x80c0, false, true], ["DIVS", 0x81c0, true, true],
] as const) {
  test(`68000 ${name} exhausts word operands against independent BigInt arithmetic`, () => {
    const ram = new ObservedRam(0x1000000);
    for (let right = divide ? 1 : 0; right < 65536; right++) {
      const left = [0, 0x7fffffff, 0x80000000, 0xffffffff, 0x00010001, 0x12345678, 0xffff8000][right % 7]!;
      const before = initialState({ d0: left, flags: flags(right % 128) });
      const expected = (divide ? quotientResult : productResult)(left, right, signed, before.flags);
      checkOrdinary(ram, before, [...wordBytes(base + 60), ...wordBytes(right)],
        { ...before, d0: expected.result, flags: expected.flags, pc: before.pc + 4 });
    }
  });
  test(`68000 ${name} covers all 424 forms, including source/destination and index aliases`, () => {
    const ram = new ObservedRam(0x1000000);
    for (let register = 0; register < 8; register++) {
      const before = transferState(register % 2 ? 127 : 0);
      for (const ea of transferFixtures(before, 2, before.pc + 2).filter(ea => ea.code < 8 || ea.code >= 16)) {
        const value = ea.register ? before[ea.register] % 65536 : ea.immediate ?? 0xfffd;
        if (ea.address !== undefined) bytesFor(2, value).forEach((byte, offset) => ram.write(physical(ea.address! + offset), byte));
        const destination = registerForms[register]!.register;
        const expected = (divide ? quotientResult : productResult)(before[destination], value, signed, before.flags);
        const bytes = [...wordBytes(base + register * 512 + ea.code), ...ea.extension];
        const after = { ...before, [destination]: expected.result, flags: expected.flags, pc: before.pc + bytes.length };
        if (ea.update) after[ea.update[0]] = ea.update[1];
        checkOrdinary(ram, before, bytes, after, ea.address === undefined ? [] : memoryAccesses("read", ea.address, bytesFor(2, value)));
      }
    }
  });
}

test("68000 division distinguishes quotient limits, remainder signs, and overflow", () => {
  const ram = new ObservedRam(0x1000000);
  for (const signed of [false, true]) for (const divisor of [1, 2, 3, 0x7fff, 0x8000, 0xffff]) {
    for (const dividend of [0, 1, 0x7fff, 0x8000, 0xffff, 0x10000, 0x7fffffff, 0x80000000, 0xffff8000, 0xffffffff]) {
      for (const bits of [0, 127]) {
        const before = initialState({ d0: dividend, flags: flags(bits) });
        const expected = quotientResult(dividend, divisor, signed, before.flags);
        checkOrdinary(ram, before, [...wordBytes(signed ? 0x81fc : 0x80fc), ...wordBytes(divisor)],
          { ...before, d0: expected.result, flags: expected.flags, pc: before.pc + 4 });
      }
    }
  }
});

test("68000 CHK covers all 424 forms and signed bounds with native exceptions", () => {
  const ram = new ObservedRam(0x1000000);
  for (let register = 0; register < 8; register++) {
    const before = transferState(register % 2 ? 127 : 0);
    before[registerForms[register]!.register] = 0xabcd0008;
    for (const ea of transferFixtures(before, 2, before.pc + 2).filter(ea => ea.code < 8 || ea.code >= 16)) {
      const bound = ea.register ? before[ea.register] % 65536 : ea.immediate ?? 0x7fff;
      if (ea.address !== undefined) bytesFor(2, bound).forEach((b, i) => ram.write(physical(ea.address! + i), b));
      const bytes = [...wordBytes(0x4180 + register * 512 + ea.code), ...ea.extension];
      const after = { ...before, pc: before.pc + bytes.length };
      if (ea.update) after[ea.update[0]] = ea.update[1];
      const reads = ea.address === undefined ? [] : memoryAccesses("read", ea.address, bytesFor(2, bound));
      if (signedWord(bound) < 8) {
        checkException(ram, before, bytes, "bounds-check", 6, { ...after, flags: { ...before.flags, n: false } }, reads);
      } else checkOrdinary(ram, before, bytes, after, reads);
    }
  }
  for (let value = 0; value < 65536; value++) {
    const bound = [0, 1, 0x7fff, 0x8000, 0xffff][value % 5]!;
    const before = initialState({ d0: 0xabcd0000 + value, flags: flags(value % 128) });
    const bytes = [0x41, 0xbc, ...wordBytes(bound)];
    if (signedWord(value) < 0 || signedWord(value) > signedWord(bound)) {
      checkException(ram, before, bytes, "bounds-check", 6, { flags: { ...before.flags, n: signedWord(value) < 0 } });
    } else checkOrdinary(ram, before, bytes, { ...before, pc: before.pc + 4 });
  }
});

function statusFlags(word: number, before: Cpu68000Flags, full = true): Cpu68000Flags {
  return { ...before, x: Boolean(word & 16), n: Boolean(word & 8), z: Boolean(word & 4), v: Boolean(word & 2), c: Boolean(word & 1),
    ...(full ? { s: Boolean(word & 8192), t: Boolean(word & 32768) } : {}) };
}
function statusWord(state: Cpu68000State): number {
  const f = state.flags;
  return Number(f.t) * 32768 + Number(f.s) * 8192 + state.interruptMask * 256
    + Number(f.x) * 16 + Number(f.n) * 8 + Number(f.z) * 4 + Number(f.v) * 2 + Number(f.c);
}

test("68000 MOVE to CCR/SR and immediate status logic mask every possible word", () => {
  const ram = new ObservedRam(0x1000000);
  for (const full of [false, true]) {
    for (const [base, operation] of [[0x44fc, "move"], [0x003c, "or"], [0x023c, "and"], [0x0a3c, "xor"]] as const) {
      for (let word = 0; word < 65536; word++) {
        const before = initialState({ flags: { ...flags(word % 128), s: full || Boolean(word & 1) }, interruptMask: word % 8 });
        const old = statusWord(before);
        const value = operation === "move" ? word : operation === "or" ? old | word : operation === "and" ? old & word : old ^ word;
        const opcode = base + (full ? operation === "move" ? 0x200 : 0x40 : 0);
        checkOrdinary(ram, before, [...wordBytes(opcode), ...wordBytes(word)], { ...before, pc: before.pc + 4,
          flags: statusFlags(value, before.flags, full), interruptMask: full ? Math.floor(value / 256) % 8 : before.interruptMask });
      }
    }
  }
});

test("68000 MOVE from SR, NBCD, and TAS cover every data-alterable EA and ordered read/write", () => {
  const ram = new ObservedRam(0x1000000);
  for (const [base, size] of [[0x40c0, 2], [0x4800, 1], [0x4ac0, 1]] as const) {
    for (let bits = 0; bits < 128; bits++) {
      const initial = transferState(bits);
      for (const ea of transferFixtures(initial, size, initial.pc + 2).filter(ea => ea.code < 8 || (ea.code >= 16 && ea.code <= 57))) {
        const before = { ...initial };
        const value = ea.register ? before[ea.register] % 2 ** (size * 8) : base === 0x4800 ? 0x19 : bits * 2;
        if (ea.address !== undefined) bytesFor(size, value).forEach((b, i) => ram.write(physical(ea.address! + i), b));
        const bytes = [...wordBytes(base + ea.code), ...ea.extension];
        const after = { ...before, pc: before.pc + bytes.length };
        let result = statusWord(before);
        if (base === 0x4800) {
          // Register fixtures may contain non-BCD digits; substitute a valid operand first.
          if (ea.register) before[ea.register] = after[ea.register] = Math.floor(before[ea.register] / 256) * 256 + 0x19;
          const decimal = decimalResult(0, 0x19, -1, before.flags);
          result = decimal.result; after.flags = decimal.flags;
        } else if (base === 0x4ac0) {
          result = value | 128;
          after.flags = { ...before.flags, n: value >= 128, z: value === 0, v: false, c: false };
        }
        if (ea.update) after[ea.update[0]] = ea.update[1];
        if (ea.register) after[ea.register] = Math.floor(before[ea.register] / 2 ** (size * 8)) * 2 ** (size * 8) + result;
        checkOrdinary(ram, before, bytes, after, ea.address === undefined ? [] : [
          ...memoryAccesses("read", ea.address, bytesFor(size, value)), ...memoryAccesses("write", ea.address, bytesFor(size, result)),
        ]);
      }
    }
  }
});

test("68000 status sources cover every EA, including postincrement of SSP while changing S", () => {
  const ram = new ObservedRam(0x1000000);
  for (const full of [false, true]) {
    const before = transferState(127);
    for (const ea of transferFixtures(before, 2, before.pc + 2).filter(ea => ea.code < 8 || ea.code >= 16)) {
      const value = ea.register ? before[ea.register] % 65536 : ea.immediate ?? 0x0515;
      if (ea.address !== undefined) wordBytes(value).forEach((b, i) => ram.write(physical(ea.address! + i), b));
      const bytes = [...wordBytes((full ? 0x46c0 : 0x44c0) + ea.code), ...ea.extension];
      const after = { ...before, pc: before.pc + bytes.length, flags: statusFlags(value, before.flags, full),
        interruptMask: full ? Math.floor(value / 256) % 8 : before.interruptMask };
      if (ea.update) after[ea.update[0]] = ea.update[1];
      checkOrdinary(ram, before, bytes, after, ea.address === undefined ? [] : memoryAccesses("read", ea.address, wordBytes(value)));
    }
  }
});

test("68000 privileged instructions trap before fetching operands and USP transfers use active A7", () => {
  const ram = new ObservedRam(0x1000000);
  const opcodes = [0x007c, 0x027c, 0x0a7c, 0x4e72, 0x4e73, 0x4e70];
  for (let ea = 0; ea <= 60; ea++) if (ea < 8 || ea >= 16) opcodes.push(0x46c0 + ea);
  for (let code = 0; code < 16; code++) opcodes.push(0x4e60 + code);
  for (const opcode of opcodes) {
    const before = transferState(63);
    checkException(ram, before, wordBytes(opcode), "privilege-violation", 8);
  }
  for (let code = 0; code < 8; code++) for (const load of [false, true]) {
    const before = initialState();
    const register = addressNames(before)[code]!;
    const after = { ...before, pc: before.pc + 2, [load ? register : "usp"]: load ? before.usp : before[register] };
    checkOrdinary(ram, before, wordBytes(0x4e60 + (load ? 8 : 0) + code), after);
  }
});

test("68000 MOVEP covers every encoding, odd addresses, signed displacement, bus wrapping, and byte gaps", () => {
  const ram = new ObservedRam(0x1000000);
  function check(code: number, register: number, size: 2 | 4, store: boolean, displacement: number, supervisor: boolean, base: number): void {
    const before = transferState(supervisor ? 127 : 0);
    const name = registerForms[register]!.register;
    before[addressNames(before)[code]!] = base;
    const address = unsignedLong(base + signedWord(displacement));
    const bytes = [...wordBytes(0x0108 + register * 512 + (size === 4 ? 64 : 0) + (store ? 128 : 0) + code), ...wordBytes(displacement)];
    const transfer = store ? bytesFor(size, before[name]) : [0x89, 0xab, 0xcd, 0xef].slice(0, size);
    for (let offset = 0; offset < size * 2; offset++) ram.write(physical(address + offset), offset % 2 ? 0x5a : transfer[offset / 2]!);
    const after = { ...before, pc: before.pc + 4 };
    if (!store) after[name] = Math.floor(before[name] / 2 ** (size * 8)) * 2 ** (size * 8)
      + transfer.reduce((value, byte) => value * 256 + byte, 0);
    checkOrdinary(ram, before, bytes, after, transfer.map((value, offset) => ({ kind: store ? "write" : "read", value, address: physical(address + offset * 2) })));
    for (let offset = 1; offset < size * 2; offset += 2) assert.equal(ram.read(physical(address + offset)), 0x5a);
  }
  for (let code = 0; code < 8; code++) for (let register = 0; register < 8; register++) {
    for (const size of [2, 4] as const) for (const store of [false, true]) for (const supervisor of [false, true]) {
      for (const base of [0xab008001, 0xffffffff]) check(code, register, size, store, 0xfffe, supervisor, base);
    }
  }
  for (let displacement = 0; displacement < 65536; displacement++) {
    check(7, 7, displacement % 2 ? 2 : 4, Boolean(displacement & 2), displacement, Boolean(displacement & 4), 0xcd030001);
  }
});

test("68000 EXG covers every bank pair and self-alias; EXT and SWAP preserve unselected data and X", () => {
  const ram = new ObservedRam(0x1000000);
  for (const supervisor of [false, true]) for (let left = 0; left < 8; left++) for (let right = 0; right < 8; right++) {
    const before = transferState(supervisor ? 127 : 0);
    for (const [base, l, r] of [[0xc140, registerForms[left]!.register, registerForms[right]!.register],
      [0xc148, addressNames(before)[left]!, addressNames(before)[right]!], [0xc188, registerForms[left]!.register, addressNames(before)[right]!]] as const) {
      checkOrdinary(ram, before, wordBytes(base + left * 512 + right), { ...before, pc: before.pc + 2, [l]: before[r], [r]: before[l] });
    }
  }
  for (const [base, size] of [[0x4840, 4], [0x4880, 2], [0x48c0, 4]] as const) for (let value = 0; value < 65536; value++) {
    const register = value % 8, name = registerForms[register]!.register;
    const original = 0xabc00000 + value;
    const result = base === 0x4840 ? value * 65536 + 0xabc0 : base === 0x4880
      ? (value % 256 < 128 ? value % 256 : 0xff00 + value % 256) : unsignedLong(signedWord(value));
    const before = initialState({ [name]: original, flags: flags(value % 128) });
    checkOrdinary(ram, before, wordBytes(base + register), { ...before, [name]: size === 2 ? 0xabc00000 + result : result,
      pc: before.pc + 2, flags: { ...before.flags, n: result >= 2 ** (size * 8 - 1), z: result === 0, v: false, c: false } });
  }
});

test("68000 RTR restores only CCR and full PC, validates before committing, and uses either wrapping stack", () => {
  const ram = new ObservedRam(0x1000000);
  for (const supervisor of [false, true]) for (const address of [0x12345678, 0xfffffffe, 0xffffffff]) {
    for (const target of [0xab003000, 0xffffffff]) {
      const before = initialState({ flags: { ...flags(127), s: supervisor }, [supervisor ? "ssp" : "usp"]: address });
      const bytes = [0x4e, 0x77], frame = [0xff, 0xe0, ...longBytes(target)];
      frame.forEach((b, i) => ram.write(physical(address + i), b));
      bytes.forEach((b, i) => ram.write(0x1000 + i, b));
      ram.accesses.length = 0;
      const record = new Cpu68000(ram, before).step();
      const oddStack = address % 2 !== 0, oddTarget = target % 2 !== 0;
      const after = { ...before, pc: target, [supervisor ? "ssp" : "usp"]: unsignedLong(address + 6), flags: statusFlags(0xffe0, before.flags, false) };
      after.ir = 0x4e77;
      const accesses = [...memoryAccesses("read", before.pc, bytes), ...(oddStack ? [] : memoryAccesses("read", address, frame))];
      const expected = oddStack || oddTarget
        ? addressErrorRecord({ before: snapshot(before), instruction: { address: before.pc, bytes }, accesses,
          fault: { operation: oddStack ? "read" : "fetch", address: oddStack ? address : target } })
        : { before: snapshot(before), after: snapshot(after), instruction: { address: before.pc, bytes }, accesses, outcome: "executed" };
      assert.deepEqual(record, expected);
      assert.deepEqual(ram.accesses, record.accesses);
    }
  }
});

test("68000 NOP preserves state and STOP owns a validated, restorable latch cleared by external reset", () => {
  const ram = new ObservedRam(0x1000000);
  for (let bits = 0; bits < 128; bits++) {
    const before = initialState({ pc: 0xfffffffe, flags: flags(bits) });
    checkOrdinary(ram, before, [0x4e, 0x71], { ...before, pc: 0 });
  }
  for (const value of [undefined, 0, 1, "false", null]) {
    const before = initialState(); Reflect.set(before, "halted", value);
    assert.throws(() => new Cpu68000(ram, before), TypeError);
  }
  for (const status of [0, 0x2000, 0xa71f, 0xffff]) {
    const before = initialState({ pc: 0xfffffffc });
    const cpu = new Cpu68000(ram, before);
    const after = { ...before, pc: 0, halted: true, flags: statusFlags(status, before.flags), interruptMask: Math.floor(status / 256) % 8 };
    checkOrdinary(ram, before, [0x4e, 0x72, ...wordBytes(status)], after, [], cpu, "halted");
    const saved = cpu.snapshot();
    for (const stopped of [cpu, new Cpu68000(ram, saved), new Cpu68000(ram, { ...saved, pc: 1 })]) {
      ram.accesses.length = 0;
      const snapshot = stopped.snapshot();
      assert.deepEqual(stopped.step(), { before: snapshot, after: snapshot, accesses: [], outcome: "halted", instruction: null });
      assert.deepEqual(ram.accesses, []);
    }
    const vector = [0x12, 0x34, 0x56, 0x78, 0xab, 0, 0x10, 0];
    vector.forEach((b, i) => ram.write(i, b));
    const resetState = { ...after, halted: false, ssp: 0x12345678, pc: 0xab001000, interruptMask: 7, flags: { ...after.flags, s: true, t: false } };
    ram.accesses.length = 0;
    assert.deepEqual(cpu.reset(), { before: saved, after: snapshot(resetState), accesses: memoryAccesses("read", 0, vector) });
    checkOrdinary(ram, resetState, [0x4e, 0x71], { ...resetState, pc: resetState.pc + 2 }, [], cpu);
    assert.deepEqual(saved, snapshot(after));
  }
});

test("68000 word-source operations and MOVE from SR fault on every odd memory EA before operand commits", () => {
  const ram = new ObservedRam(0x1000000);
  for (const base of [0x4180, 0x44c0, 0x46c0, 0xc0c0, 0xc1c0, 0x80c0, 0x81c0, 0x40c0]) {
    const before = transferState(127);
    for (const name of addressNames(before)) before[name] += 1;
    for (const original of transferFixtures(before, 2, before.pc + 2).filter(ea => ea.address !== undefined && (base !== 0x40c0 || ea.code <= 57))) {
      const ea = { ...original };
      if (ea.address! % 2 === 0) {
        ea.address! += 1;
        ea.extension = [...ea.extension.slice(0, -1), ea.extension.at(-1)! + 1];
      }
      const bytes = [...wordBytes(base + ea.code), ...ea.extension];
      bytes.forEach((b, i) => ram.write(0x1000 + i, b));
      ram.accesses.length = 0;
      const record = new Cpu68000(ram, before).step();
      const expected = addressErrorRecord({ before: snapshot(before), instruction: { address: before.pc, bytes }, accesses: memoryAccesses("read", before.pc, bytes), fault: { operation: "read", address: ea.address! } });
      assert.deepEqual(record, expected);
      assert.deepEqual(ram.accesses, record.accesses);
    }
  }
});

// Manual vectors and six-byte frames are independent of the core's private decoder/helpers.
function checkException(ram: ObservedRam, before: Cpu68000State, bytes: number[], source: Cpu68000Exception,
  vector: number, effects: Partial<Cpu68000State> = {}, operandReads: Cpu68000MemoryAccess[] = []): void {
  const completed = { ...before, ...effects };
  const returnPc = ["trap", "overflow-trap", "divide-by-zero", "bounds-check"].includes(source)
    ? unsignedLong(before.pc + bytes.length) : before.pc;
  const target = 0xcd006000;
  const stack = unsignedLong(completed.ssp - 6);
  const status = statusWord(completed);
  bytes.forEach((b, i) => ram.write(physical(before.pc + i), b));
  longBytes(target).forEach((b, i) => ram.write(vector * 4 + i, b));
  ram.accesses.length = 0;
  const cpu = new Cpu68000(ram, before);
  const record = cpu.step();
  const after = { ...completed, ssp: stack, pc: target, flags: { ...completed.flags, s: true, t: false } };
  after.ir = bytes[0]! * 256 + bytes[1]!;
  assert.deepEqual(record, { before: snapshot(before), after: snapshot(after), instruction: { address: before.pc, bytes },
    outcome: "executed", exception: { source, vector, returnPc }, accesses: [
      ...memoryAccesses("read", before.pc, bytes), ...operandReads,
      ...memoryAccesses("write", stack + 4, wordBytes(returnPc % 65536)),
      ...memoryAccesses("write", stack, wordBytes(status)),
      ...memoryAccesses("write", stack + 2, wordBytes(Math.floor(returnPc / 65536))),
      ...memoryAccesses("read", vector * 4, longBytes(target)),
    ] });
  assert.deepEqual(ram.accesses, record.accesses);
  assert.deepEqual(cpu.snapshot(), snapshot(after));
  [...wordBytes(status), ...longBytes(returnPc)].forEach((b, i) => assert.equal(ram.read(physical(stack + i)), b));
}

test("68000 TRAP selects every vector and stacks all status combinations through SSP", () => {
  const ram = new ObservedRam(0x1000000);
  for (let vector = 0; vector < 16; vector++) for (let bits = 0; bits < 128; bits++) for (let mask = 0; mask < 8; mask++) {
    const before = initialState({ flags: flags(bits), interruptMask: mask });
    checkException(ram, before, [0x4e, 0x40 + vector], "trap", 32 + vector);
  }
  for (const pc of [0x12fffffe, 0xfffffffe]) for (const ssp of [0, 2, 4, 0x12000002]) {
    checkException(ram, initialState({ pc, ssp }), [0x4e, 0x4f], "trap", 47);
  }
});

test("68000 ILLEGAL saves the faulting PC; TRAPV tests V and saves the following PC", () => {
  const ram = new ObservedRam(0x1000000);
  for (let bits = 0; bits < 128; bits++) {
    const before = initialState({ pc: 0xfffffffe, flags: flags(bits) });
    checkException(ram, before, [0x4a, 0xfc], "illegal-instruction", 4);
    if (before.flags.v) checkException(ram, before, [0x4e, 0x76], "overflow-trap", 7);
    else checkOrdinary(ram, before, [0x4e, 0x76], { ...before, pc: 0 });
  }
});

test("68000 illegal and emulator-line entries preserve every status image and the full faulting PC", () => {
  const ram = new ObservedRam(0x1000000);
  for (const [opcode, source, vector] of [
    [0x4afa, "illegal-instruction", 4], [0x4afb, "illegal-instruction", 4],
    [0xa123, "line-a", 10], [0xfedc, "line-f", 11],
  ] as const) {
    for (let bits = 0; bits < 128; bits++) for (let mask = 0; mask < 8; mask++) {
      const before = initialState({ pc: 0xfffffffe, interruptMask: mask, flags: { ...flags(bits), t: Boolean(bits & 32) } });
      checkException(ram, before, wordBytes(opcode), source, vector);
    }
    for (const pc of [0x12fffffe, 0xfffffffe]) for (const ssp of [0, 2, 4, 0x12000002]) {
      checkException(ram, initialState({ pc, ssp, flags: { ...flags(31), t: true } }), wordBytes(opcode), source, vector);
    }
  }
});

test("68000 illegal and emulator-line RTE returns retry the original word without an owed trace", () => {
  const ram = new ObservedRam(0x1000000);
  for (const [opcode, source, vector] of [[0x4afa, "illegal-instruction", 4], [0xa123, "line-a", 10], [0xffff, "line-f", 11]] as const) {
    for (const s of [false, true]) for (const t of [false, true]) {
      const before = initialState({ pc: 0xab001000, ssp: 0x12000002, flags: { ...flags(31), s, t } });
      wordBytes(opcode).forEach((b, i) => ram.write(physical(before.pc + i), b));
      longBytes(0xcd006000).forEach((b, i) => ram.write(vector * 4 + i, b));
      [0x4e, 0x73].forEach((b, i) => ram.write(0x6000 + i, b));
      const entry = new Cpu68000(ram, before).step();
      assert.deepEqual(entry.exception, { source, vector, returnPc: before.pc });
      assert.equal(entry.after.tracePending, false);
      const saved = structuredClone(entry);
      const restored = new Cpu68000(ram, entry.after);
      const returned = restored.step();
      assert.deepEqual(returned.after, snapshot({ ...before, ir: 0x4e73 }));
      assert.equal(returned.exception, undefined);
      // Returning to the same word faults again; neither entry nor RTE manufactured a trace.
      const retry = new Cpu68000(ram, returned.after).step();
      assert.deepEqual(retry, { ...entry, before: returned.after });
      assert.deepEqual(entry, saved);
      Reflect.set(retry.exception!, "source", "edited");
      Reflect.set(retry.after.flags, "c", !retry.after.flags.c);
      assert.deepEqual(entry, saved);
      assert.deepEqual(restored.snapshot(), snapshot({ ...before, ir: 0x4e73 }));
    }
  }
});

test("68000 illegal and emulator-line vectors can be zero, odd, or overwritten by their own frame", () => {
  const ram = new ObservedRam(0x1000000);
  for (const [opcode, vector] of [[0x4afa, 4], [0xa123, 10], [0xfedc, 11]] as const) {
    for (const target of [0, 0xffffffff]) {
      const before = initialState({ flags: { ...flags(31), t: true } });
      wordBytes(opcode).forEach((b, i) => ram.write(physical(before.pc + i), b));
      longBytes(target).forEach((b, i) => ram.write(vector * 4 + i, b));
      for (let i = 12; i < 16; i++) ram.write(i, 0);
      ram.accesses.length = 0;
      const cpu = new Cpu68000(ram, before);
      const entry = cpu.step();
      assert.equal(entry.outcome, "executed");
      assert.equal(entry.after.pc, target % 2 ? 0 : target);
      assert.equal(entry.after.tracePending, false);
      assert.equal(entry.accesses.length, target % 2 ? 30 : 12);
      assert.deepEqual(entry.accesses.slice(8, 12), memoryAccesses("read", vector * 4, longBytes(target)));
      assert.deepEqual(ram.accesses, entry.accesses);
      if (target % 2) {
        assert.equal(entry.exception?.source, "address-error");
        if (entry.exception?.source !== "address-error") assert.fail();
        assert.deepEqual(entry.exception.fault, { operation: "fetch", address: target,
          instructionRegister: opcode, functionCode: 6, processingInstruction: false });
      }

    }
    const before = initialState({ pc: 0x12345678, ssp: vector * 4 + 4 });
    wordBytes(opcode).forEach((b, i) => ram.write(physical(before.pc + i), b));
    longBytes(0xdeadbeef).forEach((b, i) => ram.write(vector * 4 + i, b));
    ram.accesses.length = 0;
    const entry = new Cpu68000(ram, before).step();
    assert.equal(entry.after.pc, before.pc, "The frame replaces the vector with the faulting PC");
    assert.equal(entry.after.ssp, before.ssp - 6);
    assert.deepEqual(entry.accesses.slice(-4), memoryAccesses("read", vector * 4, longBytes(before.pc)));
    assert.equal(entry.accesses.length, 12);
    assert.deepEqual(ram.accesses, entry.accesses);
  }
});

test("68000 divide by zero covers every source and preserves completed An updates and defined flags", () => {
  const ram = new ObservedRam(0x1000000);
  for (const base of [0x80c0, 0x81c0]) for (let register = 0; register < 8; register++) for (const bits of [0, 63, 64, 127]) {
    const before = transferState(bits);
    for (const ea of transferFixtures(before, 2, before.pc + 2).filter(ea => ea.code < 8 || ea.code >= 16)) {
      const state = { ...before };
      if (ea.register) state[ea.register] = Math.floor(state[ea.register] / 65536) * 65536;
      if (ea.address !== undefined) wordBytes(0).forEach((b, i) => ram.write(physical(ea.address! + i), b));
      const bytes = [...wordBytes(base + register * 512 + ea.code), ...(ea.immediate === undefined ? ea.extension : [0, 0])];
      const effects: Partial<Cpu68000State> = { flags: { ...state.flags, c: false } };
      if (ea.update) effects[ea.update[0]] = ea.update[1];
      checkException(ram, state, bytes, "divide-by-zero", 5, effects,
        ea.address === undefined ? [] : memoryAccesses("read", ea.address, [0, 0]));
    }
  }
  // Postincrement wraps the full address; user A7 still updates USP before the supervisor switch.
  for (const supervisor of [false, true]) {
    const before = initialState({ flags: { ...flags(127), s: supervisor }, [supervisor ? "ssp" : "usp"]: 0xfffffffe });
    ram.write(0xfffffe, 0); ram.write(0xffffff, 0);
    checkException(ram, before, [0x80, 0xdf], "divide-by-zero", 5,
      { [supervisor ? "ssp" : "usp"]: 0, flags: { ...before.flags, c: false } }, memoryAccesses("read", 0xfffffffe, [0, 0]));
  }
});

test("68000 RTE restores every status word from the six-byte supervisor frame", () => {
  const ram = new ObservedRam(0x1000000);
  for (let status = 0; status < 65536; status++) {
    const before = initialState({ ssp: [0x56009000, 0xfffffffe, 0x12fffffc][status % 3]!, flags: { ...flags(status % 128), s: true } });
    const target = 0xab004000;
    const frame = [...wordBytes(status), ...longBytes(target)];
    frame.forEach((b, i) => ram.write(physical(before.ssp + i), b));
    checkOrdinary(ram, before, [0x4e, 0x73], { ...before, pc: target, ssp: unsignedLong(before.ssp + 6),
      interruptMask: Math.floor(status / 256) % 8, flags: statusFlags(status, before.flags) }, [
      ...memoryAccesses("read", before.ssp + 2, frame.slice(2, 4)),
      ...memoryAccesses("read", before.ssp, frame.slice(0, 2)),
      ...memoryAccesses("read", before.ssp + 4, frame.slice(4)),
    ]);
  }
});

test("68000 exception stacking precedes overlapping vector reads and fetches no handler instruction", () => {
  const ram = new ObservedRam(0x1000000);
  // TRAP #0's vector starts at $80. The frame overwrites its target with the return PC.
  const before = initialState({ ssp: 0x84, pc: 0x12345678, flags: flags(63) });
  [0x4e, 0x40].forEach((b, i) => ram.write(physical(before.pc + i), b));
  [0xde, 0xad, 0xbe, 0xef].forEach((b, i) => ram.write(0x80 + i, b));
  ram.accesses.length = 0;
  const record = new Cpu68000(ram, before).step();
  assert.equal(record.after.pc, before.pc + 2);
  assert.equal(record.after.ssp, 0x7e);
  assert.deepEqual(record.accesses.slice(-4), memoryAccesses("read", 0x80, longBytes(before.pc + 2)));
  assert.equal(record.accesses.length, 12);
  assert.deepEqual(ram.accesses, record.accesses);
});

test("68000 odd exception stacks halt and RTE alignment faults enter vector 3", () => {
  const ram = new ObservedRam(0x1000000);
  for (const opcode of [0x4e40, 0x4afc, 0x80df, 0x419f, 0x4afa, 0xa123, 0xfedc]) {
    const before = initialState({ ssp: 0x1001, usp: 0xfffffffe, d0: 0xffffffff, flags: { ...flags(63), t: true } });
    wordBytes(opcode).forEach((b, i) => ram.write(0x1000 + i, b));
    ram.write(0xfffffe, 0); ram.write(0xffffff, 0);
    const step = new Cpu68000(ram, before).step();
    assert.equal(step.outcome, "halted");
    if (step.exception?.source !== "address-error") assert.fail();
    assert.deepEqual(step.exception.fault, { operation: "write", address: 0xfff, instructionRegister: opcode,
      functionCode: 5, processingInstruction: [0x4e40, 0x80df, 0x419f].includes(opcode) });
    assert.deepEqual(step.exception.entryFault, { operation: "write", address: 0xff9 });
    const after = { ...before, ir: opcode, ssp: 0xfed, faulted: true,
      ...(opcode === 0x80df || opcode === 0x419f ? { usp: 0 } : {}),
      flags: { ...before.flags, s: true, t: false, ...(opcode === 0x80df ? { c: false } : opcode === 0x419f ? { n: true } : {}) } };
    assert.deepEqual(step.after, snapshot(after));
    assert.ok(step.accesses.every(access => access.kind === "read"));
  }
  for (const stack of [0x9001, 0xfffffffe]) for (const target of [0x12345678, 0xffffffff]) {
    const before = initialState({ ssp: stack });
    [0, 0, ...longBytes(target)].forEach((b, i) => ram.write(physical(stack + i), b));
    ram.write(0x1000, 0x4e); ram.write(0x1001, 0x73);
    const step = new Cpu68000(ram, before).step();
    if (stack % 2 || target % 2) {
      assert.equal(step.outcome, stack % 2 ? "halted" : "executed");
      if (step.exception?.source !== "address-error") assert.fail();
      assert.equal(step.exception.fault.operation, stack % 2 ? "read" : "fetch");
      assert.equal(step.exception.fault.address, stack % 2 ? stack : target);
      assert.equal(step.accesses.length, stack % 2 ? 2 : 26);
    } else assert.equal(step.outcome, "executed");
  }
});

test("68000 nested exceptions and RTE resume user code and restored snapshots without changing earlier records", () => {
  const ram = new ObservedRam(0x1000000);
  const before = initialState({ flags: flags(63), pc: 0xab001000 });
  for (const [address, bytes] of [[128, longBytes(0xcd002000)], [132, longBytes(0xef003000)],
    [0x1000, [0x4e, 0x40, 0x70, 0x2a]], [0x2000, [0x4e, 0x41, 0x4e, 0x73]], [0x3000, [0x4e, 0x73]]] as const) {
    bytes.forEach((b, i) => ram.write(address + i, b));
  }
  let cpu = new Cpu68000(ram, before);
  const records = [];
  for (let count = 0; count < 5; count++) {
    records.push(cpu.step());
    cpu = new Cpu68000(ram, cpu.snapshot());
  }
  assert.deepEqual(records.map(r => [r.after.pc, r.after.ssp, r.after.flags.s, r.after.flags.t]), [
    [0xcd002000, before.ssp - 6, true, false], [0xef003000, before.ssp - 12, true, false],
    [0xcd002002, before.ssp - 6, true, false], [0xab001002, before.ssp, false, false],
    [0xab001004, before.ssp, false, false],
  ]);
  assert.deepEqual(cpu.snapshot(), snapshot({ ...before, ir: 0x702a, pc: before.pc + 4, d0: 42,
    flags: { ...before.flags, n: false, z: false, v: false, c: false } }));
  assert.deepEqual(records[0]!.before, snapshot(before));
  assert.deepEqual(records[0]!.exception, { source: "trap", vector: 32, returnPc: before.pc + 2 });
});

test("68000 callback failures retain completed transfers and release the execution guard", () => {
  class CallbackRam extends ObservedRam {
    callback: (kind: "read" | "write", address: number) => void = () => {};
    override read(address: number): number { this.callback("read", address); return super.read(address); }
    override write(address: number, value: number): void { this.callback("write", address); super.write(address, value); }
  }
  const ram = new CallbackRam(0x1000000);
  const before = initialState();
  const failure = new Error("host RAM failure");
  for (const [mode, opcode, vector] of [
    ["entry", 0x4e40, 32], ["entry", 0x4afa, 4], ["entry", 0xa123, 10], ["entry", 0xfedc, 11],
    ["return", 0x4e73, 32], ["reset", 0x4e40, 32],
  ] as const) {
    const accesses = mode === "entry" ? 12 : 8;
    for (let stop = 0; stop < accesses; stop++) {
      ram.callback = () => {};
      const state = mode === "return" ? { ...before, ssp: 0x8000 } : before;
      wordBytes(opcode).forEach((b, i) => ram.write(0x1000 + i, b));
      [0, 0, 0xab, 0, 0x20, 0].forEach((b, i) => ram.write(0x8000 + i, b));
      [0x56, 0, 0x90, 0, 0xab, 0, 0x10, 0].forEach((b, i) => ram.write(i, b));
      longBytes(0xcd002000).forEach((b, i) => ram.write(vector * 4 + i, b));
      const cpu = new Cpu68000(ram, state);
      let calls = 0;
      ram.accesses.length = 0;
      ram.callback = () => {
        const visible = cpu.snapshot();
        assert.throws(() => cpu.step(), /must not be reentrant/);
        assert.throws(() => cpu.reset(), /must not be reentrant/);
        assert.deepEqual(cpu.snapshot(), visible);
        if (calls++ === stop) throw failure;
      };
      assert.throws(() => mode === "reset" ? cpu.reset() : cpu.step(), error => error === failure);
      assert.equal(ram.accesses.length, stop);
      const partial = cpu.snapshot();
      const expected = mode === "entry" && stop >= 2 ? { ...before, ssp: before.ssp - 6, flags: { ...before.flags, t: false, s: true } }
        : mode === "reset" && stop >= 4 ? { ...before, ssp: 0x56009000 } : state;
      assert.deepEqual(partial, snapshot({ ...expected, ir: mode !== "reset" && stop >= 2 ? opcode : before.ir }));
      ram.callback = () => {};
      assert.doesNotThrow(() => cpu.reset());
      assert.equal(cpu.step().outcome, "executed");
    }
  }
});

test("68000 interrupts cover every level, mask, status image, and STOP state", () => {
  const ram = new ObservedRam(0x1000000);
  for (const level of [1, 2, 3, 4, 5, 6, 7] as const) for (let mask = 0; mask < 8; mask++) {
    for (let bits = 0; bits < 128; bits++) for (const halted of [false, true]) {
      const before = initialState({ interruptMask: mask, halted, flags: { ...flags(bits), t: Boolean(bits & 32) } });
      const cpu = new Cpu68000(ram, before);
      const vector = 24 + level, target = 0xcd004000;
      longBytes(target).forEach((b, i) => ram.write(vector * 4 + i, b));
      ram.accesses.length = 0;
      let calls = 0;
      const entered = { ...before, ssp: before.ssp - 6, halted: false, interruptMask: level,
        flags: { ...before.flags, s: true, t: false } };
      const record = cpu.interrupt(level, () => {
        calls++;
        assert.deepEqual(cpu.snapshot(), snapshot(entered));
        assert.throws(() => cpu.interrupt(7, () => "autovector"), /must not be reentrant/);
        return "autovector";
      });
      if (level !== 7 && level <= mask) {
        assert.equal(calls, 0);
        assert.deepEqual(record, { before: snapshot(before), after: snapshot(before), instruction: null,
          accesses: [], level, outcome: "ignored", reason: "masked" });
      } else {
        assert.equal(calls, 1);
        assert.deepEqual(record, { before: snapshot(before), after: snapshot({ ...entered, pc: target }), instruction: null,
          level, outcome: "accepted", vector, returnPc: before.pc, accesses: [
            { kind: "acknowledge", level, value: "autovector" },
            ...memoryAccesses("write", before.ssp - 2, wordBytes(before.pc % 65536)),
            ...memoryAccesses("write", before.ssp - 6, wordBytes(statusWord(before))),
            ...memoryAccesses("write", before.ssp - 4, wordBytes(Math.floor(before.pc / 65536))),
            ...memoryAccesses("read", vector * 4, longBytes(target)),
          ] });
      }
      assert.deepEqual(ram.accesses, record.accesses.filter(a => a.kind !== "acknowledge"));
    }
  }
});

test("68000 interrupt acknowledgements select all byte vectors, autovectors, and the spurious vector", () => {
  const ram = new ObservedRam(0x1000000);
  for (const response of [...Array.from({ length: 256 }, (_, i) => i), "autovector", "spurious"] as const) {
    const before = initialState({ pc: 0xffffffff, ssp: 2, halted: true });
    const vector = response === "autovector" ? 28 : response === "spurious" ? 24 : response;
    // Zero is a valid handler address, not an implicit request for the uninitialized-device vector.
    const target = vector % 2 ? 0x12003000 : 0;
    longBytes(target).forEach((b, i) => ram.write(vector * 4 + i, b));
    const cpu = new Cpu68000(ram, before);
    const record = cpu.interrupt(4, () => response);
    assert.equal(record.outcome, "accepted");
    if (record.outcome !== "accepted") assert.fail();
    assert.equal(record.vector, vector);
    // A wrapping frame can overlap vector 0: its last word at $000000 is PC low ($FFFF).
    assert.equal(record.after.pc, vector === 0 ? 0xffff0000 : target);
    assert.equal(record.after.ssp, 0xfffffffc);
    assert.equal(record.after.usp, before.usp);
    assert.deepEqual(record.accesses[0], { kind: "acknowledge", level: 4, value: response });
  }
  const before = initialState({ ssp: 0x80, pc: 0xab004000 });
  // Level 7 autovector at $7C overlaps the return PC in the frame; no target is prefetched.
  const record = new Cpu68000(ram, before).interrupt(7, () => "autovector");
  assert.equal(record.after.pc, before.pc);
  assert.equal(record.accesses.length, 11);
});

test("68000 interrupt validation is lazy for masked requests and preserves explicit failure boundaries", () => {
  const ram = new ObservedRam(0x1000000);
  const before = initialState({ interruptMask: 7 });
  const cpu = new Cpu68000(ram, before);
  for (const level of [0, 8, -1, 0.5, NaN, Infinity, undefined, "7", null]) {
    assert.throws(() => Reflect.apply(cpu.interrupt, cpu, [level, () => "autovector"]));
    assert.deepEqual(cpu.snapshot(), snapshot(before));
  }
  assert.equal(Reflect.apply(cpu.interrupt, cpu, [6, null]).outcome, "ignored");
  assert.throws(() => Reflect.apply(cpu.interrupt, cpu, [7, null]), /acknowledge callback/);
  assert.deepEqual(ram.accesses, []);
  const failure = new Error("acknowledge failed");
  for (const response of [-1, 256, 0.5, NaN, Infinity, null, undefined, "bad", failure]) {
    const interrupted = new Cpu68000(ram, { ...before, halted: true, flags: { ...before.flags, s: false, t: true } });
    assert.throws(() => Reflect.apply(interrupted.interrupt, interrupted, [7, () => {
      if (response === failure) throw failure;
      return response;
    }]));
    assert.deepEqual(interrupted.snapshot(), snapshot({ ...before, halted: false, ssp: before.ssp - 6,
      flags: { ...before.flags, s: true, t: false } }));
    assert.deepEqual(ram.accesses, []);
    assert.doesNotThrow(() => interrupted.reset());
    ram.accesses.length = 0;
  }
});

test("68000 trace samples incoming T across SR loads, RTE, branches, and STOP", () => {
  const ram = new ObservedRam(0x1000000);
  for (const t of [false, true]) for (const status of [0, 0x2000, 0xa71f]) {
    for (const opcode of [0x4e71, 0x46fc, 0x4e72, 0x4e73, 0x6006]) {
      const before = initialState({ flags: { ...flags(127), t } });
      const bytes = opcode === 0x46fc || opcode === 0x4e72 ? [...wordBytes(opcode), ...wordBytes(status)] : wordBytes(opcode);
      bytes.forEach((b, i) => ram.write(physical(before.pc + i), b));
      [...wordBytes(status), ...longBytes(0xef005000)].forEach((b, i) => ram.write(physical(before.ssp + i), b));
      longBytes(0xcd006000).forEach((b, i) => ram.write(36 + i, b));
      const cpu = new Cpu68000(ram, before);
      const executed = cpu.step();
      assert.equal(executed.after.tracePending, t);
      assert.equal(executed.outcome, opcode === 0x4e72 && !t ? "halted" : "executed");
      assert.equal(executed.after.halted, opcode === 0x4e72);
      assert.equal(executed.after.flags.t, opcode === 0x46fc || opcode === 0x4e72 || opcode === 0x4e73 ? Boolean(status & 0x8000) : t);
      if (!t) continue;
      const boundary = executed.after;
      const restored = new Cpu68000(ram, boundary);
      const trace = restored.step();
      assert.deepEqual(trace, { before: boundary, after: snapshot({ ...boundary, pc: 0xcd006000, ssp: unsignedLong(boundary.ssp - 6),
        halted: false, tracePending: false, flags: { ...boundary.flags, s: true, t: false } }),
        instruction: null, outcome: "executed", exception: { source: "trace", vector: 9, returnPc: boundary.pc }, accesses: [
          ...memoryAccesses("write", boundary.ssp - 2, wordBytes(boundary.pc % 65536)),
          ...memoryAccesses("write", boundary.ssp - 6, wordBytes(statusWord(boundary))),
          ...memoryAccesses("write", boundary.ssp - 4, wordBytes(Math.floor(boundary.pc / 65536))),
          ...memoryAccesses("read", 36, longBytes(0xcd006000)),
        ] });
      assert.deepEqual(cpu.snapshot(), boundary);
    }
  }
});

test("68000 trace follows completed instruction traps and is suppressed by illegal, privileged, or rejected attempts", () => {
  const ram = new ObservedRam(0x1000000);
  for (const [bytes, source, vector, completed, supervisor] of [
    [[0x4e, 0x43], "trap", 35, true, false], [[0x4e, 0x76], "overflow-trap", 7, true, false],
    [[0x80, 0xfc, 0, 0], "divide-by-zero", 5, true, false], [[0x41, 0xbc, 0, 0], "bounds-check", 6, true, false],
    [[0x4a, 0xfc], "illegal-instruction", 4, false, false], [[0x4e, 0x70], "privilege-violation", 8, false, false],
    [[0x4e, 0x74], "illegal-instruction", 4, false, false], [[0xa1, 0x23], "line-a", 10, false, false],
    [[0xff, 0xff], "line-f", 11, false, true],
    [[0x4e, 0x72], "privilege-violation", 8, false, false], [[0x4e, 0x73], "privilege-violation", 8, false, false],
  ] as const) {
    const before = initialState({ flags: { ...flags(127), s: supervisor, t: true } });
    bytes.forEach((b, i) => ram.write(physical(before.pc + i), b));
    longBytes(0xcd005000).forEach((b, i) => ram.write(vector * 4 + i, b));
    longBytes(0xef006000).forEach((b, i) => ram.write(36 + i, b));
    const cpu = new Cpu68000(ram, before);
    const entry = cpu.step();
    assert.equal(entry.exception?.source, source);
    assert.equal(entry.after.tracePending, completed);
    assert.equal(entry.after.flags.t, false);
    if (completed) {
      let acknowledgements = 0;
      const ignored = cpu.interrupt(7, () => { acknowledgements++; return "autovector"; });
      assert.deepEqual(ignored, { before: entry.after, after: entry.after, instruction: null, accesses: [], level: 7,
        outcome: "ignored", reason: "trace-pending" });
      assert.equal(acknowledgements, 0);
      const trace = cpu.step();
      assert.deepEqual(trace.exception, { source: "trace", vector: 9, returnPc: 0xcd005000 });
      assert.equal(trace.after.ssp, before.ssp - 12);
      assert.equal(trace.after.tracePending, false);
      assert.equal(ram.read(physical(before.ssp - 12)), 0x22); // Trace saves trap-handler SR, whose T is already clear.
    }
  }
  for (const [pc, bytes] of [[0xab001001, []], [0xab001000, [0x30, 0x10]]] as const) {
    const before = initialState({ pc, a0: 1, flags: { ...flags(127), t: true } });
    bytes.forEach((b, i) => ram.write(physical(pc + i), b));
    const record = new Cpu68000(ram, before).step();
    assert.equal(record.exception?.source, "address-error");
    assert.equal(record.after.tracePending, false);
    assert.equal(record.after.flags.t, false);
  }
});

test("68000 RESET invokes the live device connection, records it, and preserves CPU state", () => {
  const ram = new ObservedRam(0x1000000);
  ram.write(0x1000, 0x4e); ram.write(0x1001, 0x70);
  for (let bits = 0; bits < 128; bits++) {
    const before = initialState({ flags: { ...flags(bits), s: true, t: Boolean(bits & 32) } });
    let calls = 0;
    const connections = { value: 99, resetDevices() { this.value = 0; calls++; } };
    const cpu = new Cpu68000(ram, before, connections);
    ram.accesses.length = 0;
    assert.deepEqual(cpu.step(), { before: snapshot(before), after: snapshot({ ...before, ir: 0x4e70, pc: before.pc + 2, tracePending: before.flags.t }),
      instruction: { address: before.pc, bytes: [0x4e, 0x70] }, outcome: "executed",
      accesses: [...memoryAccesses("read", before.pc, [0x4e, 0x70]), { kind: "reset" }] });
    assert.equal(calls, 1); assert.equal(connections.value, 0);
    assert.deepEqual(ram.accesses, memoryAccesses("read", before.pc, [0x4e, 0x70]));
    cpu.reset(); // External reset initializes the CPU, without invoking the device-output connection.
    assert.equal(calls, 1);
    assert.equal(cpu.snapshot().tracePending, false);
  }
  const before = initialState();
  const absent = new Cpu68000(ram, before);
  assert.throws(() => absent.step(), /RESET requires a connected device reset callback/);
  assert.deepEqual(absent.snapshot(), snapshot({ ...before, ir: 0x4e70 }));
  let calls = 0, fail = true;
  const failure = new Error("device reset failed");
  const cpu = new Cpu68000(ram, before, { resetDevices: () => {
    calls++;
    assert.deepEqual(cpu.snapshot(), snapshot({ ...before, ir: 0x4e70 }));
    assert.throws(() => cpu.step(), /must not be reentrant/);
    assert.throws(() => cpu.reset(), /must not be reentrant/);
    assert.throws(() => cpu.interrupt(7, () => "autovector"), /must not be reentrant/);
    if (fail) throw failure;
  } });
  assert.throws(() => cpu.step(), error => error === failure);
  assert.deepEqual(cpu.snapshot(), snapshot({ ...before, ir: 0x4e70 }));
  fail = false;
  assert.equal(cpu.step().outcome, "executed");
  assert.equal(calls, 2);
});

test("68000 pending traces validate, survive snapshots, precede halted and odd PCs, and clear on reset", () => {
  const ram = new ObservedRam(0x1000000);
  const before = initialState({ tracePending: true, halted: true, pc: 0xffffffff, ssp: 0x9001 });
  for (const value of [undefined, 0, 1, "false", null]) {
    const state = { ...before }; Reflect.set(state, "tracePending", value);
    assert.throws(() => new Cpu68000(ram, state), TypeError);
  }
  const cpu = new Cpu68000(ram, before);
  const record = cpu.step();
  assert.equal(record.outcome, "halted");
  assert.equal(record.after.faulted, true);
  assert.equal(record.after.tracePending, false);
  assert.equal(record.instruction, null);
  assert.deepEqual(record.accesses, []);
  if (record.exception?.source !== "address-error") assert.fail();
  assert.equal(record.exception.fault.processingInstruction, false);
  const restored = new Cpu68000(ram, { ...cpu.snapshot(), ssp: 0x9000 });
  assert.equal(restored.step().outcome, "halted"); // Repairing SSP alone cannot release a terminal halt.
  assert.equal(restored.interrupt(7, () => { assert.fail("A double fault cannot acknowledge"); }).outcome, "ignored");
  const odd = new Cpu68000(ram, { ...before, tracePending: false });
  let called = false;
  assert.equal(odd.interrupt(7, () => { called = true; return "autovector"; }).outcome, "halted");
  assert.equal(called, false);
  assert.equal(odd.snapshot().faulted, true);
  assert.equal(cpu.reset().after.tracePending, false);
  assert.equal(cpu.snapshot().faulted, false);

});

test("68000 trace and interrupt RAM failures preserve completed transfers and clear reentrancy guards", () => {
  class FailingRam extends ObservedRam {
    callback = () => {};
    override read(a: number): number { this.callback(); return super.read(a); }
    override write(a: number, v: number): void { this.callback(); super.write(a, v); }
  }
  const ram = new FailingRam(0x1000000);
  for (const tracePending of [false, true]) for (let index = 0; index < 10; index++) {
    const before = initialState({ tracePending, halted: true, flags: { ...flags(31), t: true } });
    const cpu = new Cpu68000(ram, before);
    const failure = new Error("RAM failed");
    let calls = 0;
    ram.accesses.length = 0;
    ram.callback = () => {
      assert.throws(() => cpu.step(), /must not be reentrant/);
      assert.throws(() => cpu.reset(), /must not be reentrant/);
      assert.throws(() => cpu.interrupt(7, () => "autovector"), /must not be reentrant/);
      if (calls++ === index) throw failure;
    };
    assert.throws(() => tracePending ? cpu.step() : cpu.interrupt(4, () => "autovector"), error => error === failure);
    assert.equal(ram.accesses.length, index);
    assert.deepEqual(cpu.snapshot(), snapshot({ ...before, ssp: before.ssp - 6, halted: false, tracePending: false,
      interruptMask: tracePending ? before.interruptMask : 4, flags: { ...before.flags, s: true, t: false } }));
    ram.callback = () => {};
    assert.doesNotThrow(() => cpu.reset());
  }
});

test("68000 ignored interrupt snapshots are independently owned", () => {
  const ram = new Ram(0x1000000);
  const before = initialState({ interruptMask: 7 });
  const cpu = new Cpu68000(ram, before);
  const record = cpu.interrupt(1, () => { assert.fail("Masked request"); });
  assert.notStrictEqual(record.before, record.after);
  assert.notStrictEqual(record.before.flags, record.after.flags);
  Reflect.set(record.before.flags, "c", false);
  assert.equal(record.after.flags.c, true);
  Reflect.set(record.after, "tracePending", true);
  assert.deepEqual(cpu.snapshot(), snapshot(before));
  const saved = structuredClone(record);
  cpu.interrupt(7, () => "autovector");
  assert.deepEqual(record, saved);
});

// Address-error delivery: literal frame offsets and status bits from MC68000UM §§6.3.9–6.3.10.
test("68000 address-error frames identify user/supervisor data, program, and write accesses", () => {
  const ram = new ObservedRam(0x1000000);
  const cases = [
    { bytes: [], pc: 0xab001001, address: 0xab001001, operation: "fetch", code: 2, savedPc: 0xab001001 },
    { bytes: [0x30, 0x18], pc: 0xab001000, address: 0xcd002001, operation: "read", code: 1, savedPc: 0xab001002 }, // MOVE.W (A0)+,D0
    { bytes: [0x20, 0x3a, 0, 1], pc: 0xab001000, address: 0xab001003, operation: "read", code: 2, savedPc: 0xab001004 }, // MOVE.L (1,PC),D0
    { bytes: [0x4c, 0xfa, 0, 1, 0, 1], pc: 0xab001000, address: 0xab001005, operation: "read", code: 2, savedPc: 0xab001006 }, // MOVEM.L (1,PC),D0
    { bytes: [0x23, 0xc0, 0xff, 0xff, 0xff, 0xff], pc: 0xab001000, address: 0xffffffff, operation: "write", code: 1, savedPc: 0xab001006 },
    { bytes: [0x60, 1], pc: 0xfffffffe, address: 1, operation: "fetch", code: 2, savedPc: 0 },
  ] as const;
  for (const s of [false, true]) for (const item of cases) {
    const before = initialState({ pc: item.pc, ir: 0x4e71, a0: 0xcd002001, ssp: 0x12009000,
      flags: { ...flags(31), s, t: true } });
    item.bytes.forEach((b, i) => ram.write(physical(item.pc + i), b));
    longBytes(0xef006000).forEach((b, i) => ram.write(12 + i, b));
    ram.accesses.length = 0;
    const cpu = new Cpu68000(ram, before);
    const step = cpu.step();
    const ir = item.bytes.length ? item.bytes[0]! * 256 + item.bytes[1]! : 0x4e71;
    const code = item.code + (s ? 4 : 0);
    const ssw = (item.operation === "write" ? 0 : 16) + code;
    const frame = [...wordBytes(ssw), ...longBytes(item.address), ...wordBytes(ir), ...wordBytes(statusWord(before)), ...longBytes(item.savedPc)];
    assert.equal(step.outcome, "executed");
    assert.deepEqual(step.exception, { source: "address-error", vector: 3, returnPc: item.savedPc,
      fault: { operation: item.operation, address: item.address, instructionRegister: ir, functionCode: code, processingInstruction: true } });
    assert.deepEqual(step.after, snapshot({ ...before, ir, ssp: 0x12008ff2, pc: 0xef006000,
      flags: { ...before.flags, s: true, t: false } }));
    assert.deepEqual(step.instruction, item.bytes.length ? { address: item.pc, bytes: item.bytes } : null);
    const writes = [12, 10, 8, 6, 4, 2, 0].flatMap(offset => memoryAccesses("write", 0x8ff2 + offset, frame.slice(offset, offset + 2)));
    assert.deepEqual(step.accesses, [...memoryAccesses("read", item.pc, item.bytes), ...writes,
      ...memoryAccesses("read", 12, [0xef, 0, 0x60, 0])]);
    assert.deepEqual(ram.accesses, step.accesses);
    frame.forEach((b, i) => assert.equal(ram.read(0x8ff2 + i), b));
    assert.deepEqual(new Cpu68000(ram, step.after).snapshot(), step.after);
  }
});

test("68000 address-error frames wrap and can overwrite their own vector before it is read", () => {
  for (const ssp of [6, 0x1a]) {
    const ram = new ObservedRam(0x1000000);
    const before = initialState({ pc: 1, ir: 0x1234, ssp });
    longBytes(0xab002000).forEach((b, i) => ram.write(12 + i, b));
    const record = new Cpu68000(ram, before).step();
    const stack = unsignedLong(ssp - 14);
    const frame = [0, 0x16, 0, 0, 0, 1, 0x12, 0x34, 0x22, 0x1f, 0, 0, 0, 1];
    assert.equal(record.after.ssp, stack);
    assert.equal(record.after.pc, ssp === 6 ? 0xab002000 : 0x00160000);
    frame.forEach((b, i) => assert.equal(ram.read(physical(stack + i)), b));
    assert.deepEqual(record.accesses.slice(-4), memoryAccesses("read", 12, longBytes(record.after.pc)));
    assert.equal(record.accesses.length, 18);
  }
});

test("68000 faults on exception handler fetches retain completed entry and classify the processing phase", () => {
  const cases = [
    { opcode: 0x4e40, vector: 32, processing: true }, // Group-2 TRAP
    { opcode: 0x80fc, vector: 5, processing: true }, // Group-2 divide by zero
    { opcode: 0x4afa, vector: 4, processing: false },
    { opcode: 0xa123, vector: 10, processing: false },
    { opcode: 0xf123, vector: 11, processing: false },
  ];
  for (const item of cases) {
    const ram = new ObservedRam(0x1000000);
    const before = initialState({ flags: { ...flags(31), t: true } });
    [...wordBytes(item.opcode), 0, 0].forEach((b, i) => ram.write(physical(before.pc + i), b));
    longBytes(0xcd003001).forEach((b, i) => ram.write(item.vector * 4 + i, b));
    longBytes(0xef006000).forEach((b, i) => ram.write(12 + i, b));
    const record = new Cpu68000(ram, before).step();
    assert.equal(record.outcome, "executed");
    assert.deepEqual(record.exception, { source: "address-error", vector: 3, returnPc: item.vector * 4,
      fault: { operation: "fetch", address: 0xcd003001, instructionRegister: item.opcode,
        functionCode: 6, processingInstruction: item.processing } });
    assert.equal(record.after.ssp, before.ssp - 20);
    assert.equal(record.after.tracePending, false);
    assert.equal(ram.read(physical(before.ssp - 19)), item.processing ? 0x16 : 0x1e);
    assert.equal(record.after.pc, 0xef006000);
  }
  for (const trace of [false, true]) {
    const ram = new ObservedRam(0x1000000);
    const before = initialState({ ir: 0x4e71, tracePending: trace });
    const vector = trace ? 9 : 31;
    longBytes(0xcd003001).forEach((b, i) => ram.write(vector * 4 + i, b));
    longBytes(0xef006000).forEach((b, i) => ram.write(12 + i, b));
    const cpu = new Cpu68000(ram, before);
    const record = trace ? cpu.step() : cpu.interrupt(7, () => "autovector");
    assert.equal(record.outcome, "executed");
    assert.deepEqual(record.exception, { source: "address-error", vector: 3, returnPc: vector * 4,
      fault: { operation: "fetch", address: 0xcd003001, instructionRegister: 0x4e71, functionCode: 6, processingInstruction: false } });
    assert.equal(record.after.ssp, before.ssp - 20);
    assert.equal(record.after.interruptMask, trace ? 2 : 7);
    assert.equal(record.instruction, null);
  }
});

test("68000 terminal address errors survive snapshots and level 7 until a successful external reset", () => {
  for (const oddStack of [false, true]) {
    const ram = new ObservedRam(0x1000000);
    const before = initialState({ pc: 1, ir: 0x9876, ssp: oddStack ? 0x9001 : 0x9000 });
    longBytes(0xab002001).forEach((b, i) => ram.write(12 + i, b));
    let cpu = new Cpu68000(ram, before);
    const record = cpu.step();
    assert.equal(record.outcome, "halted");
    assert.equal(record.after.faulted, true);
    if (record.exception?.source !== "address-error") assert.fail();
    assert.deepEqual(record.exception.entryFault, oddStack ? { operation: "write", address: 0x8fff } : { operation: "fetch", address: 0xab002001 });
    assert.equal(record.accesses.length, oddStack ? 0 : 18);
    const saved = structuredClone(record);
    cpu = new Cpu68000(ram, record.after);
    assert.deepEqual(cpu.step(), { before: record.after, after: record.after, accesses: [], instruction: null, outcome: "halted" });
    assert.deepEqual(cpu.interrupt(7, () => { assert.fail("Terminal halt must not acknowledge"); }), {
      before: record.after, after: record.after, instruction: null, accesses: [], level: 7, outcome: "ignored", reason: "faulted" });
    [...longBytes(0x12349000), ...longBytes(0xab001001)].forEach((b, i) => ram.write(i, b));
    assert.equal(cpu.reset().after.faulted, true);
    ram.write(7, 0);
    assert.equal(cpu.reset().after.faulted, false);
    assert.equal(cpu.snapshot().ir, 0x9876);
    ram.write(0x1000, 0x4e); ram.write(0x1001, 0x71);
    assert.equal(cpu.step().outcome, "executed");
    assert.equal(cpu.snapshot().ir, 0x4e71);
    assert.deepEqual(record, saved);
  }
});

test("68000 IR and terminal-halt fields validate and fully fetched opwords survive host failures", () => {
  const ram = new ObservedRam(0x1000000);
  for (const ir of [-1, 65536, 0.5, NaN, undefined]) {
    const state = initialState(); Reflect.set(state, "ir", ir);
    assert.throws(() => new Cpu68000(ram, state), RangeError);
  }
  for (const faulted of [undefined, 0, "false", null]) {
    const state = initialState(); Reflect.set(state, "faulted", faulted);
    assert.throws(() => new Cpu68000(ram, state), TypeError);
  }
  class FailingRam extends ObservedRam {
    stop = -1;
    calls = 0;
    override read(address: number): number {
      if (this.calls++ === this.stop) throw new Error("Host read failed");
      return super.read(address);
    }
    override write(address: number, value: number): void {
      if (this.calls++ === this.stop) throw new Error("Host write failed");
      super.write(address, value);
    }
  }
  for (let stop = 0; stop < 20; stop++) {
    const memory = new FailingRam(0x1000000);
    const before = initialState({ ir: 0x4e71, a0: 1, flags: { ...flags(31), t: true } });
    memory.write(0x1000, 0x30); memory.write(0x1001, 0x10); // MOVE.W (A0),D0
    longBytes(0xcd006000).forEach((b, i) => memory.write(12 + i, b));
    const cpu = new Cpu68000(memory, before);
    memory.calls = 0; memory.stop = stop; memory.accesses.length = 0;
    assert.throws(() => cpu.step(), /Host (read|write) failed/);
    const entered = stop >= 2;
    assert.deepEqual(cpu.snapshot(), snapshot({ ...before, ir: entered ? 0x3010 : before.ir,
      ssp: before.ssp - (entered ? 14 : 0), flags: entered ? { ...before.flags, s: true, t: false } : before.flags }));
    const frame = [0, 0x11, 0, 0, 0, 1, 0x30, 0x10, 0x82, 0x1f, 0xab, 0, 0x10, 2];
    const expected = [...memoryAccesses("read", before.pc, [0x30, 0x10]),
      ...[12, 10, 8, 6, 4, 2, 0].flatMap(offset => memoryAccesses("write", before.ssp - 14 + offset, frame.slice(offset, offset + 2))),
      ...memoryAccesses("read", 12, [0xcd, 0, 0x60, 0])];
    assert.deepEqual(memory.accesses, expected.slice(0, stop));
    memory.stop = -1;
    assert.doesNotThrow(() => cpu.reset());
  }
});
