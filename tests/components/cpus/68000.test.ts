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
  assert.equal(supported.size, 2136); // 88 long forms plus 8 × 256 embedded MOVEQ operands.
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
