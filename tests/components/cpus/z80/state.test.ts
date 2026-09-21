import assert from "node:assert/strict";
import { test } from "node:test";
import { CpuZ80 } from "../../../../src/components/cpus/generated/z80-cpu.js";
import { Ram } from "../../../../src/components/memory/ram.js";
import { ObservedRam } from "../../../helpers/observed-ram.js";
import { initialState, bankSnapshot, snapshot, transferRows, aluForms } from "./helpers.js";

test("Z80 owns both banks, flags, and snapshots without reset or memory access", () => {
  const ram = new ObservedRam();
  const supplied = initialState();
  const cpu = new CpuZ80(ram, supplied);
  const first = cpu.snapshot();
  const second = cpu.snapshot();
  const restored = new CpuZ80(ram, first);
  supplied.b = 0;
  supplied.flags.s = false;
  supplied.alternate.h = 0;
  supplied.alternate.flags.pv = false;
  // Deliberately bypass readonly typing to verify isolation for JavaScript callers.
  Reflect.set(first, "bc", 0);
  Reflect.set(first.flags, "h", false);
  Reflect.set(first.alternate, "a", 0);
  Reflect.set(first.alternate.flags, "z", false);
  assert.deepEqual(second, snapshot(initialState()));
  assert.deepEqual(cpu.snapshot(), second);
  assert.deepEqual(restored.snapshot(), second);
  assert.deepEqual(ram.accesses, []);
});

test("Z80 reads declared getters once, including nested non-enumerable fields, and ignores metadata", () => {
  const supplied = initialState();
  const expected = snapshot(supplied);
  const calls = new Map<string, number>();
  for (const [label, object] of [["state", supplied], ["flags", supplied.flags],
    ["alternate", supplied.alternate], ["alternate.flags", supplied.alternate.flags]] as const) {
    for (const [name, value] of Object.entries(object)) {
      const key = `${label}.${name}`;
      Object.defineProperty(object, name, { enumerable: false, get: () => {
        calls.set(key, (calls.get(key) ?? 0) + 1);
        return value;
      } });
    }
    for (const name of ["metadata", "bc", "de", "hl"]) {
      Object.defineProperty(object, name, { get: () => { throw new Error(`Unexpected ${label}.${name} read`); } });
    }
  }
  const cpu = new CpuZ80(new Ram(0x10000), supplied);
  assert.deepEqual(cpu.snapshot(), expected);
  assert.equal(calls.size, 41);
  assert.ok([...calls.values()].every(count => count === 1));
});

test("Z80 separates initially shared banks and flags", () => {
  const supplied = initialState();
  supplied.alternate = supplied;
  const ram = new Ram(0x10000);
  ram.write(0x2000, 0xc6);
  ram.write(0x2001, 0x6f);
  const cpu = new CpuZ80(ram, supplied);
  const alternate = bankSnapshot(supplied);
  // Avoid copying the caller's intentionally circular object in expectations.
  const { a, b, c, d, e, h, l, flags, bc, de, hl } = alternate;
  const expected = { a, b, c, d, e, h, l, flags, bc, de, hl };
  const record = cpu.step();
  assert.equal(record.after.a, 0x80);
  assert.deepEqual(record.after.alternate, expected);
  assert.notStrictEqual(record.after.flags, record.after.alternate.flags);
});

test("Z80 validates both banks, control fields, and RAM size before accessing memory", () => {
  const ram = new ObservedRam();
  for (const alternate of [false, true]) {
    for (const name of ["a", "b", "c", "d", "e", "h", "l"]) {
      for (const value of [-1, 256, 0.5, NaN, Infinity, "00"]) {
        const state = initialState();
        Reflect.set(alternate ? state.alternate : state, name, value);
        assert.throws(() => new CpuZ80(ram, state), RangeError);
      }
    }
    for (const name of ["s", "z", "h", "pv", "n", "c"]) {
      for (const value of [0, 1, undefined, "false"]) {
        const state = initialState();
        Reflect.set(alternate ? state.alternate.flags : state.flags, name, value);
        assert.throws(() => new CpuZ80(ram, state), TypeError);
      }
    }
  }
  for (const [name, maximum] of [["ix", 0xffff], ["iy", 0xffff], ["pc", 0xffff], ["sp", 0xffff],
    ["i", 0xff], ["r", 0xff], ["im", 2]] as const) {
    for (const value of [0, maximum]) {
      const state = initialState();
      Reflect.set(state, name, value);
      assert.equal(new CpuZ80(ram, state).snapshot()[name], value);
    }
    for (const value of [-1, maximum + 1, 0.5, NaN, Infinity, "00"]) {
      const state = initialState();
      Reflect.set(state, name, value);
      assert.throws(() => new CpuZ80(ram, state), RangeError);
    }
  }
  for (const name of ["iff1", "iff2", "interruptDeferred", "nmiDeferred", "halted"]) {
    for (const value of [0, 1, undefined, "false"]) {
      const state = initialState();
      Reflect.set(state, name, value);
      assert.throws(() => new CpuZ80(ram, state), TypeError);
    }
  }
  for (const size of [0x100, 0xffff, 0x10001]) {
    assert.throws(() => new CpuZ80(new Ram(size), initialState()), /exactly 64 KiB/);
  }
  assert.deepEqual(ram.accesses, []);
});

test("Z80 executes self-modified code and keeps earlier records detached", () => {
  const ram = new ObservedRam();
  [0x32, 0x03, 0x20, 0x00].forEach((value, offset) => ram.write(0x2000 + offset, value));
  const cpu = new CpuZ80(ram, initialState({ a: 0x76 }));
  const first = cpu.step();
  const saved = structuredClone(first);
  ram.accesses.length = 0;
  const next = cpu.step();
  assert.equal(next.outcome, "halted");
  assert.deepEqual(next.instruction, { address: 0x2003, bytes: [0x76] });
  assert.deepEqual(ram.accesses, [{ kind: "read", address: 0x2003, value: 0x76 }]);
  const reset = cpu.reset();
  Reflect.set(next.before.flags, "s", false);
  Reflect.set(next.after.alternate.flags, "z", false);
  Reflect.set(reset.before.alternate, "h", 0);
  assert.deepEqual(first, saved);
  assert.equal(cpu.snapshot().alternate.h, 0xdd);
  assert.equal(cpu.snapshot().alternate.flags.z, true);
});

test("Z80 increments only R bits 0–6 once per supported opcode, including HALT", () => {
  const ram = new ObservedRam();
  // Initial Z/C are clear, B is 22, and the displacement is 80 (-128).
  for (const [opcodes, nextPc] of [
    [[0x04, 0x05, 0x0c, 0x0d, 0x14, 0x15, 0x1c, 0x1d, 0x24, 0x25, 0x2c, 0x2d, 0x3c, 0x3d,
      ...transferRows.flatMap(row => [...row.opcodes]), ...aluForms.flatMap(form => [...form.opcodes])], 0],
    [[0x06, 0x0e, 0x16, 0x1e, 0x26, 0x2e, 0x36, 0x3e, 0x28, 0x38, ...aluForms.map(form => form.immediate)], 1],
    [[0x10, 0x18, 0x20, 0x30], 0xff81],
    [[0x01, 0x11, 0x21, 0x31, 0x32], 2],
  ] as const) {
    for (const opcode of opcodes) {
      for (let r = 0; r < 256; r++) {
        ram.write(0xffff, opcode);
        ram.write(0, 0x80);
        ram.write(1, 0);
        ram.accesses.length = 0;
        const before = initialState({ pc: 0xffff, r, interruptDeferred: false, nmiDeferred: false, iff1: false, iff2: true });
        const cpu = new CpuZ80(ram, before);
        const record = cpu.step();
        assert.equal(record.after.r, Math.floor(r / 128) * 128 + (r % 128 + 1) % 128);
        assert.equal(record.after.pc, nextPc);
        assert.equal(record.after.iff1, false);
        assert.equal(record.after.iff2, true);
        assert.equal(record.outcome, opcode === 0x76 ? "halted" : "executed");
        if (opcode === 0x76) {
          assert.deepEqual(record.after, snapshot({ ...before, pc: 0, r: record.after.r, halted: true }));
        }
        assert.deepEqual(ram.accesses, record.accesses);
      }
    }
  }
});

test("Z80 already-halted steps do not fetch, refresh, or change any state", () => {
  const ram = new ObservedRam();
  const before = initialState({ halted: true });
  const cpu = new CpuZ80(ram, before);
  const first = cpu.step();
  const next = cpu.step();
  assert.deepEqual(first, { before: snapshot(before), after: snapshot(before), outcome: "halted", instruction: null, accesses: [] });
  assert.deepEqual(next, first);
  assert.notStrictEqual(next, first);
  assert.notStrictEqual(first.before.alternate.flags, first.after.alternate.flags);
  assert.deepEqual(ram.accesses, []);
});

test("Z80 reset clears documented control state, releases HALT, and preserves unspecified registers and RAM", () => {
  for (const iff1 of [false, true]) {
    for (const iff2 of [false, true]) {
      for (const im of [0, 1, 2] as const) {
        const ram = new ObservedRam();
        ram.write(0, 0x76);
        ram.write(0xffff, 0xa5);
        ram.accesses.length = 0;
        const before = initialState({ iff1, iff2, im, halted: true });
        const after = snapshot({ ...before, pc: 0, i: 0, r: 0, interruptDeferred: false, nmiDeferred: false, iff1: false, iff2: false, im: 0, halted: false });
        const cpu = new CpuZ80(ram, before);
        const record = cpu.reset();
        assert.deepEqual(record, { before: snapshot(before), after, accesses: [] });
        assert.deepEqual(cpu.reset(), { before: after, after, accesses: [] });
        assert.deepEqual(ram.accesses, []);
        assert.equal(cpu.step().outcome, "halted");
        assert.equal(cpu.snapshot().r, 1);
        assert.equal(ram.read(0xffff), 0xa5);
        assert.deepEqual(record.after, after);
      }
    }
  }
});
