import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu8088 } from "../../../../src/components/cpus/generated/8088-cpu.js";
import type { Cpu8088Flags } from "../../../../src/components/cpus/generated/8088-cpu.js";
import { Ram } from "../../../../src/components/memory/ram.js";
import { ObservedRam } from "../../../helpers/observed-ram.js";
import { runCpu } from "../../../../src/runtime/run-cpu.js";
import { initialState, flags, snapshot, checkStep, segments, address, put, wordBytes, dataReads, dataWrites } from "./helpers.js";

test("8088 construction and inspection detach stored state, byte views, and physical PC without RAM access", () => {
  const ram = new ObservedRam(0x100000);
  const state = initialState();
  const expected = snapshot(state);
  const cpu = new Cpu8088(ram, state);
  const first = cpu.snapshot();
  const second = cpu.snapshot();
  const restored = new Cpu8088(ram, first);
  state.ax = 0;
  state.cs = 0;
  state.flags.cf = false;
  Reflect.set(first, "al", 0);
  Reflect.set(first, "pc", 0);
  Reflect.set(first.flags, "if", false);
  assert.deepEqual(second, expected);
  assert.deepEqual(cpu.snapshot(), expected);
  assert.deepEqual(restored.snapshot(), expected);
  assert.deepEqual(ram.accesses, []);
});

test("8088 copies each declared getter once and ignores extra metadata and contradictory derived views", () => {
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
    for (const name of ["metadata", "al", "ah", "pc"]) {
      Object.defineProperty(object, name, { get: () => { throw new Error(`Unexpected ${label}.${name}`); } });
    }
  }
  assert.deepEqual(new Cpu8088(new Ram(0x100000), state).snapshot(), expected);
  assert.equal(calls.size, 28);
  assert.ok([...calls.values()].every(count => count === 1));
});

test("8088 requires thirteen word registers, nine Boolean flags, and exactly 1 MiB RAM", () => {
  const ram = new ObservedRam(0x100000);
  for (const name of ["ax", "bx", "cx", "dx", "sp", "bp", "si", "di", "cs", "ds", "ss", "es", "ip"] as const) {
    for (const value of [0, 65535]) assert.equal(new Cpu8088(ram, initialState({ [name]: value })).snapshot()[name], value);
    for (const value of [-1, 65536, 0.5, NaN, Infinity, "00", undefined]) {
      const state = initialState();
      Reflect.set(state, name, value);
      assert.throws(() => new Cpu8088(ram, state), RangeError);
    }
  }
  for (const name of ["cf", "pf", "af", "zf", "sf", "tf", "if", "df", "of"]) {
    for (const value of [0, 1, "false", undefined]) {
      const state = initialState();
      Reflect.set(state.flags, name, value);
      assert.throws(() => new Cpu8088(ram, state), TypeError);
    }
  }
  for (const size of [1, 0x10000, 0xfffff, 0x100001]) {
    assert.throws(() => new Cpu8088(new Ram(size), initialState()), /exactly 1 MiB/);
  }
  assert.deepEqual(ram.accesses, []);
});

test("8088 derives both byte halves for every word value and masks every code segment to twenty address bits", () => {
  const ram = new Ram(0x100000);
  for (let value = 0; value < 65536; value++) {
    const state = initialState({ ax: value, bx: 65535 - value, cx: value, dx: 65535 - value, cs: value, ip: 0xffff });
    assert.deepEqual(new Cpu8088(ram, state).snapshot(), snapshot(state));
  }
  for (const [cs, ip, pc] of [[0x1000, 0x2345, 0x12345], [0x1234, 5, 0x12345],
    [0xffff, 0xf, 0xfffff], [0xffff, 0x10, 0], [0xffff, 0xffff, 0x0ffef]] as const) {
    assert.equal(new Cpu8088(ram, initialState({ cs, ip })).snapshot().pc, pc);
  }
});

test("8088 reset sets FFFF:0000 and clears segments and all flags without reading a vector or clearing RAM", () => {
  const ram = new ObservedRam(0x100000);
  [0xb8, 0xcd, 0xab].forEach((byte, offset) => ram.write(0xffff0 + offset, byte));
  for (let bits = 0; bits < 512; bits++) {
    const state = initialState({ flags: flags(bits) });
    const cpu = new Cpu8088(ram, state);
    const before = snapshot(state);
    const after = snapshot({ ...state, cs: 0xffff, ip: 0, ds: 0, ss: 0, es: 0, flags: flags(0) });
    ram.accesses.length = 0;
    const reset = cpu.reset();
    assert.deepEqual(reset, { before, after, accesses: [] });
    assert.deepEqual(cpu.reset(), { before: after, after, accesses: [] });
    assert.deepEqual(ram.accesses, []);
    const loaded = cpu.step();
    assert.equal(loaded.after.ax, 0xabcd);
    assert.equal(loaded.after.ip, 3);
    assert.equal(loaded.after.pc, 0xffff3);
    assert.deepEqual(reset.after, after);
  }
});

test("8088 stores can overwrite future instructions and saved records remain detached across edits and reset", () => {
  const ram = new ObservedRam(0x100000);
  [0xa3, 3, 1, 0, 0, 0xa5].forEach((byte, offset) => ram.write(0x12440 + offset, byte));
  const state = initialState({ ax: 0xb8, ds: 0x1234 });
  const cpu = new Cpu8088(ram, state);
  const store = cpu.step();
  const savedStore = structuredClone(store);
  assert.deepEqual(store.accesses.slice(3), [{ kind: "write", address: 0x12443, value: 0xb8 },
    { kind: "write", address: 0x12444, value: 0 }]);
  ram.write(0x12444, 0x5a);
  const load = cpu.step();
  assert.deepEqual(load.instruction, { address: 0x12443, bytes: [0xb8, 0x5a, 0xa5] });
  assert.equal(load.after.ax, 0xa55a);
  assert.equal(load.after.ah, 0xa5);
  assert.equal(load.after.al, 0x5a);
  cpu.reset();
  assert.deepEqual(store, savedStore);
  Reflect.set(store.after.flags, "cf", false);
  Reflect.set(load.after, "ah", 0);
  assert.equal(load.before.flags.cf, true);
  assert.equal(cpu.snapshot().ah, 0xa5);
});

test("8088 completion halt is stored, validated, detached, resumable, and cleared by reset", () => {
  const ram = new ObservedRam(0x100000), before = initialState({ ip: 0xffff });
  put(ram, before.cs, before.ip, [0xf4]);
  const cpu = new Cpu8088(ram, before);
  const after = snapshot({ ...before, ip: 0, halted: true });
  ram.accesses.length = 0;
  assert.deepEqual(runCpu(cpu, { maxSteps: 10 }), { stopReason: "halted", records: [{
    before: snapshot(before), after, outcome: "halted", instruction: { address: snapshot(before).pc, bytes: [0xf4] },
    accesses: dataReads(before.cs, before.ip, [0xf4]),
  }] });
  for (const stopped of [cpu, new Cpu8088(ram, after)]) {
    ram.accesses.length = 0;
    assert.deepEqual(stopped.step(), { before: after, after, instruction: null, outcome: "halted", accesses: [] });
    assert.deepEqual(ram.accesses, []);
    assert.equal(stopped.reset().after.halted, false);
  }
  for (const value of [0, 1, undefined, "false", null]) {
    const state = initialState(); Reflect.set(state, "halted", value);
    assert.throws(() => new Cpu8088(ram, state), TypeError);
  }
});

test("8088 completion flag transfers define reserved bits and preserve unselected flags", () => {
  const ram = new ObservedRam(0x100000);
  const positions = { cf: 0, pf: 2, af: 4, zf: 6, sf: 7, tf: 8, if: 9, df: 10, of: 11 } as const;
  for (let bits = 0; bits < 512; bits++) {
    const before = initialState({ flags: flags(bits), ss: 0xffff, sp: 1 });
    const packed = 0xf002 + Object.entries(positions).reduce((n, [flag, bit]) => n + (before.flags[flag as keyof Cpu8088Flags] ? 2 ** bit : 0), 0);
    checkStep(ram, before, [0x9c], { ...before, sp: 0xffff, ip: 0x101 }, undefined, dataWrites(before.ss, 0xffff, wordBytes(packed)));
    checkStep(ram, before, [0x9f], { ...before, ax: (packed % 256) * 256 + 0x22, ip: 0x101 });
    for (const [opcode, flag, value] of [[0xf5, "cf", !before.flags.cf], [0xf8, "cf", false], [0xf9, "cf", true],
      [0xfc, "df", false], [0xfd, "df", true]] as const) {
      checkStep(ram, before, [opcode], { ...before, ip: 0x101, flags: { ...before.flags, [flag]: value } });
    }
  }
  for (let packed = 0; packed < 65536; packed++) {
    const before = initialState();
    const decoded = Object.fromEntries(Object.entries(positions).map(([flag, bit]) => [flag, Math.floor(packed / 2 ** bit) % 2 === 1])) as Cpu8088Flags;
    put(ram, before.ss, before.sp, wordBytes(packed));
    checkStep(ram, before, [0x9d], { ...before, flags: decoded, sp: before.sp + 2, ip: 0x101 }, undefined,
      dataReads(before.ss, before.sp, wordBytes(packed)));
  }
  for (let ah = 0; ah < 256; ah++) for (const bits of [0, 511]) {
    const before = initialState({ ax: ah * 256 + 0x55, flags: flags(bits) });
    const selected = { cf: ah % 2 === 1, pf: Math.floor(ah / 4) % 2 === 1, af: Math.floor(ah / 16) % 2 === 1,
      zf: Math.floor(ah / 64) % 2 === 1, sf: ah >= 128 };
    checkStep(ram, before, [0x9e], { ...before, ip: 0x101, flags: { ...before.flags, ...selected } });
  }
});
