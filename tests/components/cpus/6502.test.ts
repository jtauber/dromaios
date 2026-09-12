import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu6502 } from "../../../src/components/cpus/6502.js";
import type {
  Cpu6502Flags,
  Cpu6502MemoryAccess,
  Cpu6502State,
} from "../../../src/components/cpus/6502.js";
import { Ram } from "../../../src/components/memory/ram.js";

// Observe real RAM calls independently of the CPU's own records.
class ObservedRam extends Ram {
  readonly accesses: Cpu6502MemoryAccess[] = [];

  constructor(size = 0x10000) {
    super(size);
  }

  override read(address: number): number {
    const value = super.read(address);
    this.accesses.push({ kind: "read", address, value });
    return value;
  }

  override write(address: number, value: number): void {
    super.write(address, value);
    this.accesses.push({ kind: "write", address, value });
  }
}

function initialState(overrides: Partial<Cpu6502State> = {}): Cpu6502State {
  return {
    a: 0x11, x: 0x22, y: 0x33, sp: 0xab, pc: 0x1234,
    flags: { n: true, v: false, d: true, i: true, z: false, c: true },
    ...overrides,
  };
}

test("6502 owns its initial state and snapshots without reset or RAM accesses", () => {
  const ram = new ObservedRam();
  const supplied = initialState();
  const cpu = new Cpu6502(ram, supplied);
  const first = cpu.snapshot();
  const second = cpu.snapshot();
  assert.deepEqual(first, initialState());

  supplied.a = 0xff;
  supplied.flags.d = false;
  // Deliberately bypass readonly typing to check JavaScript caller isolation.
  Reflect.set(first, "pc", 0xffff);
  Reflect.set(first.flags, "c", false);
  assert.equal(first.pc, 0xffff);
  assert.equal(first.flags.c, false);
  assert.deepEqual(second, initialState());
  assert.deepEqual(cpu.snapshot(), initialState());
  assert.deepEqual(ram.accesses, []);
});

test("6502 copies only model fields and does not read extra metadata getters", () => {
  const ram = new ObservedRam();
  const supplied = {
    ...initialState(),
    get metadata() { throw new Error("State metadata must not be read"); },
    flags: {
      ...initialState().flags,
      get metadata() { throw new Error("Flag metadata must not be read"); },
    },
  };
  const cpu = new Cpu6502(ram, supplied);
  assert.deepEqual(cpu.snapshot(), initialState());
  const record = cpu.step();
  assert.deepEqual(record.before, initialState());
  assert.deepEqual(record.after, initialState());
});

test("6502 accepts inherited flag getters and non-enumerable state fields", () => {
  class GetterFlags implements Cpu6502Flags {
    get n() { return true; }
    get v() { return false; }
    get d() { return true; }
    get i() { return true; }
    get z() { return false; }
    get c() { return true; }
  }
  const ram = new ObservedRam();
  let a = 0x11;
  const supplied = { ...initialState(), flags: new GetterFlags() };
  Object.defineProperty(supplied, "a", { enumerable: false, get: () => a });
  const cpu = new Cpu6502(ram, supplied);
  a = 0xff;
  assert.deepEqual(cpu.snapshot(), initialState());
  assert.deepEqual(ram.accesses, []);
});

test("LDA immediate replaces N/Z, preserves all other state, and performs exactly two reads", () => {
  const cases = [
    { value: 0x00, n: false, z: true },
    { value: 0x01, n: false, z: false },
    { value: 0x7f, n: false, z: false },
    { value: 0x80, n: true, z: false },
    { value: 0xff, n: true, z: false },
  ];
  const preservedFlags = [
    { v: false, d: false, i: false, c: false },
    { v: true, d: true, i: true, c: true },
    { v: true, d: false, i: true, c: false },
    { v: false, d: true, i: false, c: true },
  ];
  for (const { value, n, z } of cases) {
    for (const preserved of preservedFlags) {
      for (const oldNZ of [false, true]) {
        const ram = new ObservedRam();
        ram.write(0x1234, 0xa9);
        ram.write(0x1235, value);
        ram.accesses.length = 0;
        const before = initialState({ flags: { ...preserved, n: oldNZ, z: oldNZ } });
        const cpu = new Cpu6502(ram, before);
        const expectedAccesses = [
          { kind: "read", address: 0x1234, value: 0xa9 },
          { kind: "read", address: 0x1235, value },
        ];
        const record = cpu.step();
        assert.deepEqual(record, {
          instruction: { address: 0x1234, bytes: [0xa9, value] },
          before,
          after: { ...before, a: value, pc: 0x1236, flags: { ...preserved, n, z } },
          accesses: expectedAccesses,
          outcome: "executed",
        });
        assert.deepEqual(cpu.snapshot(), record.after);
        assert.deepEqual(ram.accesses, expectedAccesses);
      }
    }
  }
});

test("LDA immediate wraps operand fetching and PC advancement at the 16-bit boundary", () => {
  for (const [address, operandAddress, nextPc] of [
    [0xfffe, 0xffff, 0x0000],
    [0xffff, 0x0000, 0x0001],
  ] as const) {
    const ram = new ObservedRam();
    ram.write(address, 0xa9);
    ram.write(operandAddress, 0);
    ram.accesses.length = 0;
    const before = initialState({ pc: address });
    const cpu = new Cpu6502(ram, before);
    const record = cpu.step();
    assert.deepEqual(record, {
      instruction: { address, bytes: [0xa9, 0] },
      before,
      after: { ...before, a: 0, pc: nextPc, flags: { ...before.flags, n: false, z: true } },
      accesses: [
        { kind: "read", address, value: 0xa9 },
        { kind: "read", address: operandAddress, value: 0 },
      ],
      outcome: "executed",
    });
    assert.deepEqual(cpu.snapshot(), record.after);
    assert.deepEqual(ram.accesses, record.accesses);
  }
});

test("every unimplemented 6502 opcode reads once and preserves state on repeated attempts", () => {
  const ram = new ObservedRam();
  ram.write(0, 0xa9);
  for (let opcode = 0; opcode < 256; opcode++) {
    if (opcode === 0xa9) continue;
    ram.write(0xffff, opcode);
    for (const d of [false, true]) {
      const before = initialState({ pc: 0xffff, flags: { ...initialState().flags, d } });
      const cpu = new Cpu6502(ram, before);
      for (let attempt = 0; attempt < 2; attempt++) {
        ram.accesses.length = 0;
        const record = cpu.step();
        assert.deepEqual(record, {
          instruction: { address: 0xffff, bytes: [opcode] },
          before,
          after: before,
          accesses: [{ kind: "read", address: 0xffff, value: opcode }],
          outcome: "unsupported",
          reason: "opcode",
        });
        assert.deepEqual(cpu.snapshot(), before);
        assert.deepEqual(ram.accesses, record.accesses);
      }
    }
  }
});

test("unsupported records are independent and execution resumes after host memory changes", () => {
  const ram = new ObservedRam();
  const before = initialState();
  const cpu = new Cpu6502(ram, before);
  const first = cpu.step();
  const second = cpu.step();
  const savedSecond = structuredClone(second);
  Reflect.set(first.before.flags, "d", false);
  assert.deepEqual(first.after, before);
  Reflect.set(first.after, "pc", 0);
  Reflect.set(first.instruction.bytes, 0, 0xff);
  Reflect.set(first.accesses, 0, { kind: "write", address: 0, value: 0xff });
  assert.deepEqual(second, savedSecond);
  assert.deepEqual(cpu.snapshot(), before);

  ram.write(0x1234, 0xa9);
  ram.write(0x1235, 0x02);
  ram.accesses.length = 0;
  const resumed = cpu.step();
  assert.deepEqual(resumed, {
    instruction: { address: 0x1234, bytes: [0xa9, 0x02] },
    before,
    after: { ...before, a: 2, pc: 0x1236, flags: { ...before.flags, n: false, z: false } },
    accesses: [
      { kind: "read", address: 0x1234, value: 0xa9 },
      { kind: "read", address: 0x1235, value: 0x02 },
    ],
    outcome: "executed",
  });
  assert.deepEqual(ram.accesses, resumed.accesses);
  assert.deepEqual(second, savedSecond);
});

test("LDA records retain actual bytes and stay independent of execution, inspection, and edits", () => {
  const ram = new ObservedRam();
  for (const [address, value] of [0xa9, 2, 0xa9, 0x80, 0xa9, 0].entries()) {
    ram.write(address, value);
  }
  const cpu = new Cpu6502(ram, initialState({ pc: 0 }));
  const first = cpu.step();
  const savedFirst = structuredClone(first);
  ram.write(1, 0xff);
  ram.write(3, 0xff);
  ram.accesses.length = 0;
  const second = cpu.step();
  const savedSecond = structuredClone(second);
  assert.deepEqual(second.before, first.after);
  assert.deepEqual(second.instruction, { address: 2, bytes: [0xa9, 0xff] });
  assert.equal(second.after.a, 0xff);
  assert.deepEqual(ram.accesses, [
    { kind: "read", address: 2, value: 0xa9 },
    { kind: "read", address: 3, value: 0xff },
  ]);
  assert.deepEqual(second.accesses, ram.accesses);
  assert.deepEqual(first, savedFirst);

  ram.accesses.length = 0;
  Reflect.set(cpu.snapshot().flags, "n", false);
  assert.deepEqual(cpu.snapshot(), savedSecond.after);
  assert.deepEqual(ram.accesses, []);
  Reflect.set(first.before, "a", 0xff);
  Reflect.set(first.before.flags, "d", false);
  assert.deepEqual(first.after, savedFirst.after);
  Reflect.set(first.after, "pc", 0xffff);
  Reflect.set(first.after.flags, "c", false);
  Reflect.set(first.instruction, "address", 0xffff);
  Reflect.set(first.instruction.bytes, 0, 0);
  assert.ok(first.accesses[0]);
  Reflect.set(first.accesses[0], "value", 0);
  Reflect.set(first.accesses, first.accesses.length, { kind: "write", address: 0, value: 0 });
  assert.deepEqual(second, savedSecond);
  assert.deepEqual(cpu.snapshot(), savedSecond.after);
  assert.equal(ram.read(0), 0xa9);

  const third = cpu.step();
  assert.deepEqual(third.before, savedSecond.after);
  assert.deepEqual(third.after, {
    ...savedSecond.after, a: 0, pc: 6, flags: { ...savedSecond.after.flags, n: false, z: true },
  });
  assert.deepEqual(second, savedSecond);
});

test("6502 rejects RAM sizes outside its flat 64 KiB model without accessing memory", () => {
  for (const size of [1, 0xffff, 0x10001]) {
    const ram = new ObservedRam(size);
    assert.throws(() => new Cpu6502(ram, initialState()), RangeError);
    assert.deepEqual(ram.accesses, []);
  }
});

test("6502 validates byte registers, an 8-bit SP, and a 16-bit PC without RAM accesses", () => {
  const ram = new ObservedRam();
  for (const name of ["a", "x", "y", "sp", "pc"] as const) {
    const maximum = name === "pc" ? 0xffff : 0xff;
    for (const value of [-1, maximum + 1, 1.5, NaN, Infinity, -Infinity, "0", null, undefined]) {
      const state = initialState();
      Reflect.set(state, name, value);
      assert.throws(() => new Cpu6502(ram, state), RangeError, `${name}: ${value}`);
    }
    for (const value of [0, maximum]) {
      assert.equal(new Cpu6502(ram, initialState({ [name]: value })).snapshot()[name], value);
    }
  }
  assert.deepEqual(ram.accesses, []);
});

test("6502 rejects non-boolean flags without RAM accesses", () => {
  const ram = new ObservedRam();
  for (const name of ["n", "v", "d", "i", "z", "c"] as const) {
    for (const value of [0, 1, "false", null, undefined]) {
      const state = initialState();
      Reflect.set(state.flags, name, value);
      assert.throws(() => new Cpu6502(ram, state), TypeError, `${name}: ${value}`);
    }
  }
  assert.deepEqual(ram.accesses, []);
});
