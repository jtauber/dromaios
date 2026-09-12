import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu6809 } from "../../../src/components/cpus/6809.js";
import type {
  Cpu6809Flags,
  Cpu6809MemoryAccess,
  Cpu6809State,
} from "../../../src/components/cpus/6809.js";
import { Ram } from "../../../src/components/memory/ram.js";

// Observe real RAM calls independently of the CPU's own records.
class ObservedRam extends Ram {
  readonly accesses: Cpu6809MemoryAccess[] = [];

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

function initialState(overrides: Partial<Cpu6809State> = {}): Cpu6809State {
  return {
    a: 0x11, b: 0x34, dp: 0x56, x: 0x2345, y: 0x4567, s: 0x89ab, u: 0xcdef, pc: 0x1234,
    flags: { e: true, f: false, h: true, i: false, n: true, z: false, v: true, c: true },
    ...overrides,
  };
}

test("6809 owns its initial state and detached numeric D snapshots without RAM accesses", () => {
  const ram = new ObservedRam();
  const supplied = initialState();
  const cpu = new Cpu6809(ram, supplied);
  const first = cpu.snapshot();
  const second = cpu.snapshot();
  const expected = { ...initialState(), d: 0x1134 };
  assert.deepEqual(first, expected);
  assert.equal(Object.getOwnPropertyDescriptor(first, "d")?.value, 0x1134);

  supplied.a = 0xff;
  supplied.b = 0x00;
  supplied.flags.h = false;
  // Deliberately bypass readonly typing to check JavaScript caller isolation.
  Reflect.set(first, "a", 0x22);
  Reflect.set(first, "b", 0x55);
  Reflect.set(first.flags, "c", false);
  assert.equal(first.a, 0x22);
  assert.equal(first.b, 0x55);
  assert.equal(first.flags.c, false);
  assert.equal(first.d, 0x1134); // A snapshot is a plain copy, not a live register view.
  Reflect.set(first, "d", 0xffff);
  assert.equal(first.d, 0xffff);
  assert.deepEqual(second, expected);
  assert.deepEqual(cpu.snapshot(), expected);
  assert.deepEqual(ram.accesses, []);
});

test("6809 ignores supplied D and extra metadata, including getters, when copying state", () => {
  const ram = new ObservedRam();
  const expected = { ...initialState(), d: 0x1134 };
  const supplied = {
    ...initialState(),
    get d() { throw new Error("Supplied D must not be read"); },
    get metadata() { throw new Error("State metadata must not be read"); },
    flags: {
      ...initialState().flags,
      get metadata() { throw new Error("Flag metadata must not be read"); },
    },
  };
  const cpu = new Cpu6809(ram, supplied);
  assert.deepEqual(cpu.snapshot(), expected);
  const snapshot = cpu.snapshot();
  Reflect.set(snapshot, "d", -1);
  const restored = new Cpu6809(ram, snapshot);
  assert.deepEqual(restored.snapshot(), expected);
  Reflect.set(snapshot, "a", 0xff);
  Reflect.set(snapshot.flags, "h", false);
  assert.deepEqual(restored.snapshot(), expected);
  assert.deepEqual(ram.accesses, []);
  const record = cpu.step();
  assert.deepEqual(record.before, expected);
  assert.deepEqual(record.after, expected);
});

test("6809 copies inherited getters and non-enumerable A/B once before deriving D", () => {
  class GetterFlags implements Cpu6809Flags {
    get e() { return true; }
    get f() { return false; }
    get h() { return true; }
    get i() { return false; }
    get n() { return true; }
    get z() { return false; }
    get v() { return true; }
    get c() { return true; }
  }
  const ram = new ObservedRam();
  let a = 0x11;
  let b = 0x34;
  const supplied = { ...initialState(), flags: new GetterFlags() };
  Object.defineProperty(supplied, "a", { enumerable: false, get: () => a++ });
  Object.defineProperty(supplied, "b", { enumerable: false, get: () => b++ });
  const cpu = new Cpu6809(ram, supplied);
  assert.equal(a, 0x12);
  assert.equal(b, 0x35);
  a = 0xff;
  b = 0xff;
  assert.deepEqual(cpu.snapshot(), { ...initialState(), d: 0x1134 });
  assert.deepEqual(ram.accesses, []);
});

test("6809 derives unsigned D with A as its high byte across register boundaries", () => {
  const ram = new ObservedRam();
  for (const [a, b, d] of [
    [0x00, 0x00, 0x0000],
    [0x00, 0xff, 0x00ff],
    [0x01, 0x00, 0x0100],
    [0x7f, 0xff, 0x7fff],
    [0x80, 0x00, 0x8000],
    [0xff, 0x00, 0xff00],
    [0xff, 0xff, 0xffff],
  ] as const) {
    const state = initialState({ a, b });
    const cpu = new Cpu6809(ram, state);
    assert.deepEqual(cpu.snapshot(), { ...state, d });
  }
  assert.deepEqual(ram.accesses, []);
});

test("6809 LDA immediate replaces N/Z, clears V, preserves other state, and reads two bytes", () => {
  const cases = [
    { value: 0x00, n: false, z: true },
    { value: 0x01, n: false, z: false },
    { value: 0x7f, n: false, z: false },
    { value: 0x80, n: true, z: false },
    { value: 0xff, n: true, z: false },
  ];
  const preservedFlags = [
    { e: false, f: false, h: false, i: false, c: false },
    { e: true, f: true, h: true, i: true, c: true },
    { e: true, f: false, h: true, i: false, c: true },
    { e: false, f: true, h: false, i: true, c: false },
  ];
  for (const { value, n, z } of cases) {
    for (const preserved of preservedFlags) {
      for (const oldNZV of [false, true]) {
        const ram = new ObservedRam();
        ram.write(0x1234, 0x86);
        ram.write(0x1235, value);
        ram.accesses.length = 0;
        const state = initialState({ flags: { ...preserved, n: oldNZV, z: oldNZV, v: oldNZV } });
        const before = { ...state, d: 0x1134 };
        const cpu = new Cpu6809(ram, state);
        const expectedAccesses = [
          { kind: "read", address: 0x1234, value: 0x86 },
          { kind: "read", address: 0x1235, value },
        ];
        const record = cpu.step();
        assert.deepEqual(record, {
          instruction: { address: 0x1234, bytes: [0x86, value] },
          before,
          after: {
            ...before, a: value, d: value * 256 + 0x34, pc: 0x1236,
            flags: { ...preserved, n, z, v: false },
          },
          accesses: expectedAccesses,
          outcome: "executed",
        });
        assert.deepEqual(cpu.snapshot(), record.after);
        assert.deepEqual(ram.accesses, expectedAccesses);
      }
    }
  }
});

test("6809 LDA wraps operand fetching and PC advancement at the 16-bit boundary", () => {
  for (const [address, operandAddress, nextPc] of [
    [0xfffe, 0xffff, 0x0000],
    [0xffff, 0x0000, 0x0001],
  ] as const) {
    const ram = new ObservedRam();
    ram.write(address, 0x86);
    ram.write(operandAddress, 0);
    ram.accesses.length = 0;
    const before = { ...initialState({ pc: address }), d: 0x1134 };
    const cpu = new Cpu6809(ram, before);
    const record = cpu.step();
    assert.deepEqual(record, {
      instruction: { address, bytes: [0x86, 0] },
      before,
      after: {
        ...before, a: 0, d: 0x0034, pc: nextPc,
        flags: { ...before.flags, n: false, z: true, v: false },
      },
      accesses: [
        { kind: "read", address, value: 0x86 },
        { kind: "read", address: operandAddress, value: 0 },
      ],
      outcome: "executed",
    });
    assert.deepEqual(cpu.snapshot(), record.after);
    assert.deepEqual(ram.accesses, record.accesses);
  }
});

test("every unsupported 6809 byte, including prefixes, repeatedly reads only itself without advancing PC", () => {
  for (let opcode = 0; opcode <= 0xff; opcode++) {
    if (opcode === 0x86) continue;
    for (const pc of [0x1234, 0xffff]) {
      const ram = new ObservedRam();
      ram.write(pc, opcode);
      ram.write((pc + 1) & 0xffff, 0x86);
      ram.accesses.length = 0;
      const before = { ...initialState({ pc }), d: 0x1134 };
      const cpu = new Cpu6809(ram, before);
      const expectedAccesses = [{ kind: "read", address: pc, value: opcode }];
      for (let attempt = 0; attempt < 2; attempt++) {
        assert.deepEqual(cpu.step(), {
          instruction: { address: pc, bytes: [opcode] },
          before,
          after: before,
          accesses: expectedAccesses,
          outcome: "unsupported",
          reason: "opcode",
        }, `opcode ${opcode}, PC ${pc}, attempt ${attempt}`);
        assert.deepEqual(cpu.snapshot(), before);
        assert.deepEqual(ram.accesses, expectedAccesses);
        ram.accesses.length = 0;
      }
    }
  }
});

test("6809 resumes after replacing an unsupported byte without retaining prefix or halt state", () => {
  for (const opcode of [0x00, 0x10, 0x11]) {
    const ram = new ObservedRam();
    ram.write(0xffff, opcode);
    ram.write(0x0000, 0x86);
    const cpu = new Cpu6809(ram, initialState({ pc: 0xffff }));
    const rejected = cpu.step();
    const savedRejected = structuredClone(rejected);
    assert.equal(rejected.outcome, "unsupported");

    ram.write(0xffff, 0x86);
    ram.accesses.length = 0;
    const loaded = cpu.step();
    assert.deepEqual(loaded, {
      instruction: { address: 0xffff, bytes: [0x86, 0x86] },
      before: savedRejected.after,
      after: {
        ...savedRejected.after, a: 0x86, d: 0x8634, pc: 0x0001,
        flags: { ...savedRejected.after.flags, n: true, z: false, v: false },
      },
      accesses: [
        { kind: "read", address: 0xffff, value: 0x86 },
        { kind: "read", address: 0x0000, value: 0x86 },
      ],
      outcome: "executed",
    });
    assert.deepEqual(cpu.snapshot(), loaded.after);
    assert.deepEqual(ram.accesses, loaded.accesses);
    assert.deepEqual(rejected, savedRejected);
    Reflect.set(rejected.before, "d", 0);
    Reflect.set(rejected.before.flags, "v", false);
    assert.deepEqual(rejected.after, savedRejected.after);
    assert.deepEqual(loaded.before, savedRejected.after);
    assert.deepEqual(cpu.snapshot(), loaded.after);
  }
});

test("6809 records retain fetched bytes and independent snapshots across RAM edits and later steps", () => {
  const ram = new ObservedRam();
  for (const [offset, value] of [0x86, 0x02, 0x86, 0x80].entries()) {
    ram.write(0x1234 + offset, value);
  }
  const cpu = new Cpu6809(ram, initialState());
  const first = cpu.step();
  const savedFirst = structuredClone(first);
  ram.write(0x1234, 0);
  ram.write(0x1235, 0xff);
  ram.accesses.length = 0;
  const second = cpu.step();
  const savedSecond = structuredClone(second);
  assert.deepEqual(second.before, first.after);
  assert.deepEqual(second.after, {
    ...initialState(), a: 0x80, d: 0x8034, pc: 0x1238,
    flags: { ...initialState().flags, n: true, z: false, v: false },
  });
  assert.deepEqual(ram.accesses, [
    { kind: "read", address: 0x1236, value: 0x86 },
    { kind: "read", address: 0x1237, value: 0x80 },
  ]);
  assert.deepEqual(first, savedFirst);
  assert.equal(first.before.d, 0x1134);
  assert.equal(first.after.d, 0x0234);

  Reflect.set(first.before, "a", 0xff);
  Reflect.set(first.before.flags, "h", false);
  assert.deepEqual(first.after, savedFirst.after);
  Reflect.set(first.after, "b", 0xff);
  Reflect.set(first.after, "d", 0xffff);
  Reflect.set(first.after.flags, "c", false);
  Reflect.set(first.instruction.bytes, "0", 0);
  assert.ok(first.accesses[0]);
  Reflect.set(first.accesses[0], "value", 0);
  Reflect.set(first.accesses, "length", 0);
  assert.deepEqual(second, savedSecond);
  assert.deepEqual(cpu.snapshot(), savedSecond.after);
});

test("6809 reset changes only PC, DP, F, and I and reads the vector high byte first", () => {
  const preservedFlags = [
    { e: false, h: false, n: false, z: false, v: false, c: false },
    { e: true, h: true, n: true, z: true, v: true, c: true },
    { e: true, h: false, n: true, z: false, v: true, c: false },
    { e: false, h: true, n: false, z: true, v: false, c: true },
  ];
  for (const preserved of preservedFlags) {
    for (const f of [false, true]) {
      for (const i of [false, true]) {
        const ram = new ObservedRam();
        ram.write(0xfffe, 0x34);
        ram.write(0xffff, 0x56);
        ram.write(0x3456, 0x86);
        ram.accesses.length = 0;
        const before = { ...initialState({ flags: { ...preserved, f, i } }), d: 0x1134 };
        const cpu = new Cpu6809(ram, before);
        const after = { ...before, pc: 0x3456, dp: 0, flags: { ...preserved, f: true, i: true } };
        const accesses = [
          { kind: "read", address: 0xfffe, value: 0x34 },
          { kind: "read", address: 0xffff, value: 0x56 },
        ];
        assert.deepEqual(cpu.reset(), { before, after, accesses });
        assert.deepEqual(cpu.snapshot(), after);
        assert.deepEqual(ram.accesses, accesses);
      }
    }
  }
});

test("6809 reset rereads changed vectors, preserves both stack pointers on repeated calls, and resumes execution", () => {
  const ram = new ObservedRam();
  ram.write(0x1234, 0x10);
  let before = { ...initialState({ s: 0, u: 0xffff }), d: 0x1134 };
  const cpu = new Cpu6809(ram, before);
  const rejected = cpu.step();
  const savedRejected = structuredClone(rejected);
  assert.equal(rejected.outcome, "unsupported");
  assert.deepEqual(cpu.snapshot(), before);

  const targets = [
    { high: 0, low: 0, pc: 0, operandAddress: 1, nextPc: 2, value: 2, n: false, z: false },
    { high: 0x34, low: 0x56, pc: 0x3456, operandAddress: 0x3457, nextPc: 0x3458,
      value: 0, n: false, z: true },
    { high: 0xff, low: 0xff, pc: 0xffff, operandAddress: 0, nextPc: 1, value: 0x80, n: true, z: false },
  ];
  for (const { high, low, pc, operandAddress, nextPc, value, n, z } of targets) {
    ram.write(0xfffe, high);
    ram.write(0xffff, low);
    ram.accesses.length = 0;
    const afterReset = { ...before, pc, dp: 0, flags: { ...before.flags, f: true, i: true } };
    const accesses = [
      { kind: "read", address: 0xfffe, value: high },
      { kind: "read", address: 0xffff, value: low },
    ];
    for (let attempt = 0; attempt < 2; attempt++) {
      assert.deepEqual(cpu.reset(), { before, after: afterReset, accesses });
      assert.deepEqual(cpu.snapshot(), afterReset);
      assert.deepEqual(ram.accesses, accesses);
      ram.accesses.length = 0;
      before = afterReset;
    }

    // Install the instruction after reset; FFFF is also the low vector byte.
    ram.write(pc, 0x86);
    ram.write(operandAddress, value);
    ram.accesses.length = 0;
    const afterLoad = {
      ...afterReset, a: value, d: value * 256 + 0x34, pc: nextPc,
      flags: { ...afterReset.flags, n, z, v: false },
    };
    const step = cpu.step();
    assert.deepEqual(step, {
      instruction: { address: pc, bytes: [0x86, value] },
      before: afterReset,
      after: afterLoad,
      accesses: [
        { kind: "read", address: pc, value: 0x86 },
        { kind: "read", address: operandAddress, value },
      ],
      outcome: "executed",
    });
    assert.deepEqual(cpu.snapshot(), afterLoad);
    assert.deepEqual(ram.accesses, step.accesses);
    before = afterLoad;
  }
  assert.deepEqual(rejected, savedRejected);
});

test("6809 reset records stay independent of execution, later resets, RAM edits, and caller edits", () => {
  const ram = new ObservedRam();
  ram.write(0x1234, 0x86);
  ram.write(0x1235, 2);
  ram.write(0x3456, 0x86);
  ram.write(0x3457, 0x80);
  ram.write(0xfffe, 0x34);
  ram.write(0xffff, 0x56);
  const cpu = new Cpu6809(ram, initialState());
  const earlierStep = cpu.step();
  const savedEarlierStep = structuredClone(earlierStep);
  const first = cpu.reset();
  const savedFirst = structuredClone(first);
  assert.deepEqual(first.before, earlierStep.after);
  assert.equal(first.before.d, 0x0234);
  assert.equal(first.after.d, 0x0234);

  const step = cpu.step();
  const savedStep = structuredClone(step);
  assert.deepEqual(step.before, first.after);
  assert.equal(step.after.a, 0x80);
  assert.equal(step.after.d, 0x8034);
  ram.write(0x3457, 0xff);
  ram.write(0xfffe, 0);
  ram.write(0xffff, 0);
  const second = cpu.reset();
  const savedSecond = structuredClone(second);
  assert.deepEqual(second, {
    before: savedStep.after,
    after: { ...savedStep.after, pc: 0 },
    accesses: [
      { kind: "read", address: 0xfffe, value: 0 },
      { kind: "read", address: 0xffff, value: 0 },
    ],
  });
  assert.deepEqual(first, savedFirst);
  assert.deepEqual(earlierStep, savedEarlierStep);
  assert.deepEqual(step, savedStep);

  Reflect.set(first.before, "a", 0xff);
  Reflect.set(first.before, "d", 0xffff);
  Reflect.set(first.before.flags, "e", false);
  assert.deepEqual(first.after, savedFirst.after);
  Reflect.set(first.after, "b", 0xff);
  Reflect.set(first.after, "d", 0xffff);
  Reflect.set(first.after.flags, "f", false);
  assert.ok(first.accesses[0]);
  Reflect.set(first.accesses[0], "value", 0xff);
  Reflect.set(first.accesses, "length", 0);
  Reflect.set(cpu.snapshot().flags, "i", false);
  assert.deepEqual(earlierStep, savedEarlierStep);
  assert.deepEqual(step, savedStep);
  assert.deepEqual(second, savedSecond);
  assert.deepEqual(cpu.snapshot(), savedSecond.after);
});

test("6809 requires exactly 64 KiB of RAM without reading or writing it", () => {
  for (const size of [1, 0xffff, 0x10001]) {
    const ram = new ObservedRam(size);
    assert.throws(() => new Cpu6809(ram, initialState()), RangeError);
    assert.deepEqual(ram.accesses, []);
  }
});

test("6809 validates each byte and word register, accepting both unsigned endpoints", () => {
  const ram = new ObservedRam();
  const registers = [
    ["a", 0xff], ["b", 0xff], ["dp", 0xff],
    ["x", 0xffff], ["y", 0xffff], ["s", 0xffff], ["u", 0xffff], ["pc", 0xffff],
  ] as const;
  for (const [name, maximum] of registers) {
    for (const value of [-1, maximum + 1, 1.5, NaN, Infinity, -Infinity, "0", null, undefined]) {
      const state = initialState();
      Reflect.set(state, name, value);
      assert.throws(() => new Cpu6809(ram, state), RangeError, `${name}=${value}`);
    }
    for (const value of [0, maximum]) {
      const state = initialState({ [name]: value });
      const cpu = new Cpu6809(ram, state);
      assert.deepEqual(cpu.snapshot(), { ...state, d: state.a * 256 + state.b });
    }
  }
  assert.deepEqual(ram.accesses, []);
});

test("6809 requires a boolean for every condition-code flag", () => {
  const ram = new ObservedRam();
  for (const name of ["e", "f", "h", "i", "n", "z", "v", "c"] as const) {
    for (const value of [0, 1, "false", null, undefined]) {
      const state = initialState();
      Reflect.set(state.flags, name, value);
      assert.throws(() => new Cpu6809(ram, state), TypeError, `${name}=${value}`);
    }
  }
  assert.deepEqual(ram.accesses, []);
});
