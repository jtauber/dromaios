import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu6800 } from "../../../src/components/cpus/6800.js";
import type { Cpu6800Flags, Cpu6800State } from "../../../src/components/cpus/6800.js";
import { Ram } from "../../../src/components/memory/ram.js";
import { ObservedRam } from "../../helpers/observed-ram.js";

function initialState(overrides: Partial<Cpu6800State> = {}): Cpu6800State {
  return { a: 0x81, b: 0x22, x: 0x3456, sp: 0x789a, pc: 0x2000,
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
function addition(a: number, operand: number, i: boolean) {
  const total = a + operand;
  const result = total % 256;
  const signedTotal = (a < 128 ? a : a - 256) + (operand < 128 ? operand : operand - 256);
  return { a: result, flags: { h: a % 16 + operand % 16 >= 16, i,
    n: result >= 128, z: result === 0, v: signedTotal < -128 || signedTotal > 127, c: total >= 256 } };
}

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
  assert.equal(calls.size, 12);
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

test("6800 LDAA immediate checks all bytes and incoming flags, preserving H/I/C across wrapped fetches", () => {
  const ram = new ObservedRam();
  ram.write(0xffff, 0x86);
  for (let bits = 0; bits < 64; bits++) {
    for (let value = 0; value < 256; value++) {
      ram.write(0, value);
      ram.accesses.length = 0;
      const before = initialState({ pc: 0xffff, flags: flags(bits) });
      const after = { ...before, a: value, pc: 1, flags: loadStoreFlags(value, before.flags) };
      const accesses = [{ kind: "read", address: 0xffff, value: 0x86 }, { kind: "read", address: 0, value }];
      const cpu = new Cpu6800(ram, before);
      assert.deepEqual(cpu.step(), { before, after, instruction: { address: 0xffff, bytes: [0x86, value] },
        outcome: "executed", accesses });
      assert.deepEqual(cpu.snapshot(), after);
      assert.deepEqual(ram.accesses, accesses);
    }
  }
});

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

test("6800 rejects every other opcode atomically, including other modes, B forms, WAI, and interrupt controls", () => {
  const supported = new Set([0x86, 0x8b, 0xb7]);
  const ram = new ObservedRam();
  for (let opcode = 0; opcode < 256; opcode++) {
    if (supported.has(opcode)) continue;
    for (const pc of [0, 0x2000, 0xffff]) {
      ram.write(pc, opcode);
      ram.write((pc + 1) % 0x10000, 0xa5);
      const before = initialState({ pc, flags: flags(opcode % 64) });
      const cpu = new Cpu6800(ram, before);
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
