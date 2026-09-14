import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu68000 } from "../../../src/components/cpus/68000.js";
import type { Cpu68000Flags, Cpu68000State, Cpu68000Snapshot, Cpu68000MemoryAccess } from "../../../src/components/cpus/68000.js";
import { Ram } from "../../../src/components/memory/ram.js";
import { ObservedRam } from "../../helpers/observed-ram.js";

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
function addition(before: Cpu68000State, operand: number): Cpu68000State {
  const total = BigInt(before.d0) + BigInt(operand);
  const result = Number(total % 4294967296n);
  const signedTotal = BigInt.asIntN(32, BigInt(before.d0)) + BigInt.asIntN(32, BigInt(operand));
  return { ...before, d0: result, pc: (before.pc + 6) % 4294967296,
    flags: { ...before.flags, x: total >= 4294967296n, c: total >= 4294967296n, n: result >= 2147483648,
      z: result === 0, v: signedTotal < -2147483648n || signedTotal > 2147483647n } };
}

function checkStep(ram: ObservedRam, before: Cpu68000State, bytes: readonly number[], after: Cpu68000State,
  writes: readonly Cpu68000MemoryAccess[] = []): void {
  const reads = bytes.map((value, offset) => ({ kind: "read" as const, address: (before.pc + offset) % 16777216, value }));
  for (const { address, value } of reads) ram.write(address, value);
  ram.accesses.length = 0;
  const cpu = new Cpu68000(ram, before);
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

test("68000 long loads and stores use all 32 bits, set NZ, clear VC, and preserve X and control state", () => {
  const ram = new ObservedRam(0x1000000);
  for (let bits = 0; bits < 128; bits++) {
    for (const value of [0, 1, 0xffff, 0x10000, 0x7fffffff, 0x80000000, 0xff00ff00, 0xffffffff]) {
      const before = initialState({ d0: value, flags: flags(bits), interruptMask: bits % 8 });
      const after = { ...before, pc: 0xab001006, flags: moveFlags(before.flags, value) };
      checkStep(ram, { ...before, d0: 0x12345678 }, [0x20, 0x3c, ...longBytes(value)], after);
      checkStep(ram, before, [0x23, 0xc0, 0xcd, 2, 0, 0x82], after,
        longBytes(value).map((byte, offset) => ({ kind: "write", address: 0x20082 + offset, value: byte })));
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

test("68000 ADDI.L sweeps every low word across positive, negative, and unsigned carry boundaries", () => {
  const ram = new ObservedRam(0x1000000);
  for (const high of [0, 0x7fff0000, 0xffff0000]) {
    for (let low = 0; low < 65536; low++) {
      const before = initialState({ d0: high + low });
      checkStep(ram, before, [6, 0x80, 0, 1, 0, 1], addition(before, 0x10001));
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
  for (let opcode = 0; opcode < 65536; opcode++) {
    if ([0x203c, 0x0680, 0x23c0].includes(opcode)) continue;
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
