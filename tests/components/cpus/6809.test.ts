import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu6809 } from "../../../src/components/cpus/6809.js";
import type { Cpu6809Flags, Cpu6809State } from "../../../src/components/cpus/6809.js";
import { Ram } from "../../../src/components/memory/ram.js";
import { ObservedRam } from "../../helpers/observed-ram.js";

function initialState(overrides: Partial<Cpu6809State> = {}): Cpu6809State {
  return {
    a: 0x11, b: 0x34, dp: 0x56, x: 0x2345, y: 0x4567, s: 0x89ab, u: 0xcdef, pc: 0x1234,
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
    ram.write(0x2042, 0x00);
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
    assert.deepEqual(next.instruction, { address: 0x2042, bytes: offset === 0x42 ? [0x86, 0x5a] : [0x00] });
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

test("every unsupported 6809 byte, including prefixes, repeatedly reads only itself without advancing PC", () => {
  for (let opcode = 0; opcode <= 0xff; opcode++) {
    if ([0x34, 0x35, 0x36, 0x37, 0x86, 0x8b, 0x96, 0x97, 0xb7].includes(opcode)) continue;
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
