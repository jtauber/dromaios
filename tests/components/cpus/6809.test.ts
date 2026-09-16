import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu6809 } from "../../../src/components/cpus/6809.js";
import type { Cpu6809Flags, Cpu6809Snapshot, Cpu6809State } from "../../../src/components/cpus/6809.js";
import { Ram } from "../../../src/components/memory/ram.js";
import { ObservedRam } from "../../helpers/observed-ram.js";

function initialState(overrides: Partial<Cpu6809State> = {}): Cpu6809State {
  return {
    a: 0x11, b: 0x34, dp: 0x56, x: 0x2345, y: 0x4567, s: 0x89ab, u: 0xcdef, pc: 0x1234,
    waitMode: "none", nmiArmed: true,
    flags: { e: true, f: false, h: true, i: false, n: true, z: false, v: true, c: true },
    ...overrides,
  };
}

const stacks = [
  { stack: "s", other: "u", push: 0x34, pull: 0x35 },
  { stack: "u", other: "s", push: 0x36, pull: 0x37 },
] as const;

// An independent CC oracle: read the printed binary digits, not the CPU's masks.
function flagsFor(cc: number): Cpu6809Flags {
  const bits = cc.toString(2).padStart(8, "0");
  return {
    e: bits[0] === "1", f: bits[1] === "1", h: bits[2] === "1", i: bits[3] === "1",
    n: bits[4] === "1", z: bits[5] === "1", v: bits[6] === "1", c: bits[7] === "1",
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
  ram.write(0x1234, 0x01); // An unsupported byte keeps this ownership check inert.
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

// Literal effective addresses, independent of the CPU's address calculation.
const directAddresses = [
  [0x00, 0x00, 0x0000], [0x00, 0xff, 0x00ff],
  [0x12, 0x00, 0x1200], [0x12, 0x80, 0x1280], [0x12, 0xff, 0x12ff],
  [0x80, 0x00, 0x8000], [0xff, 0x00, 0xff00], [0xff, 0xff, 0xffff],
] as const;

test("6809 LDA direct combines DP and the operand, replaces A/N/Z/V, and preserves unrelated state", () => {
  for (const [dp, offset, address] of directAddresses) {
    for (const [value, n, z] of [
      [0x00, false, true], [0x11, false, false], [0x7f, false, false],
      [0x80, true, false], [0xff, true, false],
    ] as const) {
      for (const flags of [
        { e: true, f: false, h: true, i: false, n: true, z: true, v: true, c: true },
        { e: false, f: true, h: false, i: true, n: false, z: false, v: false, c: false },
      ]) {
        const ram = new ObservedRam();
        ram.write(0x2000, 0x96);
        ram.write(0x2001, offset);
        const before = { ...initialState({ dp, pc: 0x2000, flags }), d: 0x1134 };
        const cpu = new Cpu6809(ram, before);
        ram.write(address, value); // Load current RAM, including edits after construction.
        ram.accesses.length = 0;
        const record = cpu.step();
        assert.deepEqual(record, {
          instruction: { address: 0x2000, bytes: [0x96, offset] },
          before,
          after: {
            ...before, a: value, d: value * 256 + 0x34, pc: 0x2002,
            flags: { ...flags, n, z, v: false },
          },
          accesses: [
            { kind: "read", address: 0x2000, value: 0x96 },
            { kind: "read", address: 0x2001, value: offset },
            { kind: "read", address, value },
          ],
          outcome: "executed",
        }, `DP=${dp}, offset=${offset}, value=${value}`);
        assert.deepEqual(cpu.snapshot(), record.after);
        assert.deepEqual(ram.accesses, record.accesses);
        assert.equal(ram.read(address), value);
      }
    }
  }
});

test("6809 direct loads and stores wrap instruction fetching independently of the direct page", () => {
  for (const opcode of [0x96, 0x97]) {
    for (const [pc, operandAddress, nextPc] of [
      [0xfffe, 0xffff, 0x0000], [0xffff, 0x0000, 0x0001],
    ] as const) {
      const ram = new ObservedRam();
      ram.write(pc, opcode);
      ram.write(operandAddress, 0xff);
      ram.write(0x12ff, 0x80);
      ram.accesses.length = 0;
      const before = { ...initialState({ pc, dp: 0x12 }), d: 0x1134 };
      const cpu = new Cpu6809(ram, before);
      const record = cpu.step();
      assert.deepEqual(record, {
        instruction: { address: pc, bytes: [opcode, 0xff] },
        before,
        after: {
          ...before, a: opcode === 0x96 ? 0x80 : 0x11,
          d: opcode === 0x96 ? 0x8034 : 0x1134, pc: nextPc,
          flags: { ...before.flags, n: opcode === 0x96, z: false, v: false },
        },
        accesses: [
          { kind: "read", address: pc, value: opcode },
          { kind: "read", address: operandAddress, value: 0xff },
          opcode === 0x96
            ? { kind: "read", address: 0x12ff, value: 0x80 }
            : { kind: "write", address: 0x12ff, value: 0x11 },
        ],
        outcome: "executed",
      });
      assert.deepEqual(cpu.snapshot(), record.after);
      assert.deepEqual(ram.accesses, record.accesses);
      assert.equal(ram.read(0x12ff), opcode === 0x96 ? 0x80 : 0x11);
    }
  }
});

test("6809 LDA direct can read its opcode, operand, or next instruction as data", () => {
  for (const [offset, address, value, n] of [
    [0x40, 0x2040, 0x96, true], [0x41, 0x2041, 0x41, false], [0x42, 0x2042, 0x80, true],
  ] as const) {
    const ram = new ObservedRam();
    ram.write(0x2040, 0x96);
    ram.write(0x2041, offset);
    ram.write(0x2042, 0x80);
    ram.accesses.length = 0;
    const before = { ...initialState({ pc: 0x2040, dp: 0x20 }), d: 0x1134 };
    const cpu = new Cpu6809(ram, before);
    const record = cpu.step();
    assert.deepEqual(record, {
      instruction: { address: 0x2040, bytes: [0x96, offset] },
      before,
      after: {
        ...before, a: value, d: value * 256 + 0x34, pc: 0x2042,
        flags: { ...before.flags, n, z: false, v: false },
      },
      accesses: [
        { kind: "read", address: 0x2040, value: 0x96 },
        { kind: "read", address: 0x2041, value: offset },
        { kind: "read", address, value },
      ],
      outcome: "executed",
    });
    assert.deepEqual(cpu.snapshot(), record.after);
    assert.deepEqual(ram.accesses, record.accesses);
  }
});

test("6809 ADDA immediate replaces H/N/Z/V/C, preserves other state, and reads exactly two bytes", () => {
  const cases = [
    { a: 0x02, value: 0x03, result: 0x05, flags: { h: false, n: false, z: false, v: false, c: false } },
    { a: 0x0f, value: 0x01, result: 0x10, flags: { h: true, n: false, z: false, v: false, c: false } },
    { a: 0xff, value: 0x01, result: 0x00, flags: { h: true, n: false, z: true, v: false, c: true } },
    { a: 0x7f, value: 0x01, result: 0x80, flags: { h: true, n: true, z: false, v: true, c: false } },
    { a: 0x80, value: 0x80, result: 0x00, flags: { h: false, n: false, z: true, v: true, c: true } },
    { a: 0xff, value: 0x00, result: 0xff, flags: { h: false, n: true, z: false, v: false, c: false } },
  ];
  const preservedFlags = [
    { e: false, f: false, i: false },
    { e: true, f: true, i: true },
    { e: true, f: false, i: true },
    { e: false, f: true, i: false },
  ];
  for (const { a, value, result, flags } of cases) {
    for (const preserved of preservedFlags) {
      for (const carry of [false, true]) {
        for (const oldHNZV of [false, true]) {
          const ram = new ObservedRam();
          ram.write(0x1234, 0x8b);
          ram.write(0x1235, value);
          ram.accesses.length = 0;
          const before = {
            ...initialState({ a, flags: { ...preserved, h: oldHNZV, n: oldHNZV, z: oldHNZV, v: oldHNZV, c: carry } }),
            d: a * 256 + 0x34,
          };
          const cpu = new Cpu6809(ram, before);
          const accesses = [
            { kind: "read", address: 0x1234, value: 0x8b },
            { kind: "read", address: 0x1235, value },
          ];
          const record = cpu.step();
          const context = `A=${a}, operand=${value}, C=${carry}, old H/N/Z/V=${oldHNZV}`;
          assert.deepEqual(record, {
            instruction: { address: 0x1234, bytes: [0x8b, value] },
            before,
            after: { ...before, a: result, d: result * 256 + 0x34, pc: 0x1236, flags: { ...preserved, ...flags } },
            accesses,
            outcome: "executed",
          }, context);
          assert.deepEqual(cpu.snapshot(), record.after, context);
          assert.deepEqual(ram.accesses, accesses, context);
        }
      }
    }
  }
});

test("6809 ADDA matches unsigned and signed addition for every operand pair regardless of incoming carry", () => {
  const ram = new Ram(0x10000);
  ram.write(0, 0x8b);
  for (let value = 0; value < 256; value++) {
    ram.write(1, value);
    for (let a = 0; a < 256; a++) {
      // Arithmetic expectations are independent of the CPU's bit masks and XORs.
      const unsignedSum = a + value;
      const signedSum = (a < 128 ? a : a - 256) + (value < 128 ? value : value - 256);
      const result = unsignedSum % 256;
      for (const carry of [false, true]) {
        for (const oldHNZV of [false, true]) {
          const before = initialState({
            a, pc: 0,
            flags: {
              e: oldHNZV, f: !oldHNZV, i: oldHNZV,
              h: oldHNZV, n: oldHNZV, z: oldHNZV, v: oldHNZV, c: carry,
            },
          });
          const cpu = new Cpu6809(ram, before);
          const record = cpu.step();
          assert.equal(record.outcome, "executed");
          assert.deepEqual(record.after, {
            ...before, a: result, d: result * 256 + before.b, pc: 2,
            flags: {
              e: oldHNZV, f: !oldHNZV, i: oldHNZV,
              h: a % 16 + value % 16 >= 16,
              n: result >= 128, z: result === 0,
              v: signedSum < -128 || signedSum > 127, c: unsignedSum >= 256,
            },
          }, `A=${a}, operand=${value}, C=${carry}, old H/N/Z/V=${oldHNZV}`);
        }
      }
    }
  }
});

test("6809 ADDA wraps operand fetching and PC advancement at the 16-bit boundary", () => {
  for (const [address, operandAddress, nextPc] of [
    [0xfffe, 0xffff, 0x0000],
    [0xffff, 0x0000, 0x0001],
  ] as const) {
    const ram = new ObservedRam();
    ram.write(address, 0x8b);
    ram.write(operandAddress, 1);
    ram.accesses.length = 0;
    const before = { ...initialState({ a: 0xff, pc: address }), d: 0xff34 };
    const cpu = new Cpu6809(ram, before);
    const record = cpu.step();
    assert.deepEqual(record, {
      instruction: { address, bytes: [0x8b, 1] },
      before,
      after: {
        ...before, a: 0, d: 0x0034, pc: nextPc,
        flags: { ...before.flags, h: true, n: false, z: true, v: false, c: true },
      },
      accesses: [
        { kind: "read", address, value: 0x8b },
        { kind: "read", address: operandAddress, value: 1 },
      ],
      outcome: "executed",
    });
    assert.deepEqual(cpu.snapshot(), record.after);
    assert.deepEqual(ram.accesses, record.accesses);
  }
});

test("successive 6809 ADDA instructions use live A and operands while keeping independent records", () => {
  const ram = new ObservedRam();
  for (const [address, value] of [0x8b, 1, 0x8b, 0, 0x8b, 1].entries()) {
    ram.write(address, value);
  }
  const cpu = new Cpu6809(ram, initialState({ a: 0xff, pc: 0 }));
  const first = cpu.step();
  const savedFirst = structuredClone(first);
  assert.equal(first.after.a, 0);
  assert.equal(first.after.d, 0x0034);
  assert.equal(first.after.flags.c, true);
  ram.write(1, 0xff);
  ram.write(3, 0x7f);
  ram.accesses.length = 0;
  const second = cpu.step();
  const savedSecond = structuredClone(second);
  assert.deepEqual(second, {
    instruction: { address: 2, bytes: [0x8b, 0x7f] },
    before: first.after,
    after: {
      ...first.after, a: 0x7f, d: 0x7f34, pc: 4,
      flags: { ...first.after.flags, h: false, n: false, z: false, v: false, c: false },
    },
    accesses: [
      { kind: "read", address: 2, value: 0x8b },
      { kind: "read", address: 3, value: 0x7f },
    ],
    outcome: "executed",
  });
  assert.deepEqual(ram.accesses, second.accesses);
  assert.deepEqual(first, savedFirst);
  Reflect.set(first.before.flags, "h", false);
  assert.deepEqual(first.after, savedFirst.after);
  Reflect.set(first.after, "a", 0xff);
  Reflect.set(first.after, "d", 0xffff);
  Reflect.set(first.after.flags, "c", false);
  assert.ok(first.instruction);
  Reflect.set(first.instruction.bytes, 1, 0xff);
  assert.ok(first.accesses[1]);
  Reflect.set(first.accesses[1], "value", 0xff);
  Reflect.set(cpu.snapshot().flags, "c", true);
  assert.deepEqual(cpu.snapshot(), savedSecond.after);
  ram.accesses.length = 0;
  const third = cpu.step();
  assert.deepEqual(third, {
    instruction: { address: 4, bytes: [0x8b, 1] },
    before: savedSecond.after,
    after: {
      ...savedSecond.after, a: 0x80, d: 0x8034, pc: 6,
      flags: { ...savedSecond.after.flags, h: true, n: true, z: false, v: true, c: false },
    },
    accesses: [
      { kind: "read", address: 4, value: 0x8b },
      { kind: "read", address: 5, value: 1 },
    ],
    outcome: "executed",
  });
  assert.deepEqual(cpu.snapshot(), third.after);
  assert.deepEqual(ram.accesses, third.accesses);
  assert.deepEqual(second, savedSecond);
});

test("6809 STA extended writes once using high/low address bytes, bypasses DP, and replaces N/Z/V", () => {
  const preservedFlags = [
    { e: false, f: false, h: false, i: false, c: false },
    { e: true, f: true, h: true, i: true, c: true },
    { e: true, f: false, h: true, i: false, c: true },
    { e: false, f: true, h: false, i: true, c: false },
  ];
  for (const [high, low, destination] of [
    [0x00, 0x80, 0x0080], [0x12, 0x34, 0x1234],
    [0x00, 0x00, 0x0000], [0xff, 0xff, 0xffff],
  ] as const) {
    for (const { a, n, z } of [
      { a: 0x00, n: false, z: true },
      { a: 0x80, n: true, z: false },
      { a: 0xff, n: true, z: false },
    ]) {
      for (const preserved of preservedFlags) {
        for (const oldNZV of [false, true]) {
          const ram = new ObservedRam();
          ram.write(0x0200, 0xb7);
          ram.write(0x0201, high);
          ram.write(0x0202, low);
          // Writing is required even when the destination already contains A.
          ram.write(destination, 0x80);
          ram.accesses.length = 0;
          const before = {
            ...initialState({
              a, dp: 0x12, pc: 0x0200,
              flags: { ...preserved, n: oldNZV, z: oldNZV, v: oldNZV },
            }),
            d: a * 256 + 0x34,
          };
          const cpu = new Cpu6809(ram, before);
          const accesses = [
            { kind: "read", address: 0x0200, value: 0xb7 },
            { kind: "read", address: 0x0201, value: high },
            { kind: "read", address: 0x0202, value: low },
            { kind: "write", address: destination, value: a },
          ];
          const record = cpu.step();
          const context = `destination=${destination}, A=${a}, old N/Z/V=${oldNZV}`;
          assert.deepEqual(record, {
            instruction: { address: 0x0200, bytes: [0xb7, high, low] },
            before,
            after: { ...before, pc: 0x0203, flags: { ...preserved, n, z, v: false } },
            accesses,
            outcome: "executed",
          }, context);
          assert.deepEqual(cpu.snapshot(), record.after, context);
          assert.deepEqual(ram.accesses, accesses, context);
          assert.equal(ram.read(destination), a, context);
        }
      }
    }
  }
});

test("6809 STA extended wraps both operand fetching and PC advancement at the 16-bit boundary", () => {
  for (const [address, highAddress, lowAddress, nextPc] of [
    [0xfffd, 0xfffe, 0xffff, 0x0000],
    [0xfffe, 0xffff, 0x0000, 0x0001],
    [0xffff, 0x0000, 0x0001, 0x0002],
  ] as const) {
    const ram = new ObservedRam();
    ram.write(address, 0xb7);
    ram.write(highAddress, 0x34);
    ram.write(lowAddress, 0x56);
    ram.accesses.length = 0;
    const before = { ...initialState({ a: 0xa5, pc: address }), d: 0xa534 };
    const cpu = new Cpu6809(ram, before);
    const record = cpu.step();
    assert.deepEqual(record, {
      instruction: { address, bytes: [0xb7, 0x34, 0x56] },
      before,
      after: { ...before, pc: nextPc, flags: { ...before.flags, n: true, z: false, v: false } },
      accesses: [
        { kind: "read", address, value: 0xb7 },
        { kind: "read", address: highAddress, value: 0x34 },
        { kind: "read", address: lowAddress, value: 0x56 },
        { kind: "write", address: 0x3456, value: 0xa5 },
      ],
      outcome: "executed",
    });
    assert.deepEqual(cpu.snapshot(), record.after);
    assert.deepEqual(ram.accesses, record.accesses);
    assert.equal(ram.read(0x3456), 0xa5);
  }
});

test("6809 STA extended can overwrite its opcode or either operand while retaining the fetched bytes", () => {
  for (const [low, destination] of [
    [0x00, 0x0200], [0x01, 0x0201], [0x02, 0x0202],
  ] as const) {
    const ram = new ObservedRam();
    ram.write(0x0200, 0xb7);
    ram.write(0x0201, 0x02);
    ram.write(0x0202, low);
    ram.accesses.length = 0;
    const before = { ...initialState({ a: 0xe7, pc: 0x0200 }), d: 0xe734 };
    const cpu = new Cpu6809(ram, before);
    const record = cpu.step();
    assert.deepEqual(record, {
      instruction: { address: 0x0200, bytes: [0xb7, 0x02, low] },
      before,
      after: { ...before, pc: 0x0203, flags: { ...before.flags, n: true, z: false, v: false } },
      accesses: [
        { kind: "read", address: 0x0200, value: 0xb7 },
        { kind: "read", address: 0x0201, value: 0x02 },
        { kind: "read", address: 0x0202, value: low },
        { kind: "write", address: destination, value: 0xe7 },
      ],
      outcome: "executed",
    });
    assert.deepEqual(cpu.snapshot(), record.after);
    assert.deepEqual(ram.accesses, record.accesses);
    assert.equal(ram.read(destination), 0xe7);
  }
});

test("6809 STA records keep written values independent of later stores, memory changes, and caller edits", () => {
  const ram = new ObservedRam();
  // Store 80 at 1234, load zero, then store zero at 1234.
  for (const [address, value] of [0xb7, 0x12, 0x34, 0x86, 0, 0xb7, 0x12, 0x34].entries()) {
    ram.write(address, value);
  }
  const cpu = new Cpu6809(ram, initialState({ a: 0x80, pc: 0 }));
  const first = cpu.step();
  const savedFirst = structuredClone(first);
  assert.equal(ram.read(0x1234), 0x80);
  ram.write(1, 0xff);
  ram.write(0x1234, 0xff);
  const load = cpu.step();
  const savedLoad = structuredClone(load);
  ram.accesses.length = 0;
  const second = cpu.step();
  const savedSecond = structuredClone(second);
  assert.deepEqual(second, {
    instruction: { address: 5, bytes: [0xb7, 0x12, 0x34] },
    before: load.after,
    after: { ...load.after, pc: 8 },
    accesses: [
      { kind: "read", address: 5, value: 0xb7 },
      { kind: "read", address: 6, value: 0x12 },
      { kind: "read", address: 7, value: 0x34 },
      { kind: "write", address: 0x1234, value: 0 },
    ],
    outcome: "executed",
  });
  assert.deepEqual(ram.accesses, second.accesses);
  assert.deepEqual(first, savedFirst);
  assert.equal(first.after.d, 0x8034);
  assert.equal(second.after.d, 0x0034);
  Reflect.set(first.before.flags, "h", false);
  assert.deepEqual(first.after, savedFirst.after);
  Reflect.set(first.after, "a", 0xff);
  Reflect.set(first.after, "d", 0xffff);
  Reflect.set(first.after.flags, "c", false);
  assert.ok(first.instruction);
  Reflect.set(first.instruction.bytes, 1, 0xff);
  assert.ok(first.accesses[3]);
  Reflect.set(first.accesses[3], "value", 0xff);
  Reflect.set(cpu.snapshot().flags, "z", false);
  assert.deepEqual(cpu.snapshot(), savedSecond.after);
  assert.deepEqual(second, savedSecond);
  assert.deepEqual(load, savedLoad);
  assert.equal(ram.read(0x1234), 0);
});

test("6809 STA direct writes once through DP, replaces N/Z/V, and never reads its destination", () => {
  for (const [dp, offset, address] of directAddresses) {
    for (const [a, n, z] of [
      [0x00, false, true], [0x7f, false, false], [0x80, true, false], [0xff, true, false],
    ] as const) {
      for (const flags of [
        { e: true, f: false, h: true, i: false, n: true, z: true, v: true, c: true },
        { e: false, f: true, h: false, i: true, n: false, z: false, v: false, c: false },
      ]) {
        const ram = new ObservedRam();
        ram.write(0x2000, 0x97);
        ram.write(0x2001, offset);
        ram.write(address, 0x80); // An unchanged-value store must still write and update flags.
        ram.accesses.length = 0;
        const before = { ...initialState({ a, dp, pc: 0x2000, flags }), d: a * 256 + 0x34 };
        const cpu = new Cpu6809(ram, before);
        const record = cpu.step();
        assert.deepEqual(record, {
          instruction: { address: 0x2000, bytes: [0x97, offset] },
          before,
          after: { ...before, pc: 0x2002, flags: { ...flags, n, z, v: false } },
          accesses: [
            { kind: "read", address: 0x2000, value: 0x97 },
            { kind: "read", address: 0x2001, value: offset },
            { kind: "write", address, value: a },
          ],
          outcome: "executed",
        }, `DP=${dp}, offset=${offset}, A=${a}`);
        assert.deepEqual(cpu.snapshot(), record.after);
        assert.deepEqual(ram.accesses, record.accesses);
        assert.equal(ram.read(address), a);
      }
    }
  }
});

test("6809 STA direct can overwrite its opcode, operand, or next instruction without changing captured bytes", () => {
  for (const [offset, address] of [[0x40, 0x2040], [0x41, 0x2041], [0x42, 0x2042]] as const) {
    const ram = new ObservedRam();
    ram.write(0x2040, 0x97);
    ram.write(0x2041, offset);
    ram.write(0x2042, 0x01);
    ram.write(0x2043, 0x5a);
    ram.accesses.length = 0;
    const before = { ...initialState({ a: 0x86, pc: 0x2040, dp: 0x20 }), d: 0x8634 };
    const cpu = new Cpu6809(ram, before);
    const record = cpu.step();
    assert.deepEqual(record, {
      instruction: { address: 0x2040, bytes: [0x97, offset] },
      before,
      after: { ...before, pc: 0x2042, flags: { ...before.flags, n: true, z: false, v: false } },
      accesses: [
        { kind: "read", address: 0x2040, value: 0x97 },
        { kind: "read", address: 0x2041, value: offset },
        { kind: "write", address, value: 0x86 },
      ],
      outcome: "executed",
    });
    assert.deepEqual(cpu.snapshot(), record.after);
    assert.deepEqual(ram.accesses, record.accesses);
    assert.equal(ram.read(address), 0x86);

    const saved = structuredClone(record);
    const next = cpu.step();
    assert.equal(next.outcome, offset === 0x42 ? "executed" : "unsupported");
    assert.deepEqual(next.instruction, { address: 0x2042, bytes: offset === 0x42 ? [0x86, 0x5a] : [0x01] });
    ram.write(address, 0xff);
    cpu.reset();
    assert.deepEqual(record, saved);
  }
});

test("6809 direct accesses use DP changed by a stack pull while retaining an earlier loaded byte", () => {
  const ram = new ObservedRam();
  for (const [offset, value] of [0x96, 0x80, 0x35, 0x08, 0x97, 0x81, 0x96, 0x80].entries()) {
    ram.write(0x0200 + offset, value); // LDA <$80; PULS DP; STA <$81; LDA <$80
  }
  ram.write(0x1280, 0xa5);
  ram.write(0xff80, 0x5a);
  ram.write(0x8000, 0xff);
  const before = { ...initialState({ pc: 0x0200, dp: 0x12, s: 0x8000 }), d: 0x1134 };
  const cpu = new Cpu6809(ram, before);
  const load = cpu.step();
  const savedLoad = structuredClone(load);
  const afterLoad = {
    ...before, a: 0xa5, d: 0xa534, pc: 0x0202,
    flags: { ...before.flags, n: true, z: false, v: false },
  };
  assert.deepEqual(load.after, afterLoad);
  const pull = cpu.step();
  const afterPull = { ...afterLoad, dp: 0xff, s: 0x8001, pc: 0x0204 };
  assert.deepEqual(pull.after, afterPull);
  ram.write(0x1280, 0);
  ram.accesses.length = 0;
  const store = cpu.step();
  assert.deepEqual(store, {
    instruction: { address: 0x0204, bytes: [0x97, 0x81] },
    before: afterPull, after: { ...afterPull, pc: 0x0206 },
    accesses: [
      { kind: "read", address: 0x0204, value: 0x97 },
      { kind: "read", address: 0x0205, value: 0x81 },
      { kind: "write", address: 0xff81, value: 0xa5 },
    ],
    outcome: "executed",
  });
  assert.deepEqual(ram.accesses, store.accesses);
  assert.equal(ram.read(0xff81), 0xa5);
  assert.equal(ram.read(0x1281), 0);
  ram.accesses.length = 0;
  const reload = cpu.step();
  assert.deepEqual(reload, {
    instruction: { address: 0x0206, bytes: [0x96, 0x80] },
    before: store.after,
    after: { ...store.after, a: 0x5a, d: 0x5a34, pc: 0x0208, flags: { ...store.after.flags, n: false } },
    accesses: [
      { kind: "read", address: 0x0206, value: 0x96 },
      { kind: "read", address: 0x0207, value: 0x80 },
      { kind: "read", address: 0xff80, value: 0x5a },
    ],
    outcome: "executed",
  });
  assert.deepEqual(cpu.snapshot(), reload.after);
  assert.deepEqual(ram.accesses, reload.accesses);
  assert.deepEqual(load, savedLoad);
});

test("6809 pushes every register mask in the specified memory layout, including empty masks and wrapping", () => {
  for (const { stack, other, push } of stacks) {
    for (const start of [0x8000, 0x0000, 0x0001]) {
      const before = { ...initialState({ [stack]: start }), d: 0x1134 };
      // Final frame in ascending address order, with literal byte values.
      const parts = [
        { bit: 0x01, bytes: [0xab] },
        { bit: 0x02, bytes: [0x11] },
        { bit: 0x04, bytes: [0x34] },
        { bit: 0x08, bytes: [0x56] },
        { bit: 0x10, bytes: [0x23, 0x45] },
        { bit: 0x20, bytes: [0x45, 0x67] },
        { bit: 0x40, bytes: other === "u" ? [0xcd, 0xef] : [0x89, 0xab] },
        { bit: 0x80, bytes: [0x12, 0x36] }, // PC after the two-byte instruction.
      ];
      for (let mask = 0; mask < 256; mask++) {
        const ram = new ObservedRam();
        ram.write(0x1234, push);
        ram.write(0x1235, mask);
        const frame = parts.filter(part => mask & part.bit).flatMap(part => part.bytes);
        const writes = [...frame].reverse().map((value, offset) => ({
          kind: "write" as const, address: (start - 1 - offset + 65_536) % 65_536, value,
        }));
        // Rewriting identical bytes must still issue all the writes.
        for (const { address, value } of writes) ram.write(address, value);
        ram.accesses.length = 0;
        const cpu = new Cpu6809(ram, before);
        const record = cpu.step();
        const context = `${stack}, start=${start}, mask=${mask}`;
        assert.deepEqual(record, {
          instruction: { address: 0x1234, bytes: [push, mask] },
          before,
          after: { ...before, pc: 0x1236, [stack]: (start - frame.length + 65_536) % 65_536 },
          accesses: [
            { kind: "read", address: 0x1234, value: push },
            { kind: "read", address: 0x1235, value: mask },
            ...writes,
          ],
          outcome: "executed",
        }, context);
        assert.deepEqual(cpu.snapshot(), record.after, context);
        assert.deepEqual(ram.accesses, record.accesses, context);
        for (const { address, value } of writes) assert.equal(ram.read(address), value, context);
      }
    }
  }
});

test("6809 pulls every register mask from independently supplied frames without load-instruction flag effects", () => {
  for (const { stack, other, pull } of stacks) {
    for (const start of [0x8000, 0xffff]) {
      const before = { ...initialState({ [stack]: start }), d: 0x1134 };
      const parts: readonly { bit: number; bytes: readonly number[]; state: Partial<Cpu6809State> }[] = [
        // E is clear: the postbyte still controls the entire pull, unlike RTI.
        { bit: 0x01, bytes: [0x05], state: { flags: flagsFor(0x05) } },
        { bit: 0x02, bytes: [0x80], state: { a: 0x80 } },
        { bit: 0x04, bytes: [0x00], state: { b: 0 } },
        { bit: 0x08, bytes: [0xfe], state: { dp: 0xfe } },
        { bit: 0x10, bytes: [0x9a, 0xbc], state: { x: 0x9abc } },
        { bit: 0x20, bytes: [0xde, 0xf0], state: { y: 0xdef0 } },
        { bit: 0x40, bytes: [0x13, 0x57], state: { [other]: 0x1357 } },
        { bit: 0x80, bytes: [0x24, 0x68], state: { pc: 0x2468 } },
      ];
      for (let mask = 0; mask < 256; mask++) {
        const ram = new ObservedRam();
        ram.write(0x1234, pull);
        ram.write(0x1235, mask);
        const selected = parts.filter(part => mask & part.bit);
        const frame = selected.flatMap(part => part.bytes);
        const reads = frame.map((value, offset) => ({
          kind: "read" as const, address: (start + offset) % 65_536, value,
        }));
        for (const { address, value } of reads) ram.write(address, value);
        ram.accesses.length = 0;
        const cpu = new Cpu6809(ram, before);
        let after = { ...before, pc: 0x1236, [stack]: (start + frame.length) % 65_536 };
        for (const part of selected) after = { ...after, ...part.state };
        after.d = after.a * 256 + after.b;
        const record = cpu.step();
        const context = `${stack}, start=${start}, mask=${mask}`;
        assert.deepEqual(record, {
          instruction: { address: 0x1234, bytes: [pull, mask] },
          before, after,
          accesses: [
            { kind: "read", address: 0x1234, value: pull },
            { kind: "read", address: 0x1235, value: mask },
            ...reads,
          ],
          outcome: "executed",
        }, context);
        assert.deepEqual(cpu.snapshot(), after, context);
        assert.deepEqual(ram.accesses, record.accesses, context);
        for (const { address, value } of reads) assert.equal(ram.read(address), value, context);
      }
    }
  }
});

test("6809 stack CC encoding handles every flag combination without forcing E or changing masks", () => {
  for (const { stack, push, pull } of stacks) {
    for (let cc = 0; cc < 256; cc++) {
      for (const mask of [0x01, 0xff]) {
        const ram = new ObservedRam();
        ram.write(0x1234, push);
        ram.write(0x1235, mask);
        const flags = flagsFor(cc);
        const cpu = new Cpu6809(ram, initialState({ [stack]: 0x8000, flags }));
        const pushed = cpu.step();
        assert.equal(pushed.outcome, "executed");
        assert.equal(ram.read(mask === 0x01 ? 0x7fff : 0x7ff4), cc);
        assert.deepEqual(pushed.after.flags, flags);
        assert.deepEqual(cpu.snapshot().flags, flags);

        // Pull a separately authored frame, not the preceding push's output.
        ram.write(0x1234, pull);
        ram.write(0x8000, cc);
        const receiver = new Cpu6809(ram, initialState({ [stack]: 0x8000, flags: flagsFor(255 - cc) }));
        const pulled = receiver.step();
        assert.equal(pulled.outcome, "executed");
        assert.deepEqual(pulled.after.flags, flags);
        assert.deepEqual(receiver.snapshot().flags, flags);
        assert.equal(pulled.after[stack], mask === 0x01 ? 0x8001 : 0x800c);
      }
    }
  }
});

test("6809 stack instructions fetch wrapping postbytes and save the following PC or resume at a pulled PC", () => {
  for (const { stack, push, pull } of stacks) {
    for (const [pc, postbyte, nextPc] of [[0xfffe, 0xffff, 0], [0xffff, 0, 1]] as const) {
      for (const opcode of [push, pull]) {
        const ram = new ObservedRam();
        ram.write(pc, opcode);
        ram.write(postbyte, 0x80);
        ram.write(0x4000, 0x9a);
        ram.write(0x4001, 0xbc);
        ram.write(0x9abc, 0x86);
        ram.write(0x9abd, 0xff);
        ram.accesses.length = 0;
        const before = { ...initialState({ pc, [stack]: 0x4000 }), d: 0x1134 };
        const cpu = new Cpu6809(ram, before);
        const after = {
          ...before, pc: opcode === push ? nextPc : 0x9abc, [stack]: opcode === push ? 0x3ffe : 0x4002,
        };
        const record = cpu.step();
        assert.deepEqual(record, {
          instruction: { address: pc, bytes: [opcode, 0x80] },
          before, after,
          accesses: [
            { kind: "read", address: pc, value: opcode },
            { kind: "read", address: postbyte, value: 0x80 },
            ...(opcode === push ? [
              { kind: "write", address: 0x3fff, value: nextPc },
              { kind: "write", address: 0x3ffe, value: 0x00 },
            ] : [
              { kind: "read", address: 0x4000, value: 0x9a },
              { kind: "read", address: 0x4001, value: 0xbc },
            ]),
          ],
          outcome: "executed",
        });
        assert.deepEqual(cpu.snapshot(), after);
        assert.deepEqual(ram.accesses, record.accesses);
        if (opcode === pull) {
          ram.accesses.length = 0;
          const resumed = cpu.step();
          assert.deepEqual(resumed, {
            instruction: { address: 0x9abc, bytes: [0x86, 0xff] },
            before: after,
            after: { ...after, pc: 0x9abe, a: 0xff, d: 0xff34, flags: { ...after.flags, n: true, z: false, v: false } },
            accesses: [
              { kind: "read", address: 0x9abc, value: 0x86 },
              { kind: "read", address: 0x9abd, value: 0xff },
            ],
            outcome: "executed",
          });
          assert.deepEqual(ram.accesses, resumed.accesses);
        }
      }
    }
  }
});

test("6809 nested saves restore mixed-width registers while preserving the flags from intervening operations", () => {
  for (const { stack, push, pull } of stacks) {
    const ram = new ObservedRam();
    const program = [push, 0x12, 0x86, 0x80, push, 0x02, 0x86, 0x00, pull, 0x02, pull, 0x12];
    for (const [address, value] of program.entries()) ram.write(address, value);
    let before = { ...initialState({ pc: 0, [stack]: 0x8000 }), d: 0x1134 };
    const cpu = new Cpu6809(ram, before);
    // The last two pulls retain Z=1 even as they restore nonzero A values.
    for (const [pc, a, pointer, n, z, v] of [
      [2, 0x11, 0x7ffd, true, false, true],
      [4, 0x80, 0x7ffd, true, false, false],
      [6, 0x80, 0x7ffc, true, false, false],
      [8, 0x00, 0x7ffc, false, true, false],
      [10, 0x80, 0x7ffd, false, true, false],
      [12, 0x11, 0x8000, false, true, false],
    ] as const) {
      ram.accesses.length = 0;
      const record = cpu.step();
      const after = { ...before, pc, a, d: a * 256 + 0x34, [stack]: pointer, flags: { ...before.flags, n, z, v } };
      assert.equal(record.outcome, "executed");
      assert.deepEqual(record.before, before);
      assert.deepEqual(record.after, after);
      assert.deepEqual(cpu.snapshot(), after);
      assert.deepEqual(ram.accesses, record.accesses);
      before = after;
    }
    assert.deepEqual([ram.read(0x7ffc), ram.read(0x7ffd), ram.read(0x7ffe), ram.read(0x7fff)],
      [0x80, 0x11, 0x23, 0x45]);
  }
});

test("6809 bit 6 transfers the other pointer even when S and U initially hold the same address", () => {
  for (const { stack, other, push, pull } of stacks) {
    const ram = new ObservedRam();
    ram.write(0x1234, push);
    ram.write(0x1235, 0x40);
    ram.write(0x1236, pull);
    ram.write(0x1237, 0x40);
    ram.write(0x1238, other === "s" ? 0x34 : 0x36);
    ram.write(0x1239, 0x02); // Use the newly loaded other pointer for a push of A.
    ram.accesses.length = 0;
    const before = { ...initialState({ s: 0x8000, u: 0x8000 }), d: 0x1134 };
    const cpu = new Cpu6809(ram, before);
    const afterPush = { ...before, pc: 0x1236, [stack]: 0x7ffe };
    assert.deepEqual(cpu.step(), {
      instruction: { address: 0x1234, bytes: [push, 0x40] },
      before, after: afterPush,
      accesses: [
        { kind: "read", address: 0x1234, value: push },
        { kind: "read", address: 0x1235, value: 0x40 },
        { kind: "write", address: 0x7fff, value: 0x00 },
        { kind: "write", address: 0x7ffe, value: 0x80 },
      ],
      outcome: "executed",
    });
    ram.write(0x7ffe, 0x01);
    ram.write(0x7fff, 0x00);
    ram.accesses.length = 0;
    const pulled = cpu.step();
    const afterPull = { ...before, pc: 0x1238, [other]: 0x0100 };
    assert.deepEqual(pulled, {
      instruction: { address: 0x1236, bytes: [pull, 0x40] },
      before: afterPush, after: afterPull,
      accesses: [
        { kind: "read", address: 0x1236, value: pull },
        { kind: "read", address: 0x1237, value: 0x40 },
        { kind: "read", address: 0x7ffe, value: 0x01 },
        { kind: "read", address: 0x7fff, value: 0x00 },
      ],
      outcome: "executed",
    });
    assert.deepEqual(ram.accesses, pulled.accesses);
    ram.accesses.length = 0;
    const usedOther = cpu.step();
    assert.deepEqual(usedOther.after, { ...afterPull, pc: 0x123a, [other]: 0x00ff });
    assert.deepEqual(ram.accesses, [
      { kind: "read", address: 0x1238, value: other === "s" ? 0x34 : 0x36 },
      { kind: "read", address: 0x1239, value: 0x02 },
      { kind: "write", address: 0x00ff, value: 0x11 },
    ]);
    assert.equal(ram.read(0x00ff), 0x11);
  }
});

test("6809 stack writes may overwrite both fetched bytes and pulls may reread them as data", () => {
  for (const { stack, other, push, pull } of stacks) {
    const ram = new ObservedRam();
    ram.write(0x0200, push);
    ram.write(0x0201, 0xff);
    ram.accesses.length = 0;
    const before = { ...initialState({ pc: 0x0200, [stack]: 0x0202 }), d: 0x1134 };
    const cpu = new Cpu6809(ram, before);
    const values = [0x02, 0x02, ...(other === "u" ? [0xef, 0xcd] : [0xab, 0x89]),
      0x67, 0x45, 0x45, 0x23, 0x56, 0x34, 0x11, 0xab];
    const record = cpu.step();
    assert.deepEqual(record, {
      instruction: { address: 0x0200, bytes: [push, 0xff] },
      before, after: { ...before, pc: 0x0202, [stack]: 0x01f6 },
      accesses: [
        { kind: "read", address: 0x0200, value: push },
        { kind: "read", address: 0x0201, value: 0xff },
        ...values.map((value, offset) => ({ kind: "write", address: 0x0201 - offset, value })),
      ],
      outcome: "executed",
    });
    assert.deepEqual(ram.accesses, record.accesses);
    assert.equal(ram.read(0x0200), 0x02);
    assert.equal(ram.read(0x0201), 0x02);

    ram.write(0x0200, pull);
    ram.write(0x0201, 0x06);
    ram.accesses.length = 0;
    const pullBefore = { ...initialState({ pc: 0x0200, [stack]: 0x0200 }), d: 0x1134 };
    const receiver = new Cpu6809(ram, pullBefore);
    const pulled = receiver.step();
    assert.deepEqual(pulled, {
      instruction: { address: 0x0200, bytes: [pull, 0x06] },
      before: pullBefore,
      after: { ...pullBefore, pc: 0x0202, [stack]: 0x0202, a: pull, b: 0x06, d: pull * 256 + 0x06 },
      accesses: [
        { kind: "read", address: 0x0200, value: pull },
        { kind: "read", address: 0x0201, value: 0x06 },
        { kind: "read", address: 0x0200, value: pull },
        { kind: "read", address: 0x0201, value: 0x06 },
      ],
      outcome: "executed",
    });
    assert.deepEqual(ram.accesses, pulled.accesses);
  }
});

test("6809 stack records own flags and values across RAM edits, later execution, reset, and caller edits", () => {
  for (const { stack, push, pull } of stacks) {
    const ram = new ObservedRam();
    for (const [address, value] of [push, 0x07, pull, 0x07, push, 0x07].entries()) ram.write(address, value);
    const cpu = new Cpu6809(ram, initialState({ pc: 0, [stack]: 0x8000 }));
    const pushed = cpu.step();
    const savedPush = structuredClone(pushed);
    ram.write(0x7ffd, 0x44); // CC: F and Z set, all other bits clear.
    ram.write(0x7ffe, 0x00);
    ram.write(0x7fff, 0xff);
    ram.accesses.length = 0;
    const pulled = cpu.step();
    const savedPull = structuredClone(pulled);
    assert.deepEqual(pulled.after, {
      ...savedPush.after, pc: 4, [stack]: 0x8000, a: 0, b: 0xff, d: 0x00ff, flags: flagsFor(0x44),
    });
    assert.deepEqual(ram.accesses, [
      { kind: "read", address: 2, value: pull },
      { kind: "read", address: 3, value: 0x07 },
      { kind: "read", address: 0x7ffd, value: 0x44 },
      { kind: "read", address: 0x7ffe, value: 0x00 },
      { kind: "read", address: 0x7fff, value: 0xff },
    ]);
    assert.deepEqual(pushed, savedPush);
    Reflect.set(pushed.before.flags, "e", false);
    assert.deepEqual(pushed.after, savedPush.after);
    Reflect.set(pulled.before.flags, "f", true);
    assert.deepEqual(pulled.after, savedPull.after);
    Reflect.set(pulled.after.flags, "z", false);
    Reflect.set(pulled.after, stack, 0);
    assert.ok(pulled.instruction);
    Reflect.set(pulled.instruction.bytes, 1, 0xff);
    assert.ok(pulled.accesses[2]);
    Reflect.set(pulled.accesses[2], "value", 0xff);
    assert.deepEqual(cpu.snapshot(), savedPull.after);
    const editedPull = structuredClone(pulled);
    assert.equal(cpu.step().outcome, "executed");
    assert.equal(ram.read(0x7ffd), 0x44);
    ram.write(0x7ffd, 0xff);
    cpu.reset();
    assert.deepEqual(pushed.after, savedPush.after);
    assert.deepEqual(pulled, editedPull);
  }
});

test("6809 immediate LDB loads every byte, updates D and N/Z/V, and preserves all other state", () => {
  const ram = new ObservedRam();
  for (const [pc, operandAddress, nextPc] of [[0x1234, 0x1235, 0x1236], [0xffff, 0, 1]] as const) {
    ram.write(pc, 0xc6);
    for (let value = 0; value < 256; value++) {
      ram.write(operandAddress, value);
      for (let cc = 0; cc < 256; cc++) {
        const flags = flagsFor(cc);
        const before = { ...initialState({ pc, flags }), d: 0x1134 };
        const cpu = new Cpu6809(ram, before);
        ram.accesses.length = 0;
        const record = cpu.step();
        assert.deepEqual(record, {
          instruction: { address: pc, bytes: [0xc6, value] }, before,
          after: { ...before, b: value, d: 0x1100 + value, pc: nextPc,
            flags: { ...flags, n: value >= 128, z: value === 0, v: false } },
          accesses: [
            { kind: "read", address: pc, value: 0xc6 },
            { kind: "read", address: operandAddress, value },
          ],
          outcome: "executed",
        });
        assert.deepEqual(cpu.snapshot(), record.after);
        assert.deepEqual(ram.accesses, record.accesses);
      }
    }
  }
});

for (const [mnemonic, opcode, register, delta] of [
  ["INCA", 0x4c, "a", 1], ["DECA", 0x4a, "a", -1],
  ["INCB", 0x5c, "b", 1], ["DECB", 0x5a, "b", -1],
] as const) {
  test(`6809 ${mnemonic} wraps every byte, replaces N/Z/V, preserves E/F/H/I/C, and updates D`, () => {
    const ram = new ObservedRam();
    ram.write(0xffff, opcode);
    for (let value = 0; value < 256; value++) {
      const result = (value + delta + 256) % 256;
      const signedResult = (value < 128 ? value : value - 256) + delta;
      for (let cc = 0; cc < 256; cc++) {
        const flags = flagsFor(cc);
        const before = {
          ...initialState({ pc: 0xffff, [register]: value, flags }),
          d: register === "a" ? value * 256 + 0x34 : 0x1100 + value,
        };
        const cpu = new Cpu6809(ram, before);
        ram.accesses.length = 0;
        const record = cpu.step();
        assert.deepEqual(record, {
          instruction: { address: 0xffff, bytes: [opcode] }, before,
          after: { ...before, [register]: result, pc: 0,
            d: register === "a" ? result * 256 + 0x34 : 0x1100 + result,
            flags: { ...flags, n: result >= 128, z: result === 0, v: signedResult < -128 || signedResult > 127 } },
          accesses: [{ kind: "read", address: 0xffff, value: opcode }],
          outcome: "executed",
        });
        assert.deepEqual(cpu.snapshot(), record.after);
        assert.deepEqual(ram.accesses, record.accesses);
      }
    }
  });
}

// Literal truth sets for the low CC nibble N Z V C, independent of dispatch
// construction and its paired predicates. Aliases BHS/BLO share BCC/BCS bytes.
const branchCases: readonly { mnemonic: string; opcode: number; takenCodes: readonly number[] }[] = [
  { mnemonic: "BRA", opcode: 0x20, takenCodes: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] },
  { mnemonic: "BRN", opcode: 0x21, takenCodes: [] },
  { mnemonic: "BHI", opcode: 0x22, takenCodes: [0, 2, 8, 10] },
  { mnemonic: "BLS", opcode: 0x23, takenCodes: [1, 3, 4, 5, 6, 7, 9, 11, 12, 13, 14, 15] },
  { mnemonic: "BCC/BHS", opcode: 0x24, takenCodes: [0, 2, 4, 6, 8, 10, 12, 14] },
  { mnemonic: "BCS/BLO", opcode: 0x25, takenCodes: [1, 3, 5, 7, 9, 11, 13, 15] },
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
  test(`6809 ${mnemonic} follows its truth table for every CC value and fetches the operand on every path`, () => {
    const ram = new ObservedRam();
    // Independently calculated targets: displacement extremes, instruction overlap,
    // both page crossings, both address-space crossings, and wrapped operand fetch.
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
      for (let cc = 0; cc < 256; cc++) {
        const before = { ...initialState({ pc, flags: flagsFor(cc) }), d: 0x1134 };
        const cpu = new Cpu6809(ram, before);
        ram.accesses.length = 0;
        const record = cpu.step();
        assert.deepEqual(record, {
          instruction: { address: pc, bytes: [opcode, displacement] }, before,
          after: { ...before, pc: takenCodes.includes(cc % 16) ? target : fallthrough },
          accesses: [
            { kind: "read", address: pc, value: opcode },
            { kind: "read", address: operandAddress, value: displacement },
          ],
          outcome: "executed",
        });
        assert.deepEqual(cpu.snapshot(), record.after);
        assert.deepEqual(ram.accesses, record.accesses);
      }
    }
  });
}

test("6809 short branches interpret every displacement relative to the address after the operand", () => {
  const ram = new ObservedRam();
  const operand = new DataView(new ArrayBuffer(1));
  for (const { opcode, takenCodes } of branchCases) {
    const untakenCode = Array.from({ length: 16 }, (_, cc) => cc).find(cc => !takenCodes.includes(cc));
    // BRA has only a taken path; BRN only an untaken path.
    for (const cc of [takenCodes[0], untakenCode]) {
      if (cc === undefined) continue;
      for (const pc of [0, 0x1234, 0xffff]) {
        ram.write(pc, opcode);
        for (let displacement = 0; displacement < 256; displacement++) {
          ram.write((pc + 1) % 65536, displacement);
          operand.setUint8(0, displacement);
          const before: Cpu6809Snapshot = { ...initialState({ pc, flags: flagsFor(cc) }), d: 0x1134 };
          const cpu = new Cpu6809(ram, before);
          ram.accesses.length = 0;
          const record = cpu.step();
          const target: number = (pc + 2 + (takenCodes.includes(cc) ? operand.getInt8(0) : 0) + 65536) % 65536;
          assert.equal(record.outcome, "executed");
          assert.deepEqual(record.after, { ...before, pc: target });
          assert.deepEqual(record.instruction, { address: pc, bytes: [opcode, displacement] });
          assert.deepEqual(record.accesses, [
            { kind: "read", address: pc, value: opcode },
            { kind: "read", address: (pc + 1) % 65536, value: displacement },
          ]);
          assert.deepEqual(ram.accesses, record.accesses);
        }
      }
    }
  }
});

test("6809 signed branches use current overflow after DECB and current CC after a stack pull", () => {
  const ram = new ObservedRam();
  for (const [offset, byte] of [0xc6, 0x80, 0x5a, 0x2d, 2, 0, 0, 0x35, 1, 0x26, 0xfe].entries()) {
    ram.write(0x0200 + offset, byte);
  }
  ram.write(0x8000, 0x04); // PULS CC replaces the flag object with Z set.
  const cpu = new Cpu6809(ram, initialState({ pc: 0x0200, s: 0x8000 }));
  const loaded = cpu.step();
  assert.equal(loaded.after.b, 0x80);
  assert.deepEqual(loaded.after.flags, { ...initialState().flags, n: true, z: false, v: false });
  const decremented = cpu.step();
  assert.deepEqual(decremented.after, {
    ...loaded.after, b: 0x7f, d: 0x117f, pc: 0x0203,
    flags: { ...loaded.after.flags, n: false, z: false, v: true },
  });
  ram.accesses.length = 0;
  const branch = cpu.step(); // BLT must take the branch even though N is clear.
  assert.deepEqual(branch, {
    instruction: { address: 0x0203, bytes: [0x2d, 2] }, before: decremented.after,
    after: { ...decremented.after, pc: 0x0207 },
    accesses: [{ kind: "read", address: 0x0203, value: 0x2d }, { kind: "read", address: 0x0204, value: 2 }],
    outcome: "executed",
  });
  assert.deepEqual(ram.accesses, branch.accesses);
  const pulled = cpu.step();
  assert.deepEqual(pulled.after, { ...branch.after, pc: 0x0209, s: 0x8001, flags: flagsFor(0x04) });
  const next = cpu.step();
  assert.deepEqual(next.after, { ...pulled.after, pc: 0x020b }); // BNE is now untaken.
  assert.deepEqual(next.instruction?.bytes, [0x26, 0xfe]);
  const saved = structuredClone([loaded, decremented, branch, pulled, next]);
  cpu.reset();
  ram.write(0x0204, 0xff);
  assert.deepEqual([loaded, decremented, branch, pulled, next], saved);
});

test("6809 branches fetch current operands and return records isolated from caller edits", () => {
  const ram = new ObservedRam();
  ram.write(0x1234, 0x26);
  ram.write(0x1235, 0xfe); // BNE to itself
  const cpu = new Cpu6809(ram, initialState());
  const first = cpu.step();
  const savedFirst = structuredClone(first);
  assert.equal(first.after.pc, 0x1234);
  ram.write(0x1235, 0);
  const next = cpu.step();
  assert.deepEqual(next.instruction?.bytes, [0x26, 0]);
  assert.equal(next.after.pc, 0x1236);
  assert.deepEqual(first, savedFirst);
  const savedNext = structuredClone(next);
  Reflect.set(first.after.flags, "z", true);
  Reflect.set(first.after, "d", 0);
  assert.ok(first.instruction);
  Reflect.set(first.instruction.bytes, 1, 0x80);
  assert.ok(first.accesses[1]);
  Reflect.set(first.accesses[1], "value", 0xff);
  assert.deepEqual(cpu.snapshot(), savedNext.after);
  cpu.reset();
  ram.write(0x1235, 0xff);
  assert.deepEqual(next, savedNext);
});

// Literal supported base-page encodings; prefix selectors are not instruction forms.
const baseOpcodes = new Set([
  0x13, 0x3b, 0x3c, 0x3f,
      0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x2b, 0x2c, 0x2d, 0x2e, 0x2f,
      0x00, 0x03, 0x04, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0c, 0x0d, 0x0e, 0x0f,
      0x12, 0x16, 0x17, 0x34, 0x35, 0x36, 0x37, 0x39,
      0x40, 0x43, 0x44, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x4c, 0x4d, 0x4f,
      0x50, 0x53, 0x54, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x5c, 0x5d, 0x5f,
      0x60, 0x63, 0x64, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x6c, 0x6d, 0x6e, 0x6f,
      0xa0, 0xa1, 0xa2, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xab, 0xad,
      0xe0, 0xe1, 0xe2, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xeb,
      0x8e, 0x9e, 0x9f, 0xae, 0xaf, 0xbe, 0xbf,
      0xcc, 0xdc, 0xdd, 0xec, 0xed, 0xfc, 0xfd,
      0xce, 0xde, 0xdf, 0xee, 0xef, 0xfe, 0xff,
      0x70, 0x73, 0x74, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x7c, 0x7d, 0x7e, 0x7f,
      0x80, 0x81, 0x82, 0x84, 0x85, 0x86, 0x88, 0x89, 0x8a, 0x8b, 0x8d,
      0x90, 0x91, 0x92, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0x9b, 0x9d,
      0xb0, 0xb1, 0xb2, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xbb, 0xbd,
      0xc0, 0xc1, 0xc2, 0xc4, 0xc5, 0xc6, 0xc8, 0xc9, 0xca, 0xcb,
      0xd0, 0xd1, 0xd2, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xdb,
      0xf0, 0xf1, 0xf2, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa, 0xfb,
      0x19, 0x1a, 0x1c, 0x1d, 0x1e, 0x1f, 0x30, 0x31, 0x32, 0x33, 0x3a, 0x3d,
      0x83, 0x93, 0xa3, 0xb3, 0xc3, 0xd3, 0xe3, 0xf3, 0x8c, 0x9c, 0xac, 0xbc,
]);

test("every unsupported 6809 base byte repeatedly reads only itself without advancing PC", () => {
  for (let opcode = 0; opcode <= 0xff; opcode++) {
    if (baseOpcodes.has(opcode) || opcode === 0x10 || opcode === 0x11) continue;
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
  for (const opcode of [0x01, 0x10, 0x11]) {
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
  assert.ok(first.instruction);
  Reflect.set(first.instruction.bytes, "0", 0);
  assert.ok(first.accesses[0]);
  Reflect.set(first.accesses[0], "value", 0);
  Reflect.set(first.accesses, "length", 0);
  assert.deepEqual(second, savedSecond);
  assert.deepEqual(cpu.snapshot(), savedSecond.after);
});

test("6809 reset changes PC, DP, F, I, and control state and reads the vector high byte first", () => {
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
        const after = { ...before, pc: 0x3456, dp: 0, nmiArmed: false, flags: { ...preserved, f: true, i: true } };
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
    const afterReset = { ...before, pc, dp: 0, nmiArmed: false, flags: { ...before.flags, f: true, i: true } };
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

// Feed CC/A/B through real PULU instructions, then loop through the instruction
// under test. A fresh CPU every 512 cases keeps the input frames away from code
// and data while avoiding millions of identical dispatch-table constructions.
function byteProgram(bytes: readonly number[]) {
  const ram = new Ram(0x10000);
  [0x37, 0x07, ...bytes, 0x7e, 0x01, 0x00].forEach((byte, offset) => ram.write(0x100 + offset, byte));
  let cpu: Cpu6809;
  let frame = 512;
  return {
    ram,
    run(a: number, b: number, cc: number) {
      if (frame === 512) {
        cpu = new Cpu6809(ram, initialState({ pc: 0x100, u: 0x8000 }));
        frame = 0;
      }
      const address = 0x8000 + frame++ * 3;
      ram.write(address, cc);
      ram.write(address + 1, a);
      ram.write(address + 2, b);
      assert.equal(cpu.step().outcome, "executed"); // PULU CC,A,B
      const record = cpu.step();
      assert.equal(record.outcome, "executed");
      assert.deepEqual(record.before, {
        ...initialState({ pc: 0x102, u: address + 3, a, b, flags: flagsFor(cc) }), d: a * 256 + b,
      });
      assert.equal(cpu.step().after.pc, 0x100); // JMP back to the input instruction.
      return record;
    },
  };
}

function byteArithmetic(operation: string, left: number, right: number, flags: Cpu6809Flags) {
  const subtract = operation === "SUB" || operation === "SBC" || operation === "CMP";
  const carry = (operation === "ADC" || operation === "SBC") && flags.c ? 1 : 0;
  const signed = (value: number) => value < 128 ? value : value - 256;
  const total = subtract ? left - right - carry : left + right + carry;
  const signedTotal = subtract ? signed(left) - signed(right) - carry : signed(left) + signed(right) + carry;
  const result = (total + 256) % 256;
  return {
    result,
    flags: { ...flags, n: result >= 128, z: result === 0,
      v: signedTotal < -128 || signedTotal > 127, c: subtract ? total < 0 : total > 255,
      h: subtract ? flags.h : left % 16 + right % 16 + carry > 15 },
  };
}

for (const [operation, opcodeA, opcodeB] of [
  ["SUB", 0x80, 0xc0], ["CMP", 0x81, 0xc1], ["SBC", 0x82, 0xc2],
  ["ADC", 0x89, 0xc9], ["ADD", 0x8b, 0xcb],
] as const) {
  test(`6809 ${operation} A/B agrees with signed and unsigned arithmetic for every byte pair and carry`, () => {
    for (const [register, opcode] of [["a", opcodeA], ["b", opcodeB]] as const) {
      const program = byteProgram([opcode, 0]);
      for (let right = 0; right < 256; right++) {
        program.ram.write(0x103, right);
        for (let left = 0; left < 256; left++) {
          for (const cc of [0x00, 0xff]) {
            const { result, flags } = byteArithmetic(operation, left, right, flagsFor(cc));
            const record = program.run(register === "a" ? left : 0x69, register === "b" ? left : 0x96, cc);
            const value = operation === "CMP" ? left : result;
            const a = register === "a" ? value : 0x69;
            const b = register === "b" ? value : 0x96;
            assert.deepEqual(record.after, { ...record.before, [register]: value, d: a * 256 + b, pc: 0x104, flags },
              `${operation} ${register}, left=${left}, right=${right}, CC=${cc}`);
          }
        }
      }
    }
  });
}

// Literal opcode rows from Motorola Appendix D, independent of the source builders.
const accumulatorForms = [
  ["SUB", "a", 0x80, 0x90, 0xa0, 0xb0], ["SUB", "b", 0xc0, 0xd0, 0xe0, 0xf0],
  ["CMP", "a", 0x81, 0x91, 0xa1, 0xb1], ["CMP", "b", 0xc1, 0xd1, 0xe1, 0xf1],
  ["SBC", "a", 0x82, 0x92, 0xa2, 0xb2], ["SBC", "b", 0xc2, 0xd2, 0xe2, 0xf2],
  ["AND", "a", 0x84, 0x94, 0xa4, 0xb4], ["AND", "b", 0xc4, 0xd4, 0xe4, 0xf4],
  ["BIT", "a", 0x85, 0x95, 0xa5, 0xb5], ["BIT", "b", 0xc5, 0xd5, 0xe5, 0xf5],
  ["LD", "a", 0x86, 0x96, 0xa6, 0xb6], ["LD", "b", 0xc6, 0xd6, 0xe6, 0xf6],
  ["EOR", "a", 0x88, 0x98, 0xa8, 0xb8], ["EOR", "b", 0xc8, 0xd8, 0xe8, 0xf8],
  ["ADC", "a", 0x89, 0x99, 0xa9, 0xb9], ["ADC", "b", 0xc9, 0xd9, 0xe9, 0xf9],
  ["OR", "a", 0x8a, 0x9a, 0xaa, 0xba], ["OR", "b", 0xca, 0xda, 0xea, 0xfa],
  ["ADD", "a", 0x8b, 0x9b, 0xab, 0xbb], ["ADD", "b", 0xcb, 0xdb, 0xeb, 0xfb],
] as const;

function byteLogic(operation: string, left: number, right: number): number {
  if (operation === "LD") return right;
  const a = left.toString(2).padStart(8, "0");
  const b = right.toString(2).padStart(8, "0");
  return parseInt([...a].map((bit, index) => {
    if (operation === "AND" || operation === "BIT") return bit === "1" && b[index] === "1" ? "1" : "0";
    if (operation === "OR") return bit === "1" || b[index] === "1" ? "1" : "0";
    return bit !== b[index] ? "1" : "0";
  }).join(""), 2);
}

for (const [operation, register, immediate, direct, indexed, extended] of accumulatorForms) {
  test(`6809 ${operation}${register.toUpperCase()} covers all four operand forms, flags, and wrapped fetches`, () => {
    for (const [opcode, operands, address] of [
      [immediate, [0], undefined], [direct, [0xff], 0x56ff],
      [indexed, [0x84], 0x2345], [extended, [0x12, 0xff], 0x12ff],
    ] as const) {
      const ram = new ObservedRam();
      for (const [left, right] of [[0, 0], [0x7f, 1], [0x80, 1], [0xff, 0xff], [0x55, 0xaa], [0x81, 0x0f]]) {
        for (let cc = 0; cc < 256; cc++) {
          const flags = flagsFor(cc);
          const bytes = [opcode, ...(address === undefined ? [right!] : operands)];
          bytes.forEach((byte, offset) => ram.write((0xffff + offset) % 0x10000, byte));
          if (address !== undefined) ram.write(address, right!);
          const before = initialState({ pc: 0xffff, [register]: left, flags });
          const cpu = new Cpu6809(ram, before);
          ram.accesses.length = 0;
          const record = cpu.step();
          const arithmetic = ["SUB", "CMP", "SBC", "ADC", "ADD"].includes(operation);
          const expected = arithmetic ? byteArithmetic(operation, left!, right!, flags) : (() => {
            const result = byteLogic(operation, left!, right!);
            return { result, flags: { ...flags, n: result >= 128, z: result === 0, v: false } };
          })();
          const value = operation === "CMP" || operation === "BIT" ? left! : expected.result;
          const a = register === "a" ? value : before.a;
          const b = register === "b" ? value : before.b;
          assert.deepEqual(record, {
            instruction: { address: 0xffff, bytes }, before: { ...before, d: before.a * 256 + before.b },
            after: { ...before, [register]: value, d: a * 256 + b, pc: bytes.length - 1, flags: expected.flags },
            accesses: [
              ...bytes.map((value, offset) => ({ kind: "read", address: (0xffff + offset) % 0x10000, value })),
              ...(address === undefined ? [] : [{ kind: "read", address, value: right }]),
            ], outcome: "executed",
          });
          assert.deepEqual(ram.accesses, record.accesses);
        }
      }
    }
  });
}

for (const [operation, direct, opcodeA, opcodeB, indexed, extended] of [
  ["NEG", 0x00, 0x40, 0x50, 0x60, 0x70], ["COM", 0x03, 0x43, 0x53, 0x63, 0x73],
  ["LSR", 0x04, 0x44, 0x54, 0x64, 0x74], ["ROR", 0x06, 0x46, 0x56, 0x66, 0x76],
  ["ASR", 0x07, 0x47, 0x57, 0x67, 0x77], ["ASL", 0x08, 0x48, 0x58, 0x68, 0x78],
  ["ROL", 0x09, 0x49, 0x59, 0x69, 0x79], ["DEC", 0x0a, 0x4a, 0x5a, 0x6a, 0x7a],
  ["INC", 0x0c, 0x4c, 0x5c, 0x6c, 0x7c], ["TST", 0x0d, 0x4d, 0x5d, 0x6d, 0x7d],
  ["CLR", 0x0f, 0x4f, 0x5f, 0x6f, 0x7f],
] as const) {
  test(`6809 ${operation} covers A, B, direct, indexed, and extended for every byte and CC value`, () => {
    for (const [register, opcode, operands, address] of [
      ["a", opcodeA, [], undefined], ["b", opcodeB, [], undefined],
      [undefined, direct, [0xff], 0x56ff], [undefined, indexed, [0x84], 0x2345],
      [undefined, extended, [0x12, 0xff], 0x12ff],
    ] as const) {
      const program = byteProgram([opcode, ...operands]);
      for (let value = 0; value < 256; value++) {
        for (let cc = 0; cc < 256; cc++) {
          const flags = flagsFor(cc);
          let result = value;
          let v = false;
          let c = flags.c;
          switch (operation) {
            case "NEG": result = (256 - value) % 256; v = value === 128; c = value !== 0; break;
            case "COM": result = 255 - value; c = true; break;
            case "LSR": result = Math.floor(value / 2); c = value % 2 === 1; v = flags.v; break;
            case "ROR": result = Math.floor(value / 2) + (flags.c ? 128 : 0); c = value % 2 === 1; v = flags.v; break;
            case "ASR": result = Math.floor(value / 2) + (value >= 128 ? 128 : 0); c = value % 2 === 1; v = flags.v; break;
            case "ASL": case "ROL": {
              const total = value * 2 + (operation === "ROL" && flags.c ? 1 : 0);
              result = total % 256; c = total >= 256; v = (value >= 64 && value < 192); break;
            }
            case "DEC": result = (value + 255) % 256; v = value === 128; break;
            case "INC": result = (value + 1) % 256; v = value === 127; break;
            case "CLR": result = 0; c = false; break;
          }
          if (address !== undefined) program.ram.write(address, value);
          const record = program.run(register === "a" ? value : 0x69, register === "b" ? value : 0x96, cc);
          const a = register === "a" ? result : 0x69;
          const b = register === "b" ? result : 0x96;
          assert.deepEqual(record.after, { ...record.before, a, b, d: a * 256 + b,
            pc: 0x103 + operands.length, flags: { ...flags, n: result >= 128, z: result === 0, v, c } },
          `${operation} ${opcode.toString(16)}, value=${value}, CC=${cc}`);
          assert.deepEqual(record.accesses, [
            ...[opcode, ...operands].map((value, offset) => ({ kind: "read", address: 0x102 + offset, value })),
            ...(address === undefined ? [] : [{ kind: "read", address, value }]),
            ...(address === undefined || operation === "TST" ? [] : [{ kind: "write", address, value: result }]),
          ]);
          if (address !== undefined) assert.equal(program.ram.read(address), result);
        }
      }
    }
  });
}

for (const [register, opcode, operands, address] of [
  ["a", 0x97, [0xff], 0x56ff], ["b", 0xd7, [0xff], 0x56ff],
  ["a", 0xa7, [0x84], 0x2345], ["b", 0xe7, [0x84], 0x2345],
  ["a", 0xb7, [0x12, 0xff], 0x12ff], ["b", 0xf7, [0x12, 0xff], 0x12ff],
] as const) {
  test(`6809 store ${opcode.toString(16)} writes every byte once and updates only N/Z/V for every CC`, () => {
    const program = byteProgram([opcode, ...operands]);
    for (let value = 0; value < 256; value++) {
      for (let cc = 0; cc < 256; cc++) {
        program.ram.write(address, value); // An unchanged-value store still writes.
        const record = program.run(register === "a" ? value : 0x69, register === "b" ? value : 0x96, cc);
        assert.deepEqual(record.after, { ...record.before, pc: 0x103 + operands.length,
          flags: { ...flagsFor(cc), n: value >= 128, z: value === 0, v: false } });
        assert.deepEqual(record.accesses, [
          ...[opcode, ...operands].map((value, offset) => ({ kind: "read", address: 0x102 + offset, value })),
          { kind: "write", address, value },
        ]);
        assert.equal(program.ram.read(address), value);
      }
    }
  });
}

test("6809 memory unary instructions capture operands before modifying overlapping code, with real CLR reads and no TST writes", () => {
  for (const [opcode, extended, write] of [
    [0x00, false, true], [0x03, false, true], [0x04, false, true], [0x06, false, true],
    [0x07, false, true], [0x08, false, true], [0x09, false, true], [0x0a, false, true],
    [0x0c, false, true], [0x0d, false, false], [0x0f, false, true],
    [0x70, true, true], [0x73, true, true], [0x74, true, true], [0x76, true, true],
    [0x77, true, true], [0x78, true, true], [0x79, true, true], [0x7a, true, true],
    [0x7c, true, true], [0x7d, true, false], [0x7f, true, true],
  ] as const) {
    for (const address of [0xfffe, 0xffff, 0x0000]) {
      const ram = new ObservedRam();
      const bytes = extended ? [opcode, address >>> 8, address % 256] : [opcode, address % 256];
      bytes.forEach((value, offset) => ram.write((0xfffe + offset) % 0x10000, value));
      const old = ram.read(address);
      const cpu = new Cpu6809(ram, initialState({ pc: 0xfffe, dp: address >>> 8 }));
      ram.accesses.length = 0;
      const record = cpu.step();
      assert.equal(record.outcome, "executed");
      assert.deepEqual(record.instruction, { address: 0xfffe, bytes });
      assert.equal(record.after.pc, extended ? 1 : 0);
      assert.deepEqual(record.accesses, ram.accesses);
      assert.deepEqual(record.accesses.slice(0, bytes.length + 1), [
        ...bytes.map((value, offset) => ({ kind: "read", address: (0xfffe + offset) % 0x10000, value })),
        { kind: "read", address, value: old },
      ]);
      assert.equal(record.accesses.length, bytes.length + (write ? 2 : 1));
      if (write) assert.deepEqual(record.accesses.at(-1), { kind: "write", address, value: ram.read(address) });
      else assert.equal(ram.read(address), old);
    }
  }
});

test("6809 BSR, LBSR, and JSR fetch the complete operand before stacking the return PC on S", () => {
  const cases = [
    { bytes: [0x8d, 0x00], pc: 0x1200, target: 0x1202 },
    { bytes: [0x8d, 0x7f], pc: 0xfffd, target: 0x007e },
    { bytes: [0x8d, 0x80], pc: 0x0000, target: 0xff82 },
    { bytes: [0x8d, 0xfe], pc: 0xffff, target: 0xffff },
    { bytes: [0x17, 0x00, 0x00], pc: 0x1200, target: 0x1203 },
    { bytes: [0x17, 0x7f, 0xff], pc: 0xfffe, target: 0x8000 },
    { bytes: [0x17, 0x80, 0x00], pc: 0xffff, target: 0x8002 },
    { bytes: [0x17, 0xff, 0xfd], pc: 0xfffe, target: 0xfffe },
    { bytes: [0x9d, 0xff], pc: 0xffff, target: 0x56ff },
    { bytes: [0xbd, 0x12, 0x34], pc: 0xfffe, target: 0x1234 },
    { bytes: [0xbd, 0xff, 0xff], pc: 0xffff, target: 0xffff },
  ];
  for (const { bytes, pc, target } of cases) {
    for (const s of [0x8000, 0, 1, (pc + 2) % 0x10000]) {
      for (let cc = 0; cc < 256; cc++) {
        const ram = new ObservedRam();
        bytes.forEach((value, offset) => ram.write((pc + offset) % 0x10000, value));
        const before = { ...initialState({ pc, s, flags: flagsFor(cc) }), d: 0x1134 };
        const cpu = new Cpu6809(ram, before);
        ram.accesses.length = 0;
        const lowAddress = (s + 0xffff) % 0x10000;
        const highAddress = (s + 0xfffe) % 0x10000;
        const returnAddress = (pc + bytes.length) % 0x10000;
        const record = cpu.step();
        assert.deepEqual(record, {
          instruction: { address: pc, bytes }, before, after: { ...before, pc: target, s: highAddress },
          accesses: [
            ...bytes.map((value, offset) => ({ kind: "read", address: (pc + offset) % 0x10000, value })),
            { kind: "write", address: lowAddress, value: returnAddress % 256 },
            { kind: "write", address: highAddress, value: Math.floor(returnAddress / 256) },
          ], outcome: "executed",
        });
        assert.deepEqual(ram.accesses, record.accesses);
      }
    }
  }
});

test("6809 RTS pulls a high/low word from S, wraps the stack, preserves CC, and never increments the return address", () => {
  for (const [s, target] of [[0x8000, 0], [0xffff, 0xffff], [0, 0x1234], [0x1234, 0x39ab]]) {
    for (let cc = 0; cc < 256; cc++) {
      const ram = new ObservedRam();
      ram.write(0x1234, 0x39);
      ram.write(s!, Math.floor(target! / 256));
      ram.write((s! + 1) % 0x10000, target! % 256);
      const before = { ...initialState({ s, flags: flagsFor(cc) }), d: 0x1134 };
      const cpu = new Cpu6809(ram, before);
      ram.accesses.length = 0;
      const record = cpu.step();
      assert.deepEqual(record, {
        instruction: { address: 0x1234, bytes: [0x39] }, before,
        after: { ...before, s: (s! + 2) % 0x10000, pc: target },
        accesses: [
          { kind: "read", address: 0x1234, value: 0x39 },
          { kind: "read", address: s, value: Math.floor(target! / 256) },
          { kind: "read", address: (s! + 1) % 0x10000, value: target! % 256 },
        ], outcome: "executed",
      });
      assert.deepEqual(ram.accesses, record.accesses);
    }
  }
});

test("6809 NOP, LBRA, and direct/extended JMP preserve all flags and read only their instruction bytes", () => {
  for (const [bytes, pc, target] of [
    [[0x12], 0xffff, 0],
    [[0x16, 0, 0], 0xfffe, 1], [[0x16, 0x7f, 0xff], 0xffff, 0x8001],
    [[0x16, 0x80, 0], 0xfffe, 0x8001], [[0x16, 0xff, 0xfd], 0xffff, 0xffff],
    [[0x0e, 0xff], 0xffff, 0x56ff], [[0x7e, 0x12, 0x34], 0xfffe, 0x1234],
    [[0x7e, 0xff, 0xff], 0xffff, 0xffff],
  ] as const) {
    for (let cc = 0; cc < 256; cc++) {
      const ram = new ObservedRam();
      bytes.forEach((value, offset) => ram.write((pc + offset) % 0x10000, value));
      const before = { ...initialState({ pc, flags: flagsFor(cc) }), d: 0x1134 };
      const cpu = new Cpu6809(ram, before);
      ram.accesses.length = 0;
      const record = cpu.step();
      assert.deepEqual(record, {
        instruction: { address: pc, bytes }, before, after: { ...before, pc: target },
        accesses: bytes.map((value, offset) => ({ kind: "read", address: (pc + offset) % 0x10000, value })),
        outcome: "executed",
      });
      assert.deepEqual(ram.accesses, record.accesses);
    }
  }
});

// Independently transcribed from Motorola Table 2-1. Only 9F is extended indirect;
// PC-relative rows explicitly ignore the two register-selection bits.
function indexedForms(a: number, b: number, offset8: number, offset16: number) {
  const forms: {
    postbyte: number; operands: number[]; register: "x" | "y" | "u" | "s";
    offset: number; update: number; indirect: boolean; relative?: boolean; absolute?: boolean;
  }[] = [];
  const byte = (offset8 + 256) % 256;
  const word = (offset16 + 65536) % 65536;
  const wordBytes = [Math.floor(word / 256), word % 256];
  for (const [rr, register] of (["x", "y", "u", "s"] as const).entries()) {
    for (let offset = -16; offset <= 15; offset++) {
      forms.push({ postbyte: rr * 32 + (offset + 32) % 32, register,
        operands: [], offset, update: 0, indirect: false });
    }
    const rows = [
      { direct: 0x80, offset: 0, update: 1 },
      { direct: 0x81, indirect: 0x91, offset: 0, update: 2 },
      { direct: 0x82, offset: -1, update: -1 },
      { direct: 0x83, indirect: 0x93, offset: -2, update: -2 },
      { direct: 0x84, indirect: 0x94, offset: 0 },
      { direct: 0x85, indirect: 0x95, offset: b < 128 ? b : b - 256 },
      { direct: 0x86, indirect: 0x96, offset: a < 128 ? a : a - 256 },
      { direct: 0x88, indirect: 0x98, offset: offset8, operands: [byte] },
      { direct: 0x89, indirect: 0x99, offset: offset16, operands: wordBytes },
      { direct: 0x8b, indirect: 0x9b, offset: a * 256 + b },
      { direct: 0x8c, indirect: 0x9c, offset: offset8, operands: [byte], relative: true },
      { direct: 0x8d, indirect: 0x9d, offset: offset16, operands: wordBytes, relative: true },
    ];
    for (const row of rows) {
      for (const indirect of [false, true]) {
        const code = indirect ? row.indirect : row.direct;
        if (code === undefined) continue;
        forms.push({ postbyte: code + rr * 32, register, operands: row.operands ?? [],
          offset: row.offset, update: row.update ?? 0, indirect, relative: row.relative ?? false });
      }
    }
  }
  forms.push({ postbyte: 0x9f, register: "x", operands: wordBytes,
    offset: word, update: 0, indirect: true, absolute: true });
  return forms;
}

const wrapAddress = (value: number) => ((value % 65536) + 65536) % 65536;

const memoryShiftEncodings = [
  ["LSR", 0x04, 0x64, 0x74], ["ROR", 0x06, 0x66, 0x76], ["ASR", 0x07, 0x67, 0x77],
  ["ASL", 0x08, 0x68, 0x78], ["ROL", 0x09, 0x69, 0x79],
] as const;

// Move printed binary digits; overflow is independently checked against signed doubling limits.
function shiftedMemory(name: typeof memoryShiftEncodings[number][0], value: number, flags: Cpu6809Flags) {
  const bits = value.toString(2).padStart(8, "0"), left = name === "ASL" || name === "ROL";
  const incoming = name === "ASR" ? bits[0]! : name === "ROL" || name === "ROR" ? String(Number(flags.c)) : "0";
  const result = Number.parseInt(left ? bits.slice(1) + incoming : incoming + bits.slice(0, -1), 2);
  return { result, flags: { ...flags, n: result >= 128, z: result === 0,
    c: (left ? bits[0] : bits[7]) === "1", v: left ? value >= 64 && value < 192 : flags.v } };
}

test("6809 memory shifts cover every indexed postbyte, including wrapping, overlap, and S updates", () => {
  for (const [name, , opcode] of memoryShiftEncodings) {
    for (const [a, b, offset8, offset16] of [[0x80, 0xff, -128, -32768], [0, 1, -1, -1]] as const) {
      for (const form of indexedForms(a, b, offset8, offset16)) for (const base of [0, 0xffff]) {
        const pc = base === 0 ? 0xffff : 0xfffd, bytes = [opcode, form.postbyte, ...form.operands];
        const state = initialState({ a, b, pc, [form.register]: base, nmiArmed: false, flags: flagsFor(form.postbyte) });
        const origin = form.absolute ? 0 : form.relative ? pc + bytes.length : base;
        const address = wrapAddress(origin + form.offset), image = new Map<number, number>();
        image.set(form.indirect ? 0x4000 : address, 0x81);
        if (form.indirect) { image.set(address, 0x40); image.set(wrapAddress(address + 1), 0); }
        bytes.forEach((value, offset) => image.set(wrapAddress(pc + offset), value));
        const target = form.indirect ? image.get(address)! * 256 + image.get(wrapAddress(address + 1))! : address;
        const original = image.get(target) ?? 0, expected = shiftedMemory(name, original, state.flags);
        const ram = new ObservedRam();
        for (const [address, value] of image) ram.write(address, value);
        const cpu = new Cpu6809(ram, state), before = cpu.snapshot();
        ram.accesses.length = 0;
        const record = cpu.step();
        assert.deepEqual(record, {
          instruction: { address: pc, bytes }, before,
          after: { ...before, [form.register]: wrapAddress(base + form.update), pc: wrapAddress(pc + bytes.length),
            nmiArmed: form.register === "s" && form.update !== 0, flags: expected.flags },
          outcome: "executed", accesses: [
            ...bytes.map((value, offset) => ({ kind: "read", address: wrapAddress(pc + offset), value })),
            ...(form.indirect ? [
              { kind: "read", address, value: image.get(address) },
              { kind: "read", address: wrapAddress(address + 1), value: image.get(wrapAddress(address + 1)) },
            ] : []),
            { kind: "read", address: target, value: original }, { kind: "write", address: target, value: expected.result },
          ],
        }, `${name}, postbyte=${form.postbyte}, base=${base}`);
        assert.deepEqual(ram.accesses, record.accesses);
        assert.deepEqual(cpu.snapshot(), record.after);
        assert.equal(ram.read(target), expected.result);
      }
    }
  }
});

test("6809 memory shifts retain exactly completed fetches, address updates, and flags at every failed access", () => {
  const failure = new Error("shift memory failure");
  class FaultRam extends ObservedRam {
    failAt = -1; attempts = 0;
    override read(address: number): number { if (this.attempts++ === this.failAt) throw failure; return super.read(address); }
    override write(address: number, value: number): void { if (this.attempts++ === this.failAt) throw failure; super.write(address, value); }
  }
  for (const [name, direct, indexed, extended] of memoryShiftEncodings) {
    const cases: readonly { bytes: readonly number[]; state: Partial<Cpu6809State>; address: number;
      indirect?: boolean; update?: Partial<Cpu6809State> }[] = [
      { bytes: [direct, 0], state: { pc: 0xffff, dp: 0xff }, address: 0xff00 },
      { bytes: [extended, 0xff, 0xff], state: { pc: 0xfffe }, address: 0xffff },
      { bytes: [indexed, 0x81], state: { pc: 0xfffe, x: 0xffff }, address: 0xffff, update: { x: 1 } }, // ,X++
      { bytes: [indexed, 0xf3], state: { pc: 0xfffd, s: 1 }, address: 0xffff, indirect: true, update: { s: 0xffff, nmiArmed: true } }, // [,--S]
      { bytes: [indexed, 0x99, 0xff, 0xff], state: { pc: 0xfffe, x: 1 }, address: 0, indirect: true }, // [-1,X]
      { bytes: [indexed, 0x9f, 0xff, 0xff], state: { pc: 0x200 }, address: 0xffff, indirect: true }, // [FFFF]
    ];
    for (const { bytes, state: overrides, address, indirect, update } of cases) {
      const state = initialState({ nmiArmed: false, flags: { ...flagsFor(0xff), v: false }, ...overrides });
      const image = new Map<number, number>([[indirect ? 0x4000 : address, 0x80]]);
      if (indirect) { image.set(address, 0x40); image.set(wrapAddress(address + 1), 0); }
      bytes.forEach((value, offset) => image.set(wrapAddress(state.pc + offset), value));
      const target = indirect ? image.get(address)! * 256 + image.get(wrapAddress(address + 1))! : address;
      const original = image.get(target) ?? 0, expected = shiftedMemory(name, original, state.flags);
      const accesses = [
        ...bytes.map((value, offset) => ({ kind: "read", address: wrapAddress(state.pc + offset), value })),
        ...(indirect ? [
          { kind: "read", address, value: image.get(address) },
          { kind: "read", address: wrapAddress(address + 1), value: image.get(wrapAddress(address + 1)) },
        ] : []),
        { kind: "read", address: target, value: original }, { kind: "write", address: target, value: expected.result },
      ];
      for (let failAt = -1; failAt < accesses.length; failAt++) {
        const ram = new FaultRam();
        for (const [address, value] of image) ram.write(address, value);
        const cpu = new Cpu6809(ram, state), before = cpu.snapshot();
        ram.accesses.length = 0; ram.attempts = 0; ram.failAt = failAt;
        const completed = failAt < 0 ? accesses.length : failAt;
        const after = { ...before, ...(completed >= bytes.length ? update : {}),
          pc: wrapAddress(state.pc + Math.min(completed, bytes.length)),
          flags: completed >= accesses.length - 1 ? expected.flags : before.flags };
        if (failAt >= 0) assert.throws(() => cpu.step(), error => error === failure);
        else assert.deepEqual(cpu.step(), { before, after, instruction: { address: state.pc, bytes }, accesses, outcome: "executed" });
        assert.deepEqual(cpu.snapshot(), after, `${name}, bytes=${bytes}, failAt=${failAt}`);
        assert.deepEqual(ram.accesses, accesses.slice(0, completed));
        assert.equal(ram.attempts, failAt < 0 ? accesses.length : failAt + 1);
        ram.failAt = -1;
        assert.equal(ram.read(target), failAt < 0 ? expected.result : original);
        // Faults release the execution guard, so a repaired program can execute another instruction.
        ram.write(after.pc, 0x12);
        assert.equal(cpu.step().outcome, "executed");
      }
    }
  }
});

test("6809 indexed JMP resolves every documented postbyte with offsets, auto-updates, indirection, and wrapping", () => {
  for (const [a, b, offset8, offset16] of [
    [0, 0, 0, 0], [0x7f, 1, 127, 32767], [0x80, 0xff, -128, -32768], [0xff, 0x80, -1, -1],
  ] as const) {
    const forms = indexedForms(a, b, offset8, offset16);
    assert.equal(new Set(forms.map(form => form.postbyte)).size, 217);
    for (const form of forms) {
      for (const base of [0, 0x7fff, 0xffff]) {
        for (const pc of [0x200, 0xfffd, 0xffff]) {
          const bytes = [0x6e, form.postbyte, ...form.operands];
          const state = initialState({ a, b, pc, [form.register]: base });
          const origin = form.absolute ? 0 : form.relative ? pc + bytes.length : base;
          const address = wrapAddress(origin + form.offset);
          // A literal image makes pointer/instruction overlap visible in the oracle.
          const image = new Map<number, number>();
          if (form.indirect) {
            image.set(address, 0x45);
            image.set(wrapAddress(address + 1), 0x67);
          }
          bytes.forEach((value, offset) => image.set(wrapAddress(pc + offset), value));
          const ram = new ObservedRam();
          for (const [address, value] of image) ram.write(address, value);
          ram.accesses.length = 0;
          const cpu = new Cpu6809(ram, state);
          const before = { ...state, d: a * 256 + b };
          const target = form.indirect ? image.get(address)! * 256 + image.get(wrapAddress(address + 1))! : address;
          const expected = {
            before, after: { ...before, [form.register]: wrapAddress(base + form.update), pc: target },
            instruction: { address: pc, bytes }, outcome: "executed",
            accesses: [
              ...bytes.map((value, offset) => ({ kind: "read", address: wrapAddress(pc + offset), value })),
              ...(form.indirect ? [
                { kind: "read", address, value: image.get(address) },
                { kind: "read", address: wrapAddress(address + 1), value: image.get(wrapAddress(address + 1)) },
              ] : []),
            ],
          };
          assert.deepEqual(cpu.step(), expected, `postbyte=${form.postbyte}, base=${base}, PC=${pc}`);
          assert.deepEqual(ram.accesses, expected.accesses);
        }
      }
    }
  }
});

const indexedOpcodes = [
  0x60, 0x63, 0x64, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x6c, 0x6d, 0x6e, 0x6f,
  0xa0, 0xa1, 0xa2, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xab, 0xad, 0xae, 0xaf,
  0xe0, 0xe1, 0xe2, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xeb, 0xec, 0xed, 0xee, 0xef,
];

test("all 56 indexed forms reject all 39 undefined postbytes before effects, and resume after a RAM edit", () => {
  const legal = new Set(indexedForms(0, 0, 0, 0).map(form => form.postbyte));
  const encodings = [
    ...[...indexedOpcodes, 0xa3, 0xac, 0xe3, 0x30, 0x31, 0x32, 0x33].map(opcode => [opcode]),
    ...[0xa3, 0xac, 0xae, 0xaf, 0xee, 0xef].map(opcode => [0x10, opcode]),
    ...[0xa3, 0xac].map(opcode => [0x11, opcode]),
  ];
  assert.equal(encodings.length, 56);
  for (const encoding of encodings) for (let postbyte = 0; postbyte < 256; postbyte++) {
    if (legal.has(postbyte)) continue;
    for (const pc of [0x200, 0xffff]) {
      const ram = new ObservedRam();
      const bytes = [...encoding, postbyte];
      bytes.forEach((byte, i) => ram.write(wrapAddress(pc + i), byte));
      const cpu = new Cpu6809(ram, initialState({ pc }));
      const before = cpu.snapshot();
      for (let attempt = 0; attempt < 2; attempt++) {
        ram.accesses.length = 0;
        const accesses = bytes.map((value, i) => ({ kind: "read", address: wrapAddress(pc + i), value }));
        assert.deepEqual(cpu.step(), { before, after: before, instruction: { address: pc, bytes },
          outcome: "unsupported", reason: "opcode", accesses });
        assert.deepEqual(ram.accesses, accesses);
      }
      ram.write(wrapAddress(pc + encoding.length), 0x84); // ,X
      assert.equal(cpu.step().outcome, "executed");
    }
  }
});

for (const [register, immediate, directLoad, indexedLoad, extendedLoad, directStore, indexedStore, extendedStore] of [
  ["d", 0xcc, 0xdc, 0xec, 0xfc, 0xdd, 0xed, 0xfd],
  ["x", 0x8e, 0x9e, 0xae, 0xbe, 0x9f, 0xaf, 0xbf],
  ["u", 0xce, 0xde, 0xee, 0xfe, 0xdf, 0xef, 0xff],
] as const) {
  test(`6809 LD/ST ${register.toUpperCase()} covers all seven forms, word flags, byte order, and boundary addresses`, () => {
    for (const [opcode, operands, address, store] of [
      [immediate, [], undefined, false],
      [directLoad, [0xff], 0x56ff, false], [directStore, [0xff], 0x56ff, true],
      [indexedLoad, [0xa4], 0x4567, false], [indexedStore, [0xa4], 0x4567, true],
      [extendedLoad, [0xff, 0xff], 0xffff, false], [extendedStore, [0xff, 0xff], 0xffff, true],
    ] as const) {
      for (const value of [0, 1, 0x0080, 0x7fff, 0x8000, 0x8001, 0xffff]) {
        for (let cc = 0; cc < 256; cc++) {
          const high = Math.floor(value / 256), low = value % 256;
          const pc = address === 0xffff ? 0x200 : 0xffff;
          const state = initialState({ pc, flags: flagsFor(cc) });
          if (store) {
            if (register === "d") { state.a = high; state.b = low; }
            else state[register] = value;
          }
          const bytes = [opcode, ...(address === undefined ? [high, low] : operands)];
          const ram = new ObservedRam();
          bytes.forEach((value, offset) => ram.write(wrapAddress(pc + offset), value));
          if (address !== undefined) {
            ram.write(address, high); // Stores must still write an unchanged value.
            ram.write(wrapAddress(address + 1), low);
          }
          const cpu = new Cpu6809(ram, state);
          const before = cpu.snapshot();
          ram.accesses.length = 0;
          const result = cpu.step();
          const loaded = store ? {} : register === "d" ? { a: high, b: low, d: value } : { [register]: value };
          assert.deepEqual(result, {
            before, after: { ...before, ...loaded, pc: wrapAddress(pc + bytes.length),
              flags: { ...state.flags, n: value >= 32768, z: value === 0, v: false } },
            instruction: { address: pc, bytes }, outcome: "executed",
            accesses: [
              ...bytes.map((value, offset) => ({ kind: "read", address: wrapAddress(pc + offset), value })),
              ...(address === undefined ? [] : [
                { kind: store ? "write" : "read", address, value: high },
                { kind: store ? "write" : "read", address: wrapAddress(address + 1), value: low },
              ]),
            ],
          });
          assert.deepEqual(ram.accesses, result.accesses);
        }
      }
    }
  });
}

test("6809 LDD splits every word into A/B and uses bit 15 for N", () => {
  const program = byteProgram([0xcc, 0, 0]);
  for (let value = 0; value < 65536; value++) {
    program.ram.write(0x103, Math.floor(value / 256));
    program.ram.write(0x104, value % 256);
    for (const cc of [0, 255]) {
      const record = program.run(0x55, 0xaa, cc);
      assert.deepEqual(record.after, { ...record.before, pc: 0x105, a: Math.floor(value / 256), b: value % 256, d: value,
        flags: { ...flagsFor(cc), n: value >= 32768, z: value === 0, v: false } });
    }
  }
});

test("6809 indexed word loads overwrite auto-updates, while stores read the updated source", () => {
  for (const [register, load, store, selector] of [["x", 0xae, 0xaf, 0], ["u", 0xee, 0xef, 0x40]] as const) {
    for (const [postbyte, delta, addressOffset, indirect] of [
      [0x80, 1, 0, false], [0x81, 2, 0, false], [0x82, -1, -1, false], [0x83, -2, -2, false],
      [0x91, 2, 0, true], [0x93, -2, -2, true],
    ] as const) {
      for (const base of [0, 0xffff]) {
        for (const isStore of [false, true]) {
          const bytes = [isStore ? store : load, postbyte + selector];
          const ram = new ObservedRam();
          ram.write(0x200, bytes[0]!); ram.write(0x201, bytes[1]!);
          const pointer = wrapAddress(base + addressOffset);
          const address = indirect ? 0x3456 : pointer;
          if (indirect) { ram.write(pointer, 0x34); ram.write(wrapAddress(pointer + 1), 0x56); }
          ram.write(address, 0xab); ram.write(wrapAddress(address + 1), 0xcd);
          const cpu = new Cpu6809(ram, initialState({ pc: 0x200, [register]: base }));
          const before = cpu.snapshot();
          ram.accesses.length = 0;
          const result = cpu.step();
          const value = isStore ? wrapAddress(base + delta) : 0xabcd;
          assert.deepEqual(result.after, { ...before, [register]: value, pc: 0x202,
            flags: { ...before.flags, n: value >= 32768, z: value === 0, v: false } });
          assert.deepEqual(result.accesses, [
            { kind: "read", address: 0x200, value: bytes[0] }, { kind: "read", address: 0x201, value: bytes[1] },
            ...(indirect ? [{ kind: "read", address: pointer, value: 0x34 },
              { kind: "read", address: wrapAddress(pointer + 1), value: 0x56 }] : []),
            { kind: isStore ? "write" : "read", address, value: Math.floor(value / 256) },
            { kind: isStore ? "write" : "read", address: wrapAddress(address + 1), value: value % 256 },
          ]);
          assert.deepEqual(ram.accesses, result.accesses);
        }
      }
    }
  }
});

test("6809 indexed JSR resolves S and its indirect pointer before stacking the return address", () => {
  for (let cc = 0; cc < 256; cc++) {
    for (const [postbyte, s, target, stack, indirect] of [
      [0xe1, 0xffff, 0xffff, 1, false], // ,S++
      [0xe3, 1, 0xffff, 0xffff, false], // ,--S
      [0xf1, 0xffff, 0x4567, 1, true], // [,S++]
      [0xf3, 1, 0x4567, 0xffff, true], // [,--S]
    ] as const) {
      const ram = new ObservedRam();
      ram.write(0x12fc, 0xad); ram.write(0x12fd, postbyte);
      ram.write(0xffff, 0x45); ram.write(0, 0x67);
      const cpu = new Cpu6809(ram, initialState({ pc: 0x12fc, s, flags: flagsFor(cc) }));
      const before = cpu.snapshot();
      ram.accesses.length = 0;
      const result = cpu.step();
      assert.deepEqual(result.after, { ...before, pc: target, s: wrapAddress(stack - 2) });
      assert.deepEqual(result.accesses, [
        { kind: "read", address: 0x12fc, value: 0xad }, { kind: "read", address: 0x12fd, value: postbyte },
        ...(indirect ? [{ kind: "read", address: 0xffff, value: 0x45 }, { kind: "read", address: 0, value: 0x67 }] : []),
        { kind: "write", address: wrapAddress(stack - 1), value: 0xfe },
        { kind: "write", address: wrapAddress(stack - 2), value: 0x12 },
      ]);
      assert.deepEqual(ram.accesses, result.accesses);
    }
  }
});

// Motorola Appendix D: each row spells out immediate/direct/indexed/extended opcodes.
const additionalWords = [
  { name: "ADDD", operation: "add", register: "d", prefix: [], opcodes: [0xc3, 0xd3, 0xe3, 0xf3] },
  { name: "SUBD", operation: "subtract", register: "d", prefix: [], opcodes: [0x83, 0x93, 0xa3, 0xb3] },
  { name: "CMPX", operation: "compare", register: "x", prefix: [], opcodes: [0x8c, 0x9c, 0xac, 0xbc] },
  { name: "CMPD", operation: "compare", register: "d", prefix: [0x10], opcodes: [0x83, 0x93, 0xa3, 0xb3] },
  { name: "CMPY", operation: "compare", register: "y", prefix: [0x10], opcodes: [0x8c, 0x9c, 0xac, 0xbc] },
  { name: "CMPU", operation: "compare", register: "u", prefix: [0x11], opcodes: [0x83, 0x93, 0xa3, 0xb3] },
  { name: "CMPS", operation: "compare", register: "s", prefix: [0x11], opcodes: [0x8c, 0x9c, 0xac, 0xbc] },
  { name: "LDY", operation: "load", register: "y", prefix: [0x10], opcodes: [0x8e, 0x9e, 0xae, 0xbe] },
  { name: "LDS", operation: "load", register: "s", prefix: [0x10], opcodes: [0xce, 0xde, 0xee, 0xfe] },
  { name: "STY", operation: "store", register: "y", prefix: [0x10], opcodes: [undefined, 0x9f, 0xaf, 0xbf] },
  { name: "STS", operation: "store", register: "s", prefix: [0x10], opcodes: [undefined, 0xdf, 0xef, 0xff] },
] as const;
type AdditionalWord = typeof additionalWords[number];
const snapshotOf = (state: Cpu6809State): Cpu6809Snapshot => ({ ...state, d: state.a * 256 + state.b });
const bytesOfWord = (word: number) => [Math.floor(word / 256), word % 256];

function expectedWord(form: AdditionalWord, state: Cpu6809State, value: number): Cpu6809State {
  const { operation, register } = form;
  const before = snapshotOf(state);
  if (operation === "load" || operation === "store") {
    const result = operation === "load" ? value : before[register];
    return { ...state, ...(operation === "load" ? { [register]: value } : {}),
      flags: { ...state.flags, n: result >= 32768, z: result === 0, v: false } };
  }
  const left = before[register];
  const signed = (word: number) => word < 32768 ? word : word - 65536;
  const adding = operation === "add";
  const signedResult = adding ? signed(left) + signed(value) : signed(left) - signed(value);
  const result = wrapAddress(adding ? left + value : left - value);
  return { ...state, ...(operation === "compare" ? {} : { a: Math.floor(result / 256), b: result % 256 }),
    flags: { ...state.flags, n: result >= 32768, z: result === 0,
      v: signedResult < -32768 || signedResult > 32767, c: adding ? left + value > 65535 : left < value } };
}

// The oracle uses a literal byte image, so overlaps change the expected operand too.
function checkAdditionalWord(ram: ObservedRam, form: AdditionalWord, mode: number, state: Cpu6809State, value: number,
  location = 0xff, indexed = indexedForms(state.a, state.b, -128, -32768)[0]!) {
  const opcode = form.opcodes[mode];
  assert.notEqual(opcode, undefined);
  const operands = mode === 0 ? bytesOfWord(value) : mode === 1 ? [location]
    : mode === 2 ? [indexed.postbyte, ...indexed.operands] : bytesOfWord(location);
  const bytes = [...form.prefix, opcode!, ...operands];
  let resolved = mode === 1 ? state.dp * 256 + location : location;
  const advanced = { ...state, flags: { ...state.flags }, pc: wrapAddress(state.pc + bytes.length) };
  if (mode === 2) {
    const origin = indexed.absolute ? 0 : indexed.relative ? advanced.pc : state[indexed.register];
    resolved = wrapAddress(origin + indexed.offset);
    advanced[indexed.register] = wrapAddress(state[indexed.register] + indexed.update);
  }
  const image = new Map<number, number>();
  const putWord = (address: number, word: number) => bytesOfWord(word).forEach((byte, i) => image.set(wrapAddress(address + i), byte));
  const indirect = mode === 2 && indexed.indirect;
  if (indirect) putWord(resolved, 0x5678);
  if (mode !== 0) putWord(indirect ? 0x5678 : resolved, value);
  bytes.forEach((byte, i) => image.set(wrapAddress(state.pc + i), byte));
  const read = (address: number) => image.get(wrapAddress(address)) ?? 0;
  const readWord = (address: number) => read(address) * 256 + read(address + 1);
  const address = indirect ? readWord(resolved) : resolved;
  const operand = mode === 0 ? value : readWord(address);
  const after = snapshotOf(expectedWord(form, advanced, operand));
  // Initialize every data byte read by this case when reusing RAM.
  if (mode !== 0) for (const at of [address, wrapAddress(address + 1)]) if (!image.has(at)) image.set(at, 0);
  for (const [address, byte] of image) ram.write(address, byte);
  const accesses: { kind: "read" | "write"; address: number; value: number }[] =
    bytes.map((value, i) => ({ kind: "read", address: wrapAddress(state.pc + i), value }));
  if (indirect) accesses.push({ kind: "read", address: resolved, value: read(resolved) },
    { kind: "read", address: wrapAddress(resolved + 1), value: read(resolved + 1) });
  if (mode !== 0) {
    const stored = snapshotOf(advanced)[form.register];
    const data = form.operation === "store" ? stored : operand;
    const kind = form.operation === "store" ? "write" : "read";
    accesses.push({ kind, address, value: Math.floor(data / 256) }, { kind, address: wrapAddress(address + 1), value: data % 256 });
  }
  ram.accesses.length = 0;
  const cpu = new Cpu6809(ram, state);
  assert.deepEqual(cpu.step(), { before: snapshotOf(state), after, instruction: { address: state.pc, bytes }, outcome: "executed", accesses });
  assert.deepEqual(ram.accesses, accesses);
  assert.deepEqual(cpu.snapshot(), after);
  if (form.operation === "store") assert.equal(ram.read(address) * 256 + ram.read(wrapAddress(address + 1)), snapshotOf(advanced)[form.register]);
}

for (const form of additionalWords) {
  test(`6809 ${form.name} checks every form, CC pattern, word boundaries, PC wrap, and data overlap`, () => {
    const ram = new ObservedRam();
    for (let mode = 0; mode < 4; mode++) {
      if (form.opcodes[mode] === undefined) continue;
      for (const value of [0, 1, 0xff, 0x100, 0x7fff, 0x8000, 0xffff]) {
        for (let cc = 0; cc < 256; cc++) {
          const state = initialState({ a: 0x7f, b: 0xff, x: 0xffff, y: 0x8000, s: 0, u: 0x100,
            pc: [0x200, 0xfffc, 0xfffd, 0xfffe, 0xffff][cc % 5]!, flags: flagsFor(cc) });
          checkAdditionalWord(ram, form, mode, state, value, mode === 3 ? 0xffff : 0xff);
        }
      }
      if (mode !== 0) for (const pc of [0, 0xfffe, 0xffff]) {
        const state = initialState({ pc, dp: 0, x: pc });
        checkAdditionalWord(ram, form, mode, state, 0x8001, mode === 1 ? 0 : pc,
          indexedForms(0, 0, 0, 0).find(f => f.postbyte === 0x84)!);
      }
    }
  });
}

test("6809 new indexed word forms cover every documented postbyte and auto-updated source or destination", () => {
  const ram = new ObservedRam();
  for (const form of additionalWords) {
    for (const [a, b, byteOffset, wordOffset] of [[0, 0, 0, 0], [0x80, 0xff, -128, -32768], [0x7f, 1, 127, 32767]] as const) {
      for (const indexed of indexedForms(a, b, byteOffset, wordOffset)) {
        for (const base of [0, 0xffff]) {
          const state = initialState({ a, b, [indexed.register]: base, pc: 0xfffd, flags: flagsFor(indexed.postbyte) });
          checkAdditionalWord(ram, form, 2, state, 0xa55a, 0, indexed);
        }
      }
    }
  }
});

for (const form of additionalWords.filter(form => form.opcodes[0] !== undefined)) {
  test(`6809 ${form.name} immediate checks every word against an independent arithmetic oracle`, () => {
    const ram = new Ram(65536);
    const opcodeBytes = [...form.prefix, form.opcodes[0]!];
    opcodeBytes.forEach((byte, i) => ram.write(0x200 + i, byte));
    for (let value = 0; value < 65536; value++) {
      const left = (value * 251 + 0x8001) % 65536;
      const state = initialState({ a: Math.floor(left / 256), b: left % 256, x: left, y: left, u: left, s: left,
        pc: 0x200, flags: flagsFor(value % 256) });
      bytesOfWord(value).forEach((byte, i) => ram.write(0x200 + opcodeBytes.length + i, byte));
      const after = expectedWord(form, { ...state, pc: 0x202 + opcodeBytes.length }, value);
      assert.deepEqual(new Cpu6809(ram, state).step().after, snapshotOf(after));
    }
  });
}

for (const [opcode, register, changesZ] of [[0x30, "x", true], [0x31, "y", true], [0x32, "s", false], [0x33, "u", false]] as const) {
  test(`6809 LEA ${register.toUpperCase()} checks every indexed postbyte, self-updates, indirect reads, and flag preservation`, () => {
    for (const form of indexedForms(0x80, 0xff, -128, -32768)) {
      for (const base of [0, 1, 0x7fff, 0xffff]) {
        for (const pc of [0x200, 0xffff]) {
          const bytes = [opcode, form.postbyte, ...form.operands];
          const state = initialState({ a: 0x80, b: 0xff, pc, [form.register]: base, flags: flagsFor(form.postbyte) });
          const origin = form.absolute ? 0 : form.relative ? pc + bytes.length : base;
          const address = wrapAddress(origin + form.offset);
          const image = new Map<number, number>();
          if (form.indirect) bytesOfWord(base).forEach((byte, i) => image.set(wrapAddress(address + i), byte));
          bytes.forEach((byte, i) => image.set(wrapAddress(pc + i), byte));
          const target = form.indirect ? image.get(address)! * 256 + image.get(wrapAddress(address + 1))! : address;
          const after = { ...state, [form.register]: wrapAddress(base + form.update), [register]: target, pc: wrapAddress(pc + bytes.length),
            flags: changesZ ? { ...state.flags, z: target === 0 } : state.flags };
          const ram = new ObservedRam();
          for (const [address, byte] of image) ram.write(address, byte);
          ram.accesses.length = 0;
          const accesses = bytes.map((value, i) => ({ kind: "read", address: wrapAddress(pc + i), value }));
          if (form.indirect) accesses.push({ kind: "read", address, value: image.get(address)! },
            { kind: "read", address: wrapAddress(address + 1), value: image.get(wrapAddress(address + 1))! });
          assert.deepEqual(new Cpu6809(ram, state).step(), { before: snapshotOf(state), after: snapshotOf(after),
            instruction: { address: pc, bytes }, outcome: "executed", accesses });
          assert.deepEqual(ram.accesses, accesses);
        }
      }
    }
    const ram = new Ram(65536);
    ram.write(0x200, opcode); ram.write(0x201, 0x84);
    for (let cc = 0; cc < 256; cc++) for (const x of [0, 0x8000, 0xffff]) {
      const state = initialState({ x, pc: 0x200, flags: flagsFor(cc) });
      assert.deepEqual(new Cpu6809(ram, state).step().after, snapshotOf({ ...state, [register]: x, pc: 0x202,
        flags: changesZ ? { ...state.flags, z: x === 0 } : state.flags }));
    }
  });
}

// Manual postbyte mapping; byte and word groups are intentionally separate.
const transferGroups = [["d", "x", "y", "u", "s", "pc"], ["a", "b", "cc", "dp"]] as const;
type TransferName = typeof transferGroups[number][number];
function transferValue(state: Cpu6809State, register: TransferName): number {
  if (register === "d") return state.a * 256 + state.b;
  if (register === "cc") return [state.flags.e, state.flags.f, state.flags.h, state.flags.i,
    state.flags.n, state.flags.z, state.flags.v, state.flags.c].reduce((bits, flag) => bits * 2 + Number(flag), 0);
  return state[register];
}
function setTransfer(state: Cpu6809State, register: TransferName, value: number): void {
  if (register === "cc") state.flags = flagsFor(value);
  else if (register === "d") { state.a = Math.floor(value / 256); state.b = value % 256; }
  else state[register] = value;
}

for (const [name, opcode, exchange] of [["TFR", 0x1f, false], ["EXG", 0x1e, true]] as const) {
  test(`6809 ${name} checks every same-width register pair, CC value, and both directions of PC and D`, () => {
    const ram = new ObservedRam();
    for (const [group, registers] of transferGroups.entries()) {
      for (const [sourceCode, source] of registers.entries()) for (const [targetCode, target] of registers.entries()) {
        const postbyte = (group * 8 + sourceCode) * 16 + group * 8 + targetCode;
        for (let cc = 0; cc < 256; cc++) {
          const pc = [0x200, 0xfffe, 0xffff][cc % 3]!;
          const state = initialState({ a: cc, b: 255 - cc, dp: (cc * 3) % 256, x: cc * 257, y: 65535 - cc * 257,
            s: 0x8000, u: 0, pc, flags: flagsFor(cc) });
          const next = { ...state, flags: { ...state.flags }, pc: wrapAddress(pc + 2) };
          const from = transferValue(next, source), to = transferValue(next, target);
          setTransfer(next, target, from);
          if (exchange) setTransfer(next, source, to);
          const bytes = [opcode, postbyte];
          bytes.forEach((byte, i) => ram.write(wrapAddress(pc + i), byte));
          ram.accesses.length = 0;
          const accesses = bytes.map((value, i) => ({ kind: "read", address: wrapAddress(pc + i), value }));
          assert.deepEqual(new Cpu6809(ram, state).step(), { before: snapshotOf(state), after: snapshotOf(next),
            instruction: { address: pc, bytes }, outcome: "executed", accesses });
          assert.deepEqual(ram.accesses, accesses);
        }
      }
    }
  });
  test(`6809 ${name} rejects all reserved or mixed-width postbytes atomically and can resume`, () => {
    for (let postbyte = 0; postbyte < 256; postbyte++) {
      const from = Math.floor(postbyte / 16), to = postbyte % 16;
      const valid = (from < 6 && to < 6) || (from >= 8 && from < 12 && to >= 8 && to < 12);
      if (valid) continue;
      const ram = new ObservedRam();
      ram.write(0xffff, opcode); ram.write(0, postbyte);
      const cpu = new Cpu6809(ram, initialState({ pc: 0xffff }));
      const before = cpu.snapshot();
      const accesses = [{ kind: "read", address: 0xffff, value: opcode }, { kind: "read", address: 0, value: postbyte }];
      for (let repeat = 0; repeat < 2; repeat++) {
        ram.accesses.length = 0;
        assert.deepEqual(cpu.step(), { before, after: before, instruction: { address: 0xffff, bytes: [opcode, postbyte] },
          outcome: "unsupported", reason: "opcode", accesses });
        assert.deepEqual(ram.accesses, accesses);
      }
      ram.write(0, 0x11);
      assert.equal(cpu.step().outcome, "executed");
    }
  });
}

for (const [name, opcode] of [["ORCC", 0x1a], ["ANDCC", 0x1c]] as const) {
  test(`6809 ${name} checks every immediate byte and CC pattern, preserving all registers`, () => {
    const ram = new ObservedRam();
    ram.write(0xffff, opcode);
    for (let cc = 0; cc < 256; cc++) for (let operand = 0; operand < 256; operand++) {
      ram.write(0, operand); ram.accesses.length = 0;
      const state = initialState({ pc: 0xffff, flags: flagsFor(cc) });
      const bits = flagsFor(operand);
      const flags = Object.fromEntries(Object.entries(state.flags).map(([key, value]) =>
        [key, name === "ORCC" ? value || bits[key as keyof Cpu6809Flags] : value && bits[key as keyof Cpu6809Flags]]));
      const accesses = [{ kind: "read", address: 0xffff, value: opcode }, { kind: "read", address: 0, value: operand }];
      assert.deepEqual(new Cpu6809(ram, state).step(), { before: snapshotOf(state), after: { ...snapshotOf(state), pc: 1, flags },
        instruction: { address: 0xffff, bytes: [opcode, operand] }, outcome: "executed", accesses });
      assert.deepEqual(ram.accesses, accesses);
    }
  });
}

test("6809 restored CC stays live through ADC, DAA, and transfer back to A, with detached earlier records", () => {
  const ram = new Ram(65536);
  [0x1c, 0, 0x1a, 1, 0x89, 0x67, 0x19, 0x1f, 0xa8].forEach((byte, i) => ram.write(0x200 + i, byte));
  const cpu = new Cpu6809(ram, initialState({ a: 0x58, pc: 0x200 }));
  const first = cpu.step(), saved = structuredClone(first);
  cpu.step(); cpu.step();
  assert.equal(cpu.step().after.a, 0x26);
  const after = cpu.step().after;
  assert.equal(after.a, 0x21); // ADC produced a half carry; DAA preserves it.
  assert.deepEqual(after.flags, flagsFor(0x21));
  assert.deepEqual(first, saved);
});

test("6809 SEX checks every byte and CC, replaces A, and preserves V", () => {
  const ram = new ObservedRam(); ram.write(0xffff, 0x1d);
  for (let b = 0; b < 256; b++) for (let cc = 0; cc < 256; cc++) {
    const state = initialState({ a: cc, b, pc: 0xffff, flags: flagsFor(cc) });
    const a = b >= 128 ? 255 : 0;
    const after = snapshotOf({ ...state, a, pc: 0, flags: { ...state.flags, n: b >= 128, z: b === 0 } });
    ram.accesses.length = 0;
    const accesses = [{ kind: "read", address: 0xffff, value: 0x1d }];
    assert.deepEqual(new Cpu6809(ram, state).step(), { before: snapshotOf(state), after,
      instruction: { address: 0xffff, bytes: [0x1d] }, outcome: "executed", accesses });
    assert.deepEqual(ram.accesses, accesses);
  }
});

test("6809 MUL checks every unsigned byte pair and preserves flags other than Z and product bit 7 as C", () => {
  const ram = new ObservedRam(); ram.write(0xffff, 0x3d);
  for (let a = 0; a < 256; a++) for (let b = 0; b < 256; b++) {
    const patterns = [0, 1, 0x7f, 0x80, 0xff].includes(a) && [0, 1, 0x7f, 0x80, 0xff].includes(b)
      ? Array.from({ length: 256 }, (_, cc) => cc) : [(a + b) % 256];
    for (const cc of patterns) {
      const state = initialState({ a, b, pc: 0xffff, flags: flagsFor(cc) });
      const product = a * b;
      const after = snapshotOf({ ...state, a: Math.floor(product / 256), b: product % 256, pc: 0,
        flags: { ...state.flags, z: product === 0, c: product % 256 >= 128 } });
      ram.accesses.length = 0;
      const accesses = [{ kind: "read", address: 0xffff, value: 0x3d }];
      assert.deepEqual(new Cpu6809(ram, state).step(), { before: snapshotOf(state), after,
        instruction: { address: 0xffff, bytes: [0x3d] }, outcome: "executed", accesses });
      assert.deepEqual(ram.accesses, accesses);
    }
  }
});

test("6809 ABX checks every X and unsigned B, with all flags preserved at boundaries", () => {
  const ram = new Ram(65536); ram.write(0x200, 0x3a);
  for (let x = 0; x < 65536; x++) {
    const bs = [0, 0xffff, 0x7fff].includes(x) ? Array.from({ length: 256 }, (_, b) => b) : [x % 256];
    for (const b of bs) {
      const state = initialState({ x, b, pc: 0x200, flags: flagsFor(b) });
      assert.deepEqual(new Cpu6809(ram, state).step().after, snapshotOf({ ...state, x: (x + b) % 65536, pc: 0x201 }));
    }
  }
});

test("6809 DAA checks all A and CC combinations against Motorola's separate nibble conditions", () => {
  const ram = new ObservedRam(); ram.write(0xffff, 0x19);
  for (let a = 0; a < 256; a++) for (let cc = 0; cc < 256; cc++) {
    const state = initialState({ a, pc: 0xffff, flags: flagsFor(cc) });
    const upper = Math.floor(a / 16), lower = a % 16;
    const lowCorrection = state.flags.h || lower > 9 ? 6 : 0;
    const highCorrection = state.flags.c || upper > 9 || (upper > 8 && lower > 9) ? 96 : 0;
    const sum = a + lowCorrection + highCorrection, adjusted = sum % 256;
    const after = snapshotOf({ ...state, a: adjusted, pc: 0, flags: { ...state.flags, n: adjusted >= 128, z: adjusted === 0, v: false,
      c: state.flags.c || sum >= 256 } });
    ram.accesses.length = 0;
    const accesses = [{ kind: "read", address: 0xffff, value: 0x19 }];
    assert.deepEqual(new Cpu6809(ram, state).step(), { before: snapshotOf(state), after,
      instruction: { address: 0xffff, bytes: [0x19] }, outcome: "executed", accesses });
    assert.deepEqual(ram.accesses, accesses);
  }
});

test("6809 ADDA/ADCA followed by DAA matches decimal arithmetic for every BCD operand pair and carry", () => {
  const bcd = (value: number) => Math.floor(value / 10) * 16 + value % 10;
  const ram = new Ram(65536); ram.write(0x202, 0x19);
  for (const opcode of [0x8b, 0x89]) {
    ram.write(0x200, opcode);
    for (let left = 0; left < 100; left++) for (let right = 0; right < 100; right++) for (const c of [false, true]) {
      ram.write(0x201, bcd(right));
      const state = initialState({ a: bcd(left), pc: 0x200, flags: { ...flagsFor(255), c } });
      const cpu = new Cpu6809(ram, state), binary = cpu.step().after;
      const total = left + right + Number(opcode === 0x89 && c), a = bcd(total % 100);
      assert.deepEqual(cpu.step().after, { ...binary, a, d: a * 256 + state.b, pc: 0x203,
        flags: { ...binary.flags, n: a >= 128, z: a === 0, v: false, c: total >= 100 } });
    }
  }
});

for (const { mnemonic, opcode, takenCodes } of branchCases.filter(branch => branch.opcode !== 0x20)) {
  test(`6809 long ${mnemonic} checks every CC and displacement boundaries, always fetching both offset bytes`, () => {
    const ram = new ObservedRam();
    for (let cc = 0; cc < 256; cc++) for (const offset of [0, 1, 127, 128, 32767, -32768, -129, -128, -4, -1]) {
      for (const pc of [0x200, 0xfffc, 0xfffd, 0xfffe, 0xffff]) {
        const bytes = [0x10, opcode, ...bytesOfWord(wrapAddress(offset))];
        bytes.forEach((byte, i) => ram.write(wrapAddress(pc + i), byte));
        const state = initialState({ pc, flags: flagsFor(cc) });
        const target = wrapAddress(pc + 4 + (takenCodes.includes(cc % 16) ? offset : 0));
        ram.accesses.length = 0;
        const accesses = bytes.map((value, i) => ({ kind: "read", address: wrapAddress(pc + i), value }));
        assert.deepEqual(new Cpu6809(ram, state).step(), { before: snapshotOf(state), after: snapshotOf({ ...state, pc: target }),
          instruction: { address: pc, bytes }, outcome: "executed", accesses });
        assert.deepEqual(ram.accesses, accesses);
      }
    }
  });
}

test("6809 long conditional branches reach every word displacement on taken and untaken paths", () => {
  const ram = new Ram(65536);
  ram.write(0x200, 0x10); ram.write(0x201, 0x27); // LBEQ
  for (let offset = 0; offset < 65536; offset++) for (const z of [false, true]) {
    bytesOfWord(offset).forEach((byte, i) => ram.write(0x202 + i, byte));
    const state = initialState({ pc: 0x200, flags: { ...flagsFor(offset % 256), z } });
    assert.deepEqual(new Cpu6809(ram, state).step().after, snapshotOf({ ...state, pc: wrapAddress(0x204 + (z ? offset : 0)) }));
  }
});

const page2Opcodes = new Set([
  0x3f,
  0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x2b, 0x2c, 0x2d, 0x2e, 0x2f,
  0x83, 0x93, 0xa3, 0xb3, 0x8c, 0x9c, 0xac, 0xbc,
  0x8e, 0x9e, 0xae, 0xbe, 0x9f, 0xaf, 0xbf,
  0xce, 0xde, 0xee, 0xfe, 0xdf, 0xef, 0xff,
]);
const page3Opcodes = new Set([0x3f, 0x83, 0x93, 0xa3, 0xb3, 0x8c, 0x9c, 0xac, 0xbc]);

test("6809 implements all 268 documented forms and rejects all other encodings on all three pages", () => {
  assert.equal(baseOpcodes.size, 221);
  assert.equal(page2Opcodes.size, 38);
  assert.equal(page3Opcodes.size, 9);
  assert.equal(baseOpcodes.size + page2Opcodes.size + page3Opcodes.size, 268);
  for (const [prefix, supported] of [[[], baseOpcodes], [[0x10], page2Opcodes], [[0x11], page3Opcodes]] as const) {
    for (let opcode = 0; opcode < 256; opcode++) {
      if (!prefix.length && [0x10, 0x11].includes(opcode)) continue;
      for (const pc of [0x200, 0xffff]) {
        const ram = new ObservedRam();
        const bytes = [...prefix, opcode];
        [...bytes, 0x11, 0x34, 0x56].forEach((byte, i) => ram.write(wrapAddress(pc + i), byte));
        const cpu = new Cpu6809(ram, initialState({ pc }));
        const before = cpu.snapshot();
        ram.accesses.length = 0;
        if (supported.has(opcode)) assert.equal(cpu.step().outcome, !prefix.length && [0x13, 0x3c].includes(opcode) ? "waiting" : "executed", `${prefix} ${opcode}`);
        else {
          const accesses = bytes.map((value, i) => ({ kind: "read", address: wrapAddress(pc + i), value }));
          for (let repeat = 0; repeat < 2; repeat++) {
            ram.accesses.length = 0;
            assert.deepEqual(cpu.step(), { before, after: before, instruction: { address: pc, bytes },
              outcome: "unsupported", reason: "opcode", accesses });
            assert.deepEqual(ram.accesses, accesses);
          }
          if (prefix.length) {
            ram.write(wrapAddress(pc + 1), 0x83); // CMPD / CMPU, using current operand RAM.
            assert.equal(cpu.step().outcome, "executed");
          }
        }
      }
    }
  }
});

test("6809 CMPX reads the updated indexed register only after both source bytes succeed", () => {
  const failure = new Error("source read failed");
  class FailingRam extends ObservedRam {
    failAt: number | undefined;
    override read(address: number): number {
      if (address === this.failAt) throw failure;
      return super.read(address);
    }
  }
  for (const failAt of [undefined, 0x4000, 0x4001]) {
    const ram = new FailingRam();
    const before = initialState({ x: 0x4000 });
    const bytes = [0xac, 0x81]; // CMPX ,X++ compares 4002 with the word at old X=4000.
    bytes.forEach((byte, offset) => ram.write(before.pc + offset, byte));
    ram.write(0x4000, 0x40); ram.write(0x4001, 2);
    ram.accesses.length = 0; ram.failAt = failAt;
    const cpu = new Cpu6809(ram, before);
    const accesses = [...bytes.map((value, offset) => ({ kind: "read", address: before.pc + offset, value })),
      ...(failAt === 0x4000 ? [] : [{ kind: "read", address: 0x4000, value: 0x40 }]),
      ...(failAt === undefined ? [{ kind: "read", address: 0x4001, value: 2 }] : [])];
    const after = { ...before, x: 0x4002, pc: before.pc + 2,
      flags: failAt !== undefined ? before.flags : { ...before.flags, n: false, z: true, v: false, c: false } };
    if (failAt !== undefined) assert.throws(() => cpu.step(), error => error === failure);
    else assert.deepEqual(cpu.step(), { before: snapshotOf(before), after: snapshotOf(after), outcome: "executed",
      instruction: { address: before.pc, bytes }, accesses });
    assert.deepEqual(cpu.snapshot(), snapshotOf(after));
    assert.deepEqual(ram.accesses, accesses);
  }
});

test("6809 indexed STX retains its address update and first write but delays flags if the second write fails", () => {
  const failure = new Error("second write failed");
  class FailingRam extends ObservedRam {
    fail = false;
    override write(address: number, value: number): void {
      if (this.fail && address === 0x4001) throw failure;
      super.write(address, value);
    }
  }
  const ram = new FailingRam();
  const before = initialState({ x: 0x4000, flags: { ...initialState().flags, n: true, z: true, v: true } });
  const bytes = [0xaf, 0x81]; // STX ,X++ stores updated X to the resolved old address.
  bytes.forEach((byte, offset) => ram.write(before.pc + offset, byte));
  ram.write(0x4000, 0xcc); ram.write(0x4001, 0xcc);
  ram.accesses.length = 0; ram.fail = true;
  const cpu = new Cpu6809(ram, before);
  assert.throws(() => cpu.step(), error => error === failure);
  assert.deepEqual(cpu.snapshot(), snapshotOf({ ...before, x: 0x4002, pc: before.pc + 2 }));
  assert.deepEqual(ram.accesses, [...bytes.map((value, offset) => ({ kind: "read", address: before.pc + offset, value })),
    { kind: "write", address: 0x4000, value: 0x40 }]);
  assert.equal(ram.read(0x4000), 0x40); assert.equal(ram.read(0x4001), 0xcc);
});

// Interrupt vectors and frame bytes are taken from Motorola's programming manual.
const interruptCases = [
  { source: "swi", bytes: [0x3f], vector: 0xfffa, entire: true, masks: 0x50 },
  { source: "swi2", bytes: [0x10, 0x3f], vector: 0xfff4, entire: true, masks: 0 },
  { source: "swi3", bytes: [0x11, 0x3f], vector: 0xfff2, entire: true, masks: 0 },
  { source: "irq", bytes: [], vector: 0xfff8, entire: true, masks: 0x10 },
  { source: "firq", bytes: [], vector: 0xfff6, entire: false, masks: 0x50 },
  { source: "nmi", bytes: [], vector: 0xfffc, entire: true, masks: 0x50 },
] as const;

function enter(cpu: Cpu6809, source: typeof interruptCases[number]["source"]) {
  return source === "irq" || source === "firq" || source === "nmi" ? cpu.interrupt(source) : cpu.step();
}

// Descending S writes PC low/high, U low/high, Y low/high, X low/high, DP, B, A, CC.
function frameBytes(state: Cpu6809State, pc: number, cc: number, entire: boolean): number[] {
  return [pc % 256, Math.floor(pc / 256), ...(entire ? [state.u % 256, Math.floor(state.u / 256),
    state.y % 256, Math.floor(state.y / 256), state.x % 256, Math.floor(state.x / 256), state.dp, state.b, state.a] : []), cc];
}

for (const { source, bytes, vector, entire, masks } of interruptCases) {
  test(`6809 ${source.toUpperCase()} stacks the correct frame before masks/vector reads and RTI restores it`, () => {
    const ram = new ObservedRam();
    for (let cc = 0; cc < 256; cc++) {
      if ((source === "irq" && (cc & 0x10)) || (source === "firq" && (cc & 0x40))) continue;
      for (const s of [0, 1, 0x8000]) {
        const state = initialState({ pc: 0x0200, s, flags: flagsFor(cc) });
        bytes.forEach((byte, offset) => ram.write(state.pc + offset, byte));
        ram.write(vector, 0x40); ram.write(vector + 1, 0); ram.write(0x4000, 0x3b);
        const cpu = new Cpu6809(ram, state);
        const returnPc = state.pc + bytes.length;
        const savedCc = entire ? cc | 0x80 : cc & 0x7f;
        const frame = frameBytes(state, returnPc, savedCc, entire);
        const writes = frame.map((value, offset) => ({ kind: "write", address: wrapAddress(s - offset - 1), value }));
        // Wrapped stack writes can overwrite the vector itself; entry reads the updated RAM.
        const high = writes.find(access => access.address === vector)?.value ?? 0x40;
        const low = writes.find(access => access.address === vector + 1)?.value ?? 0;
        const target = high * 256 + low;
        ram.accesses.length = 0;
        const record = enter(cpu, source);
        const after = snapshotOf({ ...state, pc: target, s: wrapAddress(s - frame.length), flags: flagsFor(savedCc | masks) });
        const accesses = [...bytes.map((value, offset) => ({ kind: "read", address: state.pc + offset, value })),
          ...writes, { kind: "read", address: vector, value: high }, { kind: "read", address: vector + 1, value: low }];
        assert.deepEqual(record, { before: snapshotOf(state), after, accesses,
          instruction: bytes.length ? { address: state.pc, bytes } : null, outcome: bytes.length ? "executed" : "accepted",
          ...(bytes.length ? {} : { source }) });
        assert.deepEqual(ram.accesses, accesses);
        // Put RTI away from the possibly overlapping vector/frame and use a restored snapshot.
        const restored = new Cpu6809(ram, { ...after, pc: 0x4000 });
        ram.accesses.length = 0;
        const returned = restored.step();
        assert.deepEqual(returned.after, snapshotOf({ ...state, pc: returnPc, flags: flagsFor(savedCc) }));
        assert.deepEqual(returned.accesses, [{ kind: "read", address: 0x4000, value: 0x3b },
          ...[...writes].reverse().map(access => ({ ...access, kind: "read" }))]);
        assert.deepEqual(ram.accesses, returned.accesses);
      }
    }
  });
}

test("6809 software interrupt fetches wrap before stacking the return PC", () => {
  for (const { source, bytes, vector } of interruptCases.filter(entry => entry.bytes.length)) {
    const ram = new ObservedRam();
    bytes.forEach((byte, index) => ram.write(wrapAddress(0xffff + index), byte));
    ram.write(vector, 0x40); ram.write(vector + 1, 0);
    const cpu = new Cpu6809(ram, initialState({ pc: 0xffff, s: 0x8000 }));
    const record = enter(cpu, source);
    assert.deepEqual(record.instruction, { address: 0xffff, bytes });
    assert.equal(ram.read(0x7fff), bytes.length - 1);
    assert.equal(ram.read(0x7ffe), 0);
    assert.equal(record.after.pc, 0x4000);
  }
});

test("6809 SYNC has no stack effects and masked requests resume without entry or automatic redelivery", () => {
  for (const source of ["irq", "firq"] as const) {
    const ram = new ObservedRam();
    const state = initialState({ flags: flagsFor(0xff), pc: 0xffff });
    ram.write(0xffff, 0x13); ram.write(0, 0x12);
    const cpu = new Cpu6809(ram, state);
    ram.accesses.length = 0;
    const waited = cpu.step();
    const waiting = snapshotOf({ ...state, pc: 0, waitMode: "sync" });
    assert.deepEqual(waited, { before: snapshotOf(state), after: waiting, outcome: "waiting",
      instruction: { address: 0xffff, bytes: [0x13] }, accesses: [{ kind: "read", address: 0xffff, value: 0x13 }] });
    const saved = structuredClone(waited);
    ram.accesses.length = 0;
    ram.write(0, 0x12); // Editing the next opcode cannot release the wait.
    ram.accesses.length = 0;
    for (let repeat = 0; repeat < 2; repeat++) assert.deepEqual(cpu.step(), {
      before: waiting, after: waiting, instruction: null, accesses: [], outcome: "waiting",
    });
    assert.deepEqual(cpu.interrupt(source), { before: waiting, after: { ...waiting, waitMode: "none" },
      instruction: null, accesses: [], source, outcome: "resumed", reason: "masked" });
    assert.deepEqual(ram.accesses, []);
    assert.equal(cpu.step().after.pc, 1);
    assert.equal(cpu.interrupt(source).outcome, "ignored");
    assert.deepEqual(waited, saved);
  }
});

test("6809 CWAI applies every immediate mask, forces E, and saves exactly one full frame", () => {
  const ram = new ObservedRam();
  for (let mask = 0; mask < 256; mask++) {
    for (const cc of [0, 0x55, 0xaa, 0xff]) {
      const state = initialState({ pc: 0x200, s: 0x8000, flags: flagsFor(cc) });
      ram.write(0x200, 0x3c); ram.write(0x201, mask);
      const cpu = new Cpu6809(ram, state);
      const savedCc = (cc & mask) | 0x80;
      const frame = frameBytes(state, 0x202, savedCc, true);
      ram.accesses.length = 0;
      const record = cpu.step();
      assert.deepEqual(record, { before: snapshotOf(state), after: snapshotOf({ ...state, pc: 0x202,
        s: 0x7ff4, waitMode: "cwai", flags: flagsFor(savedCc) }), outcome: "waiting",
        instruction: { address: 0x200, bytes: [0x3c, mask] }, accesses: [
          { kind: "read", address: 0x200, value: 0x3c }, { kind: "read", address: 0x201, value: mask },
          ...frame.map((value, offset) => ({ kind: "write", address: 0x7fff - offset, value })),
        ] });
      assert.deepEqual(record.accesses, ram.accesses);
      ram.accesses.length = 0;
      assert.equal(cpu.step().instruction, null);
      assert.deepEqual(ram.accesses, []);
    }
  }
});

for (const waitMode of ["sync", "cwai"] as const) {
  test(`6809 ${waitMode.toUpperCase()} survives snapshots and distinguishes masked, unarmed, and accepted offers`, () => {
    for (const { source, vector, masks, entire } of interruptCases) {
      if (source !== "irq" && source !== "firq" && source !== "nmi") continue;
      for (const masked of [false, true]) {
        const ram = new ObservedRam();
        const state = initialState({ waitMode, nmiArmed: !masked, pc: 0x2345, s: 0x8000,
          flags: flagsFor(masked ? 0xd0 : 0x80) });
        ram.write(vector, 0x40); ram.write(vector + 1, 0);
        const cpu = new Cpu6809(ram, state);
        const restored = new Cpu6809(ram, cpu.snapshot());
        ram.accesses.length = 0;
        const record = restored.interrupt(source);
        if (masked) {
          const resumed: boolean = waitMode === "sync" && source !== "nmi";
          assert.deepEqual(record, { before: snapshotOf(state), after: snapshotOf({ ...state, waitMode: resumed ? "none" : waitMode }),
            source, outcome: resumed ? "resumed" : "ignored", reason: source === "nmi" ? "unarmed" : "masked",
            instruction: null, accesses: [] });
        } else {
          const savedCc = waitMode === "cwai" || entire ? 0x80 : 0;
          assert.equal(record.outcome, "accepted");
          assert.deepEqual(record.after, snapshotOf({ ...state, waitMode: "none", pc: 0x4000,
            s: waitMode === "cwai" ? 0x8000 : entire ? 0x7ff4 : 0x7ffd, flags: flagsFor(savedCc | masks) }));
          if (waitMode === "cwai") assert.deepEqual(record.accesses, [
            { kind: "read", address: vector, value: 0x40 }, { kind: "read", address: vector + 1, value: 0 },
          ]);
        }
        assert.deepEqual(record.accesses, ram.accesses);
        assert.deepEqual(cpu.snapshot(), snapshotOf(state));
      }
    }
  });
}

test("6809 RTI trusts current stack RAM and E, including edited or caller-created frames", () => {
  const ram = new ObservedRam();
  ram.write(0x200, 0x3b);
  for (let cc = 0; cc < 256; cc++) {
    const full = cc >= 0x80;
    const frame = full ? [cc, 0x91, 0xa2, 0xb3, 0xc4, 0xd5, 0xe6, 0xf7, 0x08, 0x19, 0x2a, 0x3b] : [cc, 0x2a, 0x3b];
    const s = 0xfffa;
    const state = initialState({ pc: 0x200, s, nmiArmed: false, flags: flagsFor(255 - cc) });
    const cpu = new Cpu6809(ram, state);
    frame.forEach((byte, offset) => ram.write(wrapAddress(s + offset), byte));
    ram.accesses.length = 0;
    const record = cpu.step();
    assert.deepEqual(record.after, snapshotOf({ ...state, flags: flagsFor(cc), s: wrapAddress(s + frame.length),
      pc: 0x2a3b, nmiArmed: true, ...(full ? { a: 0x91, b: 0xa2, dp: 0xb3, x: 0xc4d5, y: 0xe6f7, u: 0x0819 } : {}) }));
    assert.deepEqual(record.accesses, [{ kind: "read", address: 0x200, value: 0x3b },
      ...frame.map((value, offset) => ({ kind: "read", address: wrapAddress(s + offset), value }))]);
    assert.deepEqual(ram.accesses, record.accesses);
  }
});

test("6809 NMI arming follows S initialization and stack instructions, not simply a nonzero S", () => {
  const cases = [
    { bytes: [0x10, 0xce, 0, 0], armed: true }, // LDS #0 still initializes S.
    { bytes: [0x10, 0xde, 0x80], armed: true }, // LDS direct
    { bytes: [0x10, 0xee, 0x84], armed: true }, // LDS ,X
    { bytes: [0x10, 0xfe, 0x30, 0], armed: true }, // LDS extended
    { bytes: [0x32, 0xe4], armed: true }, // LEAS ,S
    { bytes: [0x1f, 0x14], armed: true }, // TFR X,S
    { bytes: [0x1e, 0x14], armed: true }, // EXG X,S
    { bytes: [0x1e, 0x41], armed: true }, // EXG S,X
    { bytes: [0x1f, 0x44], armed: true }, // TFR S,S
    { bytes: [0x37, 0x40], armed: true }, // PULU S
    ...[0x34, 0x35].flatMap(opcode => [0, 1, 0x80].map(mask => ({ bytes: [opcode, mask], armed: mask !== 0 }))),
    ...[0xe0, 0xe1, 0xe2, 0xe3, 0xf1, 0xf3].map(postbyte => ({ bytes: [0xa6, postbyte], armed: true })),
    { bytes: [0x3b], armed: true }, // RTI, even a short frame
    { bytes: [0xa6, 0xe4], armed: false }, // LDA ,S has no auto-update
    { bytes: [0x1f, 0x41], armed: false }, // TFR S,X only reads S
    { bytes: [0x36, 0x40], armed: false }, // PSHU S only reads S
    { bytes: [0x37, 0x02], armed: false }, // PULU A
    { bytes: [0xbd, 0x40, 0], armed: false }, // JSR
    { bytes: [0x39], armed: false }, // RTS
    { bytes: [0x3f], armed: false }, // SWI's implicit stack use
    { bytes: [0x3c, 0xff], armed: false }, // CWAI's implicit stack use
    { bytes: [0x32, 0xe7], armed: false }, // Rejected indexed postbyte
    { bytes: [0x1f, 0x84], armed: false }, // Rejected mixed-width transfer
  ];
  for (const { bytes, armed } of cases) {
    for (const wasArmed of [false, true]) {
      const ram = new ObservedRam();
      const cpu = new Cpu6809(ram, initialState({ pc: 0x200, nmiArmed: wasArmed }));
      bytes.forEach((byte, offset) => ram.write(0x200 + offset, byte));
      const record = cpu.step();
      assert.equal(record.after.nmiArmed, wasArmed || armed, bytes.map(byte => byte.toString(16)).join(" "));
      const restored = new Cpu6809(ram, record.after);
      assert.equal(restored.interrupt("nmi").outcome, wasArmed || armed ? "accepted" : "ignored");
    }
  }
});

test("6809 validates wait modes, NMI state, and request sources without RAM access", () => {
  const ram = new ObservedRam();
  for (const waitMode of [undefined, null, false, 0, "SYNC", "waiting", ""]) {
    assert.throws(() => new Cpu6809(ram, { ...initialState(), ...{ waitMode } } as Cpu6809State), RangeError);
  }
  for (const nmiArmed of [undefined, null, 0, 1, "true"]) {
    assert.throws(() => new Cpu6809(ram, { ...initialState(), ...{ nmiArmed } } as unknown as Cpu6809State), TypeError);
  }
  const cpu = new Cpu6809(ram, initialState());
  for (const source of [undefined, null, 0, "IRQ", "swi", "reset", "toString"]) {
    assert.throws(() => Reflect.apply(cpu.interrupt, cpu, [source]), RangeError);
  }
  assert.deepEqual(cpu.snapshot(), snapshotOf(initialState()));
  assert.deepEqual(ram.accesses, []);
});

class InterruptFaultRam extends ObservedRam {
  failAt = -1;
  attempts = 0;
  readonly failure = new Error("interrupt memory failure");
  #attempt(): void { if (this.attempts++ === this.failAt) throw this.failure; }
  override read(address: number): number { this.#attempt(); return super.read(address); }
  override write(address: number, value: number): void { this.#attempt(); super.write(address, value); }
  start(failAt: number): void { this.failAt = failAt; this.attempts = 0; this.accesses.length = 0; }
}

test("6809 failed interrupt entry retains completed effects, including predecrement before a failed write", () => {
  for (const { source, bytes, vector, entire, masks } of interruptCases) {
    const frameLength = entire ? 12 : 3;
    for (let failAt = 0; failAt < bytes.length + frameLength + 2; failAt++) {
      const ram = new InterruptFaultRam();
      const state = initialState({ pc: 0x200, s: 0x8000, flags: flagsFor(0x2b) });
      bytes.forEach((byte, offset) => ram.write(0x200 + offset, byte));
      ram.write(vector, 0x40); ram.write(vector + 1, 0);
      const cpu = new Cpu6809(ram, state);
      ram.start(failAt);
      assert.throws(() => enter(cpu, source), error => error === ram.failure);
      const fetched = Math.min(failAt, bytes.length);
      const begunFrame = failAt >= bytes.length;
      const writes = Math.min(Math.max(failAt - bytes.length + 1, 0), frameLength);
      const vectorPhase = failAt >= bytes.length + frameLength;
      const savedCc = entire ? 0xab : 0x2b;
      assert.deepEqual(cpu.snapshot(), snapshotOf({ ...state, pc: 0x200 + fetched, s: 0x8000 - writes,
        flags: flagsFor(begunFrame ? savedCc | (vectorPhase ? masks : 0) : 0x2b) }));
      assert.equal(ram.accesses.length, failAt);
      ram.start(-1);
      // A failed transition releases the execution guard; reset still commits only after both reads.
      ram.write(0xfffe, 2); ram.write(0xffff, 0);
      assert.equal(cpu.reset().after.pc, 0x200);
    }
  }
});

test("6809 failed CWAI does not enter wait early, and failed wakeup never stacks a second frame", () => {
  for (let failAt = 0; failAt < 14; failAt++) {
    const ram = new InterruptFaultRam();
    const state = initialState({ pc: 0x200, s: 0x8000, flags: flagsFor(0x7f) });
    ram.write(0x200, 0x3c); ram.write(0x201, 0xaf);
    const cpu = new Cpu6809(ram, state);
    ram.start(failAt);
    assert.throws(() => cpu.step(), error => error === ram.failure);
    assert.deepEqual(cpu.snapshot(), snapshotOf({ ...state, pc: 0x200 + Math.min(failAt, 2),
      s: 0x8000 - Math.max(0, failAt - 1), flags: flagsFor(failAt < 2 ? 0x7f : 0xaf) }));
    assert.equal(ram.accesses.length, failAt);
  }
  for (const source of ["irq", "firq", "nmi"] as const) {
    for (let failAt = 0; failAt < 2; failAt++) {
      const ram = new InterruptFaultRam();
      const state = initialState({ waitMode: "cwai", flags: flagsFor(0x8f) });
      const cpu = new Cpu6809(ram, state);
      ram.start(failAt);
      assert.throws(() => cpu.interrupt(source), error => error === ram.failure);
      assert.deepEqual(cpu.snapshot(), snapshotOf({ ...state, waitMode: "none", flags: flagsFor(source === "irq" ? 0x9f : 0xdf) }));
      assert.equal(ram.accesses.length, failAt);
      assert.ok(ram.accesses.every(access => access.kind === "read"));
    }
  }
});

test("6809 failed RTI commits only successfully read registers and never advances S for a failed read", () => {
  for (const full of [false, true]) {
    const frame = full ? [0xab, 0x91, 0xa2, 0xb3, 0xc4, 0xd5, 0xe6, 0xf7, 0x08, 0x19, 0x2a, 0x3b] : [0x2b, 0x2a, 0x3b];
    for (let failAt = 0; failAt <= frame.length; failAt++) {
      const ram = new InterruptFaultRam();
      const state = initialState({ pc: 0x200, s: 0x8000, nmiArmed: false, flags: flagsFor(0x54) });
      ram.write(0x200, 0x3b);
      frame.forEach((byte, offset) => ram.write(0x8000 + offset, byte));
      const cpu = new Cpu6809(ram, state);
      ram.start(failAt);
      assert.throws(() => cpu.step(), error => error === ram.failure);
      const count = Math.max(0, failAt - 1);
      assert.deepEqual(cpu.snapshot(), snapshotOf({ ...state, pc: failAt ? 0x201 : 0x200, s: 0x8000 + count,
        ...(count >= 1 ? { flags: flagsFor(full ? 0xab : 0x2b) } : {}),
        ...(full && count >= 2 ? { a: 0x91 } : {}), ...(full && count >= 3 ? { b: 0xa2 } : {}),
        ...(full && count >= 4 ? { dp: 0xb3 } : {}), ...(full && count >= 6 ? { x: 0xc4d5 } : {}),
        ...(full && count >= 8 ? { y: 0xe6f7 } : {}), ...(full && count >= 10 ? { u: 0x0819 } : {}),
      }));
      assert.equal(ram.accesses.length, failAt);
    }
  }
});

test("6809 reset releases both waits and disarms NMI only after both vector reads succeed", () => {
  for (const waitMode of ["none", "sync", "cwai"] as const) {
    for (const failAt of [0, 1, -1]) {
      const ram = new InterruptFaultRam();
      const state = initialState({ waitMode });
      ram.write(0xfffe, 0x20); ram.write(0xffff, 0x12);
      const cpu = new Cpu6809(ram, state);
      ram.start(failAt);
      if (failAt >= 0) {
        assert.throws(() => cpu.reset(), error => error === ram.failure);
        assert.deepEqual(cpu.snapshot(), snapshotOf(state));
        ram.start(-1);
      }
      assert.deepEqual(cpu.reset().after, snapshotOf({ ...state, pc: 0x2012, dp: 0,
        flags: { ...state.flags, f: true, i: true }, waitMode: "none", nmiArmed: false }));
      ram.accesses.length = 0;
      assert.equal(cpu.interrupt("nmi").outcome, "ignored");
      assert.deepEqual(ram.accesses, []);
    }
  }
});

test("6809 RAM callbacks can inspect snapshots but cannot reenter step, reset, or interrupt", () => {
  for (const operation of ["step", "reset", "interrupt"] as const) {
    let cpu: Cpu6809;
    let callbacks = 0;
    class CallbackRam extends ObservedRam {
      enabled = false;
      #callback(): void {
        if (!this.enabled) return;
        callbacks++;
        assert.ok(cpu.snapshot().pc >= 0);
        for (const mutate of [() => cpu.step(), () => cpu.reset(), () => cpu.interrupt("nmi")]) {
          assert.throws(mutate, /must not be reentrant/);
        }
      }
      override read(address: number): number { this.#callback(); return super.read(address); }
      override write(address: number, value: number): void { this.#callback(); super.write(address, value); }
    }
    const ram = new CallbackRam();
    ram.write(0x200, 0x3f); // Exercise writes and vector reads from an instruction too.
    cpu = new Cpu6809(ram, initialState({ pc: 0x200 }));
    ram.enabled = true;
    const record = operation === "interrupt" ? cpu.interrupt("nmi") : cpu[operation]();
    assert.equal(callbacks, record.accesses.length);
    assert.equal(cpu.reset().after.pc, 0);
  }
});

test("6809 failed S loads do not arm NMI, but completed indexed S updates remain visible", () => {
  for (const { bytes, failAt, armed, s } of [
    { bytes: [0x10, 0xce, 0x80, 0], failAt: 3, armed: false, s: 0x8000 },
    { bytes: [0x10, 0xfe, 0x30, 0], failAt: 5, armed: false, s: 0x8000 },
    { bytes: [0x37, 0x40], failAt: 3, armed: false, s: 0x8000 },
    { bytes: [0x32, 0x9f, 0x30, 0], failAt: 5, armed: false, s: 0x8000 },
    { bytes: [0xa6, 0xe1], failAt: 2, armed: true, s: 0x8002 },
    { bytes: [0xa6, 0xf3], failAt: 2, armed: true, s: 0x7ffe },
  ]) {
    const ram = new InterruptFaultRam();
    bytes.forEach((byte, offset) => ram.write(0x200 + offset, byte));
    const cpu = new Cpu6809(ram, initialState({ pc: 0x200, s: 0x8000, nmiArmed: false }));
    ram.start(failAt);
    assert.throws(() => cpu.step(), error => error === ram.failure);
    assert.equal(cpu.snapshot().nmiArmed, armed);
    assert.equal(cpu.snapshot().s, s);
  }
});
