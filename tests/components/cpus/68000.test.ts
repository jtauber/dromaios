import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu68000 } from "../../../src/components/cpus/68000.js";
import type { Cpu68000Flags, Cpu68000State, Cpu68000Snapshot, Cpu68000MemoryAccess } from "../../../src/components/cpus/68000.js";
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

function flags(bits: number): Cpu68000Flags {
  return { x: Boolean(bits & 1), n: Boolean(bits & 2), z: Boolean(bits & 4), v: Boolean(bits & 8),
    c: Boolean(bits & 16), t: Boolean(bits & 32), s: Boolean(bits & 64) };
}

function initialState(overrides: Partial<Cpu68000State> = {}): Cpu68000State {
  return { d0: 0x11223344, d1: 0x55667788, d2: 0x99aabbcc, d3: 0xddeeff00,
    d4: 0x01234567, d5: 0x89abcdef, d6: 0xfedcba98, d7: 0x76543210,
    a0: 0x10000000, a1: 0x20000000, a2: 0x30000000, a3: 0x40000000,
    a4: 0x50000000, a5: 0x60000000, a6: 0x70000000, usp: 0x34ffe000, ssp: 0x56ffd000,
    pc: 0xab001000, interruptMask: 2, flags: flags(127), ...overrides };
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
  assert.deepEqual(cpu.step(), { before: snapshot(before), after: snapshot(after),
    instruction: { address: before.pc, bytes }, outcome: "executed", accesses });
  assert.deepEqual(cpu.snapshot(), snapshot(after));
  assert.deepEqual(ram.accesses, accesses);
  for (const { address, value } of writes) assert.equal(ram.read(address), value);
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
  assert.equal(calls.size, 27);
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

test("68000 rejects every unsupported operation word after exactly two reads without changing state", () => {
  const ram = new ObservedRam(0x1000000);
  const before = snapshot(initialState());
  const cpu = new Cpu68000(ram, before);
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
  assert.equal(supported.size, 16899); // Includes embedded MOVEQ/branch operands, unlike coverage forms.
  for (let opcode = 0; opcode < 65536; opcode++) {
    if (supported.has(opcode)) continue;
    const bytes = [Math.floor(opcode / 256), opcode % 256];
    ram.write(0x1000, bytes[0]!);
    ram.write(0x1001, bytes[1]!);
    ram.accesses.length = 0;
    const accesses = bytes.map((value, offset) => ({ kind: "read", address: 0x1000 + offset, value }));
    assert.deepEqual(cpu.step(), { before, after: before, instruction: { address: before.pc, bytes },
      accesses, outcome: "unsupported", reason: "opcode" });
    assert.deepEqual(ram.accesses, accesses);
  }
});

test("68000 rejects odd instruction addresses before reading and odd store addresses before writing or changing flags", () => {
  const ram = new ObservedRam(0x1000000);
  for (const address of [1, 0x1001, 0x12ffffff, 0xffffffff]) {
    const before = snapshot(initialState({ pc: address }));
    const cpu = new Cpu68000(ram, before);
    ram.accesses.length = 0;
    for (let attempt = 0; attempt < 2; attempt++) {
      assert.deepEqual(cpu.step(), { before, after: before, instruction: null, accesses: [],
        outcome: "unsupported", reason: "unaligned-address", fault: { operation: "fetch", address } });
    }
    assert.deepEqual(ram.accesses, []);
    const storeBefore = snapshot(initialState());
    const bytes = [0x23, 0xc0, ...longBytes(address)];
    const accesses = bytes.map((value, offset) => ({ kind: "read", address: 0x1000 + offset, value }));
    for (const { address, value } of accesses) ram.write(address, value);
    const storeCpu = new Cpu68000(ram, storeBefore);
    for (let attempt = 0; attempt < 2; attempt++) {
      ram.accesses.length = 0;
      assert.deepEqual(storeCpu.step(), { before: storeBefore, after: storeBefore, accesses,
        instruction: { address: storeBefore.pc, bytes }, outcome: "unsupported", reason: "unaligned-address",
        fault: { operation: "write", address } });
      assert.deepEqual(ram.accesses, accesses);
    }
  }
});

test("68000 every register store rejects odd addresses atomically and writes current values across the bus boundary", () => {
  const ram = new ObservedRam(0x1000000);
  for (const { register, store } of registerForms) {
    const state = initialState();
    const bytes = [...wordBytes(store), 0xff, 0xff, 0xff, 0xff];
    bytes.forEach((value, offset) => ram.write(0x1000 + offset, value));
    ram.accesses.length = 0;
    const cpu = new Cpu68000(ram, state);
    const accesses = bytes.map((value, offset) => ({ kind: "read", address: 0x1000 + offset, value }));
    const rejected = cpu.step();
    assert.deepEqual(rejected, { outcome: "unsupported", reason: "unaligned-address", before: snapshot(state), after: snapshot(state),
      instruction: { address: state.pc, bytes }, accesses, fault: { operation: "write", address: 0xffffffff } });
    assert.deepEqual(ram.accesses, accesses);
    const saved = structuredClone(rejected);
    const writes = longBytes(state[register]).map((value, offset) => ({ kind: "write" as const,
      address: (0xfffffe + offset) % 16777216, value }));
    checkStep(ram, state, [...wordBytes(store), 0xff, 0xff, 0xff, 0xfe],
      { ...state, pc: 0xab001006, flags: moveFlags(state.flags, state[register]) }, writes, cpu);
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
  assert.deepEqual(record, { before: snapshot(stored), after: snapshot({ ...stored, d3: 0, pc: 0xab001012 }),
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
      const after = snapshot({ ...state, ssp, pc, interruptMask: 7, flags: { ...state.flags, t: false, s: true } });
      const record = cpu.reset();
      assert.deepEqual(record, { before: snapshot(state), after, accesses });
      assert.deepEqual(ram.accesses, accesses);
      assert.deepEqual(cpu.snapshot(), after);
      if (pc % 2) assert.equal(cpu.step().outcome, "unsupported");
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
  assert.deepEqual(final.flags, { x: false, n: true, z: false, v: false, c: false, t: true, s: true });
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

test("68000 read and write alignment rejection preserves both pending address updates and all RAM", () => {
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
    const cpu = new Cpu68000(ram, state);
    const before = snapshot(state);
    const accesses = [
      ...bytes.map((value, offset) => ({ kind: "read" as const, address: 0x1000 + offset, value })),
      ...[0x81, 0x23, 0x45, 0x67].slice(0, item.reads).map((value, offset) => ({ kind: "read" as const, address: 0x20000 + offset, value })),
    ];
    for (let repeat = 0; repeat < 2; repeat++) {
      ram.accesses.length = 0;
      assert.deepEqual(cpu.step(), { before, after: before, instruction: { address: state.pc, bytes }, accesses,
        outcome: "unsupported", reason: "unaligned-address", fault: { operation: item.operation, address: item.address } });
      assert.deepEqual(ram.accesses, accesses);
      assert.equal(ram.read(0x30000), 0xaa);
    }
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
        const cpu = new Cpu68000(ram, state);
        const before = snapshot(state);
        const accesses = bytes.map((value, offset) => ({ kind: "read", address: 0x1000 + offset, value }));
        assert.deepEqual(cpu.step(), { before, after: before, instruction: { address: state.pc, bytes }, accesses,
          outcome: "unsupported", reason: "unaligned-address", fault: { operation, address } });
        assert.deepEqual(ram.accesses, accesses);
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

test("68000 immediate ALU rejects every odd word/long memory mode without operand reads, writes, flags, or auto-updates", () => {
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
        const accesses = bytes.map((value, offset) => ({ kind: "read", address: 0x1000 + offset, value }));
        for (const { address, value } of accesses) ram.write(address, value);
        const cpu = new Cpu68000(ram, state);
        const before = snapshot(state);
        for (let attempt = 0; attempt < 2; attempt++) {
          ram.accesses.length = 0;
          assert.deepEqual(cpu.step(), { before, after: before, instruction: { address: state.pc, bytes }, accesses,
            outcome: "unsupported", reason: "unaligned-address", fault: { operation: "read", address: destination.address } });
          assert.deepEqual(ram.accesses, accesses);
        }
      }
    }
  }
});

test("68000 immediate alignment rejection can be retried with changed RAM and retains detached fault records", () => {
  const ram = new ObservedRam(0x1000000);
  const state = transferState(127);
  const cpu = new Cpu68000(ram, state);
  [0x04, 0x79, 0, 1, 0xff, 0xff, 0xff, 0xff].forEach((value, offset) => ram.write(0x1000 + offset, value));
  const rejected = cpu.step();
  assert.equal(rejected.outcome, "unsupported");
  const saved = structuredClone(rejected);
  ram.write(0x1007, 0xfe);
  ram.write(0x1003, 2);
  ram.write(0xfffffe, 0);
  ram.write(0xffffff, 1);
  const record = cpu.step();
  assert.equal(record.outcome, "executed");
  assert.deepEqual(record.after, snapshot({ ...state, pc: state.pc + 8,
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

function checkControlRejection(ram: ObservedRam, before: Cpu68000State, bytes: readonly number[],
  operation: "fetch" | "read" | "write", address: number, data: readonly Cpu68000MemoryAccess[] = []): void {
  const fetches = bytes.map((value, offset) => ({ kind: "read" as const, address: physical(before.pc + offset), value }));
  for (const { address, value } of fetches) ram.write(address, value);
  ram.accesses.length = 0;
  const cpu = new Cpu68000(ram, before);
  assert.deepEqual(cpu.step(), { before: snapshot(before), after: snapshot(before), outcome: "unsupported",
    reason: "unaligned-address", instruction: { address: before.pc, bytes }, fault: { operation, address },
    accesses: [...fetches, ...data] });
  assert.deepEqual(cpu.snapshot(), snapshot(before));
  assert.deepEqual(ram.accesses, [...fetches, ...data]);
}

function checkBranch(ram: ObservedRam, before: Cpu68000State, branch: number, byte: number, word: number, take: boolean): void {
  const bytes = [...wordBytes(branch + byte), ...(byte === 0 ? wordBytes(word) : [])];
  const displacement = byte === 0 ? (word < 32768 ? word : word - 65536) : (byte < 128 ? byte : byte - 256);
  const target = unsignedLong(before.pc + 2 + displacement);
  const returnAddress = unsignedLong(before.pc + bytes.length);
  const after = { ...before, flags: { ...before.flags }, pc: take ? target : returnAddress };
  if (take && target % 2 !== 0) {
    checkControlRejection(ram, before, bytes, "fetch", target);
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
    checkControlRejection(ram, before, bytes, "fetch", target);
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
    if (target % 2) checkControlRejection(ram, before, [0x4e, 0x75], "fetch", target, reads);
    else checkStep(ram, before, [0x4e, 0x75], { ...before, pc: target, [stack]: unsignedLong(before[stack] + 4) }, reads);
  }
});

test("68000 odd stack addresses reject calls before writes and returns before reads, preserving all state", () => {
  const ram = new ObservedRam(0x1000000);
  for (const s of [false, true]) for (const address of [1, 3, 0x12ffffff, 0xffffffff]) {
    const stack = s ? "ssp" : "usp";
    const before = initialState({ [stack]: address, flags: { ...flags(127), s } });
    for (const bytes of [[0x61, 2], [0x61, 0, 0x80, 0], [0x61, 1]]) {
      // Stack alignment takes priority when both the stack and taken target are odd.
      checkControlRejection(ram, before, bytes, "write", unsignedLong(address - 4));
    }
    checkControlRejection(ram, before, [0x4e, 0x75], "read", address);
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

test("68000 retries rejected control transfers using current RAM, retaining detached fault records", () => {
  const ram = new ObservedRam(0x1000000);
  for (const kind of ["call", "counter", "return"] as const) {
    const before = initialState({ d0: 0xabcd0002, flags: flags(0) });
    const cpu = new Cpu68000(ram, before);
    const bytes = kind === "call" ? [0x61, 0, 0, 1] : kind === "counter" ? [0x51, 0xc8, 0, 1] : [0x4e, 0x75];
    bytes.forEach((value, offset) => ram.write(0x1000 + offset, value));
    longBytes(0xab001001).forEach((value, offset) => ram.write(physical(before.usp + offset), value));
    const fault = cpu.step();
    assert.equal(fault.outcome, "unsupported");
    const saved = structuredClone(fault);
    assert.deepEqual(cpu.step(), fault);
    ram.write(kind === "return" ? physical(before.usp + 3) : 0x1003, kind === "return" ? 4 : 2);
    const executed = cpu.step();
    assert.equal(executed.outcome, "executed");
    assert.equal(executed.after.pc, 0xab001004);
    assert.equal(executed.after.d0, kind === "counter" ? 0xabcd0001 : before.d0);
    assert.equal(executed.after.usp, before.usp + (kind === "return" ? 4 : kind === "call" ? -4 : 0));
    assert.deepEqual(executed.after.flags, before.flags);
    assert.deepEqual(fault, saved);
    Reflect.set(fault.after.flags, "x", true);
    assert.deepEqual(cpu.snapshot().flags, before.flags);
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
