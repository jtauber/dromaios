import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu6502 } from "../../../src/components/cpus/6502.js";
import type { Cpu6502Flags, Cpu6502State } from "../../../src/components/cpus/6502.js";
import { Ram } from "../../../src/components/memory/ram.js";
import { ObservedRam } from "../../helpers/observed-ram.js";

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

test("6502 CLC clears either incoming carry value, preserves other state, and reads only its opcode", () => {
  const preservedFlags = [
    { n: false, v: false, d: false, i: false, z: false },
    { n: true, v: true, d: true, i: true, z: true },
    { n: true, v: false, d: true, i: false, z: true },
    { n: false, v: true, d: false, i: true, z: false },
  ];
  for (const preserved of preservedFlags) {
    for (const c of [false, true]) {
      const ram = new ObservedRam();
      ram.write(0x1234, 0x18);
      ram.write(0x1235, 0xa9);
      ram.accesses.length = 0;
      const before = initialState({ flags: { ...preserved, c } });
      const cpu = new Cpu6502(ram, before);
      const expectedAccesses = [{ kind: "read", address: 0x1234, value: 0x18 }];
      const record = cpu.step();
      assert.deepEqual(record, {
        instruction: { address: 0x1234, bytes: [0x18] },
        before,
        after: { ...before, pc: 0x1235, flags: { ...preserved, c: false } },
        accesses: expectedAccesses,
        outcome: "executed",
      });
      assert.deepEqual(cpu.snapshot(), record.after);
      assert.deepEqual(ram.accesses, expectedAccesses);
    }
  }
});

test("6502 CLC wraps PC at FFFF without fetching the next instruction", () => {
  for (const c of [false, true]) {
    const ram = new ObservedRam();
    ram.write(0xffff, 0x18);
    ram.write(0, 0xa9);
    ram.write(1, 2);
    ram.accesses.length = 0;
    const before = initialState({ pc: 0xffff, flags: { ...initialState().flags, c } });
    const cpu = new Cpu6502(ram, before);
    const record = cpu.step();
    const afterClear = { ...before, pc: 0, flags: { ...before.flags, c: false } };
    assert.deepEqual(record, {
      instruction: { address: 0xffff, bytes: [0x18] },
      before,
      after: afterClear,
      accesses: [{ kind: "read", address: 0xffff, value: 0x18 }],
      outcome: "executed",
    });
    assert.deepEqual(cpu.snapshot(), afterClear);
    assert.deepEqual(ram.accesses, record.accesses);
    const savedRecord = structuredClone(record);

    ram.accesses.length = 0;
    const next = cpu.step();
    assert.deepEqual(next, {
      instruction: { address: 0, bytes: [0xa9, 2] },
      before: afterClear,
      after: { ...afterClear, a: 2, pc: 2, flags: { ...afterClear.flags, n: false, z: false } },
      accesses: [
        { kind: "read", address: 0, value: 0xa9 },
        { kind: "read", address: 1, value: 2 },
      ],
      outcome: "executed",
    });
    assert.deepEqual(ram.accesses, next.accesses);
    assert.deepEqual(record, savedRecord);
  }
});

test("6502 LDA immediate replaces N/Z, preserves all other state, and performs exactly two reads", () => {
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

test("6502 LDA immediate wraps operand fetching and PC advancement at the 16-bit boundary", () => {
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

test("6502 LDA zero page fetches one address byte and replaces only A and N/Z with either D value", () => {
  for (const address of [0x00, 0x7f, 0x80, 0xff]) {
    for (const [value, n, z] of [
      [0x00, false, true], [0x01, false, false], [0x11, false, false],
      [0x7f, false, false], [0x80, true, false], [0xff, true, false],
    ] as const) {
      for (const flags of [
        { n: true, v: false, d: true, i: false, z: true, c: false },
        { n: false, v: true, d: false, i: true, z: false, c: true },
      ]) {
        const ram = new ObservedRam();
        ram.write(0x1234, 0xa5);
        ram.write(0x1235, address);
        const before = initialState({ flags });
        const cpu = new Cpu6502(ram, before);
        ram.write(address, value); // Read current RAM, including edits after construction.
        ram.accesses.length = 0;
        const record = cpu.step();
        assert.deepEqual(record, {
          instruction: { address: 0x1234, bytes: [0xa5, address] },
          before,
          after: { ...before, a: value, pc: 0x1236, flags: { ...flags, n, z } },
          accesses: [
            { kind: "read", address: 0x1234, value: 0xa5 },
            { kind: "read", address: 0x1235, value: address },
            { kind: "read", address, value },
          ],
          outcome: "executed",
        }, `address=${address}, value=${value}`);
        assert.deepEqual(cpu.snapshot(), record.after);
        assert.deepEqual(ram.accesses, record.accesses);
        assert.equal(ram.read(address), value);
      }
    }
  }
});

test("6502 zero-page loads and stores wrap instruction fetching while data stays in page zero", () => {
  for (const opcode of [0xa5, 0x85]) {
    for (const [pc, operandAddress, nextPc] of [
      [0xfffe, 0xffff, 0x0000], [0xffff, 0x0000, 0x0001],
    ] as const) {
      const ram = new ObservedRam();
      ram.write(pc, opcode);
      ram.write(operandAddress, 0xff);
      ram.write(0x00ff, 0x80);
      ram.accesses.length = 0;
      const before = initialState({ pc });
      const cpu = new Cpu6502(ram, before);
      const record = cpu.step();
      assert.deepEqual(record, {
        instruction: { address: pc, bytes: [opcode, 0xff] },
        before,
        after: opcode === 0xa5
          ? { ...before, a: 0x80, pc: nextPc, flags: { ...before.flags, n: true, z: false } }
          : { ...before, pc: nextPc },
        accesses: [
          { kind: "read", address: pc, value: opcode },
          { kind: "read", address: operandAddress, value: 0xff },
          opcode === 0xa5
            ? { kind: "read", address: 0x00ff, value: 0x80 }
            : { kind: "write", address: 0x00ff, value: 0x11 },
        ],
        outcome: "executed",
      });
      assert.deepEqual(cpu.snapshot(), record.after);
      assert.deepEqual(ram.accesses, record.accesses);
      assert.equal(ram.read(0x00ff), opcode === 0xa5 ? 0x80 : 0x11);
    }
  }
});

test("6502 LDA zero page can read its opcode, operand, or next instruction as data", () => {
  for (const [address, value, n] of [
    [0x40, 0xa5, true], [0x41, 0x41, false], [0x42, 0x80, true],
  ] as const) {
    const ram = new ObservedRam();
    ram.write(0x0040, 0xa5);
    ram.write(0x0041, address);
    ram.write(0x0042, 0x80);
    ram.accesses.length = 0;
    const before = initialState({ pc: 0x0040 });
    const cpu = new Cpu6502(ram, before);
    const record = cpu.step();
    assert.deepEqual(record, {
      instruction: { address: 0x0040, bytes: [0xa5, address] },
      before,
      after: { ...before, a: value, pc: 0x0042, flags: { ...before.flags, n, z: false } },
      accesses: [
        { kind: "read", address: 0x0040, value: 0xa5 },
        { kind: "read", address: 0x0041, value: address },
        { kind: "read", address, value },
      ],
      outcome: "executed",
    });
    assert.deepEqual(cpu.snapshot(), record.after);
    assert.deepEqual(ram.accesses, record.accesses);
  }
});

test("6502 binary ADC immediate replaces N/V/Z/C, preserves other state, and reads exactly two bytes", () => {
  const cases = [
    { a: 0x02, value: 0x03, carry: false, result: 0x05,
      flags: { n: false, v: false, z: false, c: false } },
    { a: 0x02, value: 0x03, carry: true, result: 0x06,
      flags: { n: false, v: false, z: false, c: false } },
    { a: 0xff, value: 0x01, carry: false, result: 0x00,
      flags: { n: false, v: false, z: true, c: true } },
    { a: 0x7f, value: 0x01, carry: false, result: 0x80,
      flags: { n: true, v: true, z: false, c: false } },
    { a: 0x80, value: 0x80, carry: false, result: 0x00,
      flags: { n: false, v: true, z: true, c: true } },
    { a: 0x7f, value: 0x00, carry: true, result: 0x80,
      flags: { n: true, v: true, z: false, c: false } },
    { a: 0xff, value: 0x00, carry: true, result: 0x00,
      flags: { n: false, v: false, z: true, c: true } },
    { a: 0x7f, value: 0x80, carry: true, result: 0x00,
      flags: { n: false, v: false, z: true, c: true } },
  ];
  for (const { a, value, carry, result, flags } of cases) {
    for (const oldNVZ of [false, true]) {
      for (const i of [false, true]) {
        const ram = new ObservedRam();
        ram.write(0x1234, 0x69);
        ram.write(0x1235, value);
        ram.accesses.length = 0;
        const before = initialState({
          a, flags: { n: oldNVZ, v: oldNVZ, d: false, i, z: oldNVZ, c: carry },
        });
        const cpu = new Cpu6502(ram, before);
        const expectedAccesses = [
          { kind: "read", address: 0x1234, value: 0x69 },
          { kind: "read", address: 0x1235, value },
        ];
        const record = cpu.step();
        const context = `A=${a}, operand=${value}, C=${carry}, old N/V/Z=${oldNVZ}, I=${i}`;
        assert.deepEqual(record, {
          instruction: { address: 0x1234, bytes: [0x69, value] },
          before,
          after: { ...before, a: result, pc: 0x1236, flags: { ...flags, d: false, i } },
          accesses: expectedAccesses,
          outcome: "executed",
        }, context);
        assert.deepEqual(cpu.snapshot(), record.after, context);
        assert.deepEqual(ram.accesses, expectedAccesses, context);
      }
    }
  }
});

test("6502 binary ADC matches unsigned and signed addition for every operand pair and carry input", () => {
  const ram = new Ram(0x10000);
  ram.write(0, 0x69);
  for (let value = 0; value < 256; value++) {
    ram.write(1, value);
    for (let a = 0; a < 256; a++) {
      for (const carry of [false, true]) {
        // Arithmetic expectations are independent of the CPU's bit masks and XORs.
        const unsignedSum = a + value + Number(carry);
        const signedSum = (a < 128 ? a : a - 256)
          + (value < 128 ? value : value - 256) + Number(carry);
        const result = unsignedSum % 256;
        for (const oldNVZ of [false, true]) {
          const before = initialState({
            a, pc: 0,
            flags: { n: oldNVZ, v: oldNVZ, d: false, i: oldNVZ, z: oldNVZ, c: carry },
          });
          const cpu = new Cpu6502(ram, before);
          const record = cpu.step();
          assert.equal(record.outcome, "executed");
          assert.deepEqual(record.after, {
            ...before, a: result, pc: 2,
            flags: {
              n: result >= 128, v: signedSum < -128 || signedSum > 127,
              d: false, i: oldNVZ, z: result === 0, c: unsignedSum >= 256,
            },
          }, `A=${a}, operand=${value}, C=${carry}, old N/V/Z=${oldNVZ}`);
        }
      }
    }
  }
});

test("6502 binary ADC wraps operand fetching and PC advancement at the 16-bit boundary", () => {
  for (const [address, operandAddress, nextPc] of [
    [0xfffe, 0xffff, 0x0000],
    [0xffff, 0x0000, 0x0001],
  ] as const) {
    const ram = new ObservedRam();
    ram.write(address, 0x69);
    ram.write(operandAddress, 0);
    ram.accesses.length = 0;
    const before = initialState({ a: 0xff, pc: address, flags: { ...initialState().flags, d: false } });
    const cpu = new Cpu6502(ram, before);
    const record = cpu.step();
    assert.deepEqual(record, {
      instruction: { address, bytes: [0x69, 0] },
      before,
      after: { ...before, a: 0, pc: nextPc, flags: { ...before.flags, n: false, v: false, z: true, c: true } },
      accesses: [
        { kind: "read", address, value: 0x69 },
        { kind: "read", address: operandAddress, value: 0 },
      ],
      outcome: "executed",
    });
    assert.deepEqual(cpu.snapshot(), record.after);
    assert.deepEqual(ram.accesses, record.accesses);
  }
});

test("successive 6502 ADC instructions use live carry and operands while keeping independent records", () => {
  const ram = new ObservedRam();
  for (const [address, value] of [0x69, 0, 0x69, 0, 0x69, 0].entries()) {
    ram.write(address, value);
  }
  const cpu = new Cpu6502(ram, initialState({
    a: 0xff, pc: 0, flags: { ...initialState().flags, d: false },
  }));
  const first = cpu.step();
  const savedFirst = structuredClone(first);
  assert.equal(first.after.a, 0);
  assert.equal(first.after.flags.c, true);
  ram.write(1, 0xff);
  ram.write(3, 0x7f);
  ram.accesses.length = 0;
  const second = cpu.step();
  const savedSecond = structuredClone(second);
  assert.deepEqual(second, {
    instruction: { address: 2, bytes: [0x69, 0x7f] },
    before: first.after,
    after: { ...first.after, a: 0x80, pc: 4, flags: { ...first.after.flags, n: true, v: true, z: false, c: false } },
    accesses: [
      { kind: "read", address: 2, value: 0x69 },
      { kind: "read", address: 3, value: 0x7f },
    ],
    outcome: "executed",
  });
  assert.deepEqual(ram.accesses, second.accesses);
  assert.deepEqual(first, savedFirst);
  Reflect.set(first.before.flags, "d", true);
  assert.deepEqual(first.after, savedFirst.after);
  Reflect.set(first.after.flags, "c", false);
  Reflect.set(first.instruction.bytes, 1, 0xff);
  assert.ok(first.accesses[1]);
  Reflect.set(first.accesses[1], "value", 0xff);
  Reflect.set(cpu.snapshot().flags, "c", true);
  assert.deepEqual(cpu.snapshot(), savedSecond.after);
  const third = cpu.step();
  assert.deepEqual(third.before, savedSecond.after);
  assert.deepEqual(third.after, {
    ...savedSecond.after, pc: 6, flags: { ...savedSecond.after.flags, v: false },
  });
  assert.deepEqual(second, savedSecond);
});

test("6502 decimal ADC repeatedly reads only its opcode and preserves all state, including at FFFF", () => {
  for (const address of [0x1234, 0xfffe, 0xffff]) {
    for (const setFlags of [false, true]) {
      const ram = new ObservedRam();
      ram.write(address, 0x69);
      ram.write((address + 1) & 0xffff, 0x80);
      const before = initialState({
        pc: address,
        flags: { n: setFlags, v: setFlags, d: true, i: setFlags, z: setFlags, c: setFlags },
      });
      const cpu = new Cpu6502(ram, before);
      for (let attempt = 0; attempt < 2; attempt++) {
        ram.accesses.length = 0;
        const record = cpu.step();
        assert.deepEqual(record, {
          instruction: { address, bytes: [0x69] },
          before,
          after: before,
          accesses: [{ kind: "read", address, value: 0x69 }],
          outcome: "unsupported",
          reason: "decimal-mode",
        });
        assert.deepEqual(cpu.snapshot(), before);
        assert.deepEqual(ram.accesses, record.accesses);
      }
    }
  }
});

test("6502 reset preserves the decimal ADC limitation, and replacing the opcode permits execution", () => {
  const ram = new ObservedRam();
  ram.write(0x1234, 0x69);
  ram.write(0x1235, 0);
  ram.write(0xfffc, 0x34);
  ram.write(0xfffd, 0x12);
  const cpu = new Cpu6502(ram, initialState());
  const first = cpu.step();
  const savedFirst = structuredClone(first);
  const reset = cpu.reset();
  assert.equal(reset.after.flags.d, true);
  ram.accesses.length = 0;
  const second = cpu.step();
  const savedSecond = structuredClone(second);
  assert.deepEqual(second, {
    ...savedFirst, before: reset.after, after: reset.after,
  });
  assert.deepEqual(ram.accesses, second.accesses);
  assert.deepEqual(first, savedFirst);
  Reflect.set(first.before.flags, "d", false);
  assert.deepEqual(first.after, savedFirst.after);
  Reflect.set(first.after.flags, "d", false);
  Reflect.set(first.instruction.bytes, 0, 0xa9);
  Reflect.set(first.accesses, 0, { kind: "write", address: 0, value: 0xff });
  assert.deepEqual(cpu.snapshot(), reset.after);

  ram.write(0x1234, 0xa9);
  ram.accesses.length = 0;
  const resumed = cpu.step();
  assert.deepEqual(resumed, {
    instruction: { address: 0x1234, bytes: [0xa9, 0] },
    before: reset.after,
    after: { ...reset.after, a: 0, pc: 0x1236, flags: { ...reset.after.flags, n: false, z: true } },
    accesses: [
      { kind: "read", address: 0x1234, value: 0xa9 },
      { kind: "read", address: 0x1235, value: 0 },
    ],
    outcome: "executed",
  });
  assert.deepEqual(cpu.snapshot(), resumed.after);
  assert.deepEqual(ram.accesses, resumed.accesses);
  assert.deepEqual(second, savedSecond);
});

test("6502 STA absolute decodes low/high bytes and writes once while preserving state, including D", () => {
  for (const [low, high, destination] of [
    [0x34, 0x12, 0x1234],
    [0x00, 0x00, 0x0000],
    [0xff, 0xff, 0xffff],
  ] as const) {
    for (const a of [0x00, 0x80, 0xff]) {
      for (const flags of [
        { n: true, v: false, d: true, i: false, z: true, c: false },
        { n: false, v: true, d: false, i: true, z: false, c: true },
      ]) {
        const ram = new ObservedRam();
        ram.write(0x0200, 0x8d);
        ram.write(0x0201, low);
        ram.write(0x0202, high);
        // Writing is required even when the destination already contains A.
        ram.write(destination, 0x80);
        ram.accesses.length = 0;
        const before = initialState({ a, pc: 0x0200, flags });
        const cpu = new Cpu6502(ram, before);
        const expectedAccesses = [
          { kind: "read", address: 0x0200, value: 0x8d },
          { kind: "read", address: 0x0201, value: low },
          { kind: "read", address: 0x0202, value: high },
          { kind: "write", address: destination, value: a },
        ];
        const record = cpu.step();
        const context = `destination=${destination}, A=${a}, flags=${JSON.stringify(flags)}`;
        assert.deepEqual(record, {
          instruction: { address: 0x0200, bytes: [0x8d, low, high] },
          before,
          after: { ...before, pc: 0x0203 },
          accesses: expectedAccesses,
          outcome: "executed",
        }, context);
        assert.deepEqual(cpu.snapshot(), record.after, context);
        assert.deepEqual(ram.accesses, expectedAccesses, context);
        assert.equal(ram.read(destination), a, context);
      }
    }
  }
});

test("6502 STA absolute wraps both operand fetching and PC advancement at the 16-bit boundary", () => {
  for (const [address, lowAddress, highAddress, nextPc] of [
    [0xfffd, 0xfffe, 0xffff, 0x0000],
    [0xfffe, 0xffff, 0x0000, 0x0001],
    [0xffff, 0x0000, 0x0001, 0x0002],
  ] as const) {
    const ram = new ObservedRam();
    ram.write(address, 0x8d);
    ram.write(lowAddress, 0x56);
    ram.write(highAddress, 0x34);
    ram.accesses.length = 0;
    const before = initialState({ a: 0xa5, pc: address });
    const cpu = new Cpu6502(ram, before);
    const record = cpu.step();
    assert.deepEqual(record, {
      instruction: { address, bytes: [0x8d, 0x56, 0x34] },
      before,
      after: { ...before, pc: nextPc },
      accesses: [
        { kind: "read", address, value: 0x8d },
        { kind: "read", address: lowAddress, value: 0x56 },
        { kind: "read", address: highAddress, value: 0x34 },
        { kind: "write", address: 0x3456, value: 0xa5 },
      ],
      outcome: "executed",
    });
    assert.deepEqual(cpu.snapshot(), record.after);
    assert.deepEqual(ram.accesses, record.accesses);
    assert.equal(ram.read(0x3456), 0xa5);
  }
});

test("6502 STA absolute can overwrite its opcode or either operand while retaining the fetched bytes", () => {
  for (const [low, destination] of [
    [0x00, 0x0200], [0x01, 0x0201], [0x02, 0x0202],
  ] as const) {
    const ram = new ObservedRam();
    ram.write(0x0200, 0x8d);
    ram.write(0x0201, low);
    ram.write(0x0202, 0x02);
    ram.accesses.length = 0;
    const before = initialState({ a: 0xe7, pc: 0x0200 });
    const cpu = new Cpu6502(ram, before);
    const record = cpu.step();
    assert.deepEqual(record, {
      instruction: { address: 0x0200, bytes: [0x8d, low, 0x02] },
      before,
      after: { ...before, pc: 0x0203 },
      accesses: [
        { kind: "read", address: 0x0200, value: 0x8d },
        { kind: "read", address: 0x0201, value: low },
        { kind: "read", address: 0x0202, value: 0x02 },
        { kind: "write", address: destination, value: 0xe7 },
      ],
      outcome: "executed",
    });
    assert.deepEqual(cpu.snapshot(), record.after);
    assert.deepEqual(ram.accesses, record.accesses);
    assert.equal(ram.read(destination), 0xe7);
  }
});

test("6502 STA records keep written values independent of later stores, memory changes, and caller edits", () => {
  const ram = new ObservedRam();
  // Store 80 at 1234, load zero, then store zero at 1234.
  for (const [address, value] of [0x8d, 0x34, 0x12, 0xa9, 0, 0x8d, 0x34, 0x12].entries()) {
    ram.write(address, value);
  }
  const cpu = new Cpu6502(ram, initialState({ a: 0x80, pc: 0 }));
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
    instruction: { address: 5, bytes: [0x8d, 0x34, 0x12] },
    before: load.after,
    after: { ...load.after, pc: 8 },
    accesses: [
      { kind: "read", address: 5, value: 0x8d },
      { kind: "read", address: 6, value: 0x34 },
      { kind: "read", address: 7, value: 0x12 },
      { kind: "write", address: 0x1234, value: 0 },
    ],
    outcome: "executed",
  });
  assert.deepEqual(ram.accesses, second.accesses);
  assert.deepEqual(first, savedFirst);
  Reflect.set(first.before.flags, "d", false);
  assert.deepEqual(first.after, savedFirst.after);
  Reflect.set(first.after, "a", 0xff);
  Reflect.set(first.instruction.bytes, 1, 0xff);
  assert.ok(first.accesses[3]);
  Reflect.set(first.accesses[3], "value", 0xff);
  Reflect.set(cpu.snapshot().flags, "z", false);
  assert.deepEqual(cpu.snapshot(), savedSecond.after);
  assert.deepEqual(second, savedSecond);
  assert.deepEqual(load, savedLoad);
  assert.equal(ram.read(0x1234), 0);
});

test("6502 STA zero page writes once without reading the destination and preserves all state except PC", () => {
  for (const address of [0x00, 0x7f, 0x80, 0xff]) {
    for (const a of [0x00, 0x80, 0xff]) {
      for (const flags of [
        { n: true, v: false, d: true, i: false, z: true, c: false },
        { n: false, v: true, d: false, i: true, z: false, c: true },
      ]) {
        const ram = new ObservedRam();
        ram.write(0x1234, 0x85);
        ram.write(0x1235, address);
        ram.write(address, 0x80); // Even an unchanged byte must be written.
        ram.accesses.length = 0;
        const before = initialState({ a, flags });
        const cpu = new Cpu6502(ram, before);
        const record = cpu.step();
        assert.deepEqual(record, {
          instruction: { address: 0x1234, bytes: [0x85, address] },
          before,
          after: { ...before, pc: 0x1236 },
          accesses: [
            { kind: "read", address: 0x1234, value: 0x85 },
            { kind: "read", address: 0x1235, value: address },
            { kind: "write", address, value: a },
          ],
          outcome: "executed",
        }, `address=${address}, A=${a}`);
        assert.deepEqual(cpu.snapshot(), record.after);
        assert.deepEqual(ram.accesses, record.accesses);
        assert.equal(ram.read(address), a);
      }
    }
  }
});

test("6502 STA zero page can overwrite its opcode, operand, or next instruction without changing captured bytes", () => {
  for (const address of [0x40, 0x41, 0x42]) {
    const ram = new ObservedRam();
    ram.write(0x0040, 0x85);
    ram.write(0x0041, address);
    ram.write(0x0042, 0x00);
    ram.accesses.length = 0;
    const before = initialState({ a: 0x18, pc: 0x0040 });
    const cpu = new Cpu6502(ram, before);
    const record = cpu.step();
    assert.deepEqual(record, {
      instruction: { address: 0x0040, bytes: [0x85, address] },
      before,
      after: { ...before, pc: 0x0042 },
      accesses: [
        { kind: "read", address: 0x0040, value: 0x85 },
        { kind: "read", address: 0x0041, value: address },
        { kind: "write", address, value: 0x18 },
      ],
      outcome: "executed",
    });
    assert.deepEqual(cpu.snapshot(), record.after);
    assert.deepEqual(ram.accesses, record.accesses);
    assert.equal(ram.read(address), 0x18);

    const saved = structuredClone(record);
    const next = cpu.step();
    assert.equal(next.outcome, address === 0x42 ? "executed" : "unsupported");
    assert.deepEqual(next.instruction, { address: 0x0042, bytes: [address === 0x42 ? 0x18 : 0x00] });
    ram.write(address, 0xff);
    cpu.reset();
    assert.deepEqual(record, saved);
  }
});

test("6502 PHA writes at the current page-one SP, then decrements it, preserving all flags", () => {
  for (const [sp, destination, nextSp] of [
    [0xab, 0x01ab, 0xaa], [0xff, 0x01ff, 0xfe], [0x00, 0x0100, 0xff],
  ] as const) {
    for (const a of [0x00, 0x01, 0x7f, 0x80, 0xff]) {
      for (const flags of [
        { n: false, v: false, d: false, i: false, z: false, c: false },
        { n: true, v: true, d: true, i: true, z: true, c: true },
        { n: true, v: false, d: true, i: false, z: false, c: true },
        { n: false, v: true, d: false, i: true, z: true, c: false },
      ]) {
        const ram = new ObservedRam();
        ram.write(0x1234, 0x48);
        ram.write(destination, 0x80); // An unchanged value must still be written.
        ram.accesses.length = 0;
        const before = initialState({ a, sp, flags });
        const cpu = new Cpu6502(ram, before);
        const record = cpu.step();
        assert.deepEqual(record, {
          instruction: { address: 0x1234, bytes: [0x48] },
          before,
          after: { ...before, pc: 0x1235, sp: nextSp },
          accesses: [
            { kind: "read", address: 0x1234, value: 0x48 },
            { kind: "write", address: destination, value: a },
          ],
          outcome: "executed",
        });
        assert.deepEqual(cpu.snapshot(), record.after);
        assert.deepEqual(ram.accesses, record.accesses);
        assert.equal(ram.read(destination), a);
      }
    }
  }
});

test("6502 PLA increments SP within page one, reads RAM, and replaces only A and N/Z", () => {
  for (const [sp, source, nextSp] of [
    [0xab, 0x01ac, 0xac], [0xfe, 0x01ff, 0xff], [0xff, 0x0100, 0x00],
  ] as const) {
    for (const [value, n, z] of [
      [0x00, false, true], [0x01, false, false], [0x11, false, false],
      [0x7f, false, false], [0x80, true, false], [0xff, true, false],
    ] as const) {
      for (const preserved of [
        { v: false, d: false, i: false, c: false },
        { v: true, d: true, i: true, c: true },
        { v: true, d: false, i: true, c: false },
        { v: false, d: true, i: false, c: true },
      ]) {
        for (const oldNZ of [false, true]) {
          const ram = new ObservedRam();
          ram.write(0x1234, 0x68);
          ram.write(source, value);
          ram.accesses.length = 0;
          const before = initialState({ sp, flags: { ...preserved, n: oldNZ, z: oldNZ } });
          const cpu = new Cpu6502(ram, before);
          const record = cpu.step();
          assert.deepEqual(record, {
            instruction: { address: 0x1234, bytes: [0x68] },
            before,
            after: { ...before, pc: 0x1235, sp: nextSp, a: value, flags: { ...preserved, n, z } },
            accesses: [
              { kind: "read", address: 0x1234, value: 0x68 },
              { kind: "read", address: source, value },
            ],
            outcome: "executed",
          });
          assert.deepEqual(cpu.snapshot(), record.after);
          assert.deepEqual(ram.accesses, record.accesses);
          assert.equal(ram.read(source), value); // Pulling does not erase the byte.
        }
      }
    }
  }
});

test("6502 PHA and PLA wrap PC at FFFF without fetching the following instruction", () => {
  for (const opcode of [0x48, 0x68]) {
    const ram = new ObservedRam();
    ram.write(0xffff, opcode);
    ram.write(0, 0x18);
    ram.write(0x0100, 0x80);
    ram.accesses.length = 0;
    const before = initialState({ a: 0x80, pc: 0xffff, sp: opcode === 0x48 ? 0 : 0xff });
    const cpu = new Cpu6502(ram, before);
    const after = { ...before, pc: 0, sp: opcode === 0x48 ? 0xff : 0 };
    const record = cpu.step();
    assert.deepEqual(record, {
      instruction: { address: 0xffff, bytes: [opcode] },
      before, after,
      accesses: [
        { kind: "read", address: 0xffff, value: opcode },
        { kind: opcode === 0x48 ? "write" : "read", address: 0x0100, value: 0x80 },
      ],
      outcome: "executed",
    });
    assert.deepEqual(cpu.snapshot(), after);
    assert.deepEqual(ram.accesses, record.accesses);
    ram.accesses.length = 0;
    assert.deepEqual(cpu.step(), {
      instruction: { address: 0, bytes: [0x18] },
      before: after,
      after: { ...after, pc: 1, flags: { ...after.flags, c: false } },
      accesses: [{ kind: "read", address: 0, value: 0x18 }],
      outcome: "executed",
    });
    assert.deepEqual(ram.accesses, [{ kind: "read", address: 0, value: 0x18 }]);
  }
});

test("6502 nested pushes and pulls restore bytes in reverse order across SP wrapping", () => {
  const ram = new ObservedRam();
  // Save 80, save 00, replace A with 55, then retrieve 00 and 80.
  for (const [offset, value] of [0xa9, 0x80, 0x48, 0xa9, 0, 0x48, 0xa9, 0x55, 0x68, 0x68].entries()) {
    ram.write(0x0200 + offset, value);
  }
  ram.accesses.length = 0;
  let before = initialState({ pc: 0x0200, sp: 0 });
  const cpu = new Cpu6502(ram, before);
  for (const [pc, a, sp, n, z] of [
    [0x0202, 0x80, 0x00, true, false],
    [0x0203, 0x80, 0xff, true, false],
    [0x0205, 0x00, 0xff, false, true],
    [0x0206, 0x00, 0xfe, false, true],
    [0x0208, 0x55, 0xfe, false, false],
    [0x0209, 0x00, 0xff, false, true],
    [0x020a, 0x80, 0x00, true, false],
  ] as const) {
    const record = cpu.step();
    const after = { ...before, pc, a, sp, flags: { ...before.flags, n, z } };
    assert.equal(record.outcome, "executed");
    assert.deepEqual(record.before, before);
    assert.deepEqual(record.after, after);
    assert.deepEqual(cpu.snapshot(), after);
    before = after;
  }
  assert.deepEqual(ram.accesses, [
    { kind: "read", address: 0x0200, value: 0xa9 },
    { kind: "read", address: 0x0201, value: 0x80 },
    { kind: "read", address: 0x0202, value: 0x48 },
    { kind: "write", address: 0x0100, value: 0x80 },
    { kind: "read", address: 0x0203, value: 0xa9 },
    { kind: "read", address: 0x0204, value: 0x00 },
    { kind: "read", address: 0x0205, value: 0x48 },
    { kind: "write", address: 0x01ff, value: 0x00 },
    { kind: "read", address: 0x0206, value: 0xa9 },
    { kind: "read", address: 0x0207, value: 0x55 },
    { kind: "read", address: 0x0208, value: 0x68 },
    { kind: "read", address: 0x01ff, value: 0x00 },
    { kind: "read", address: 0x0209, value: 0x68 },
    { kind: "read", address: 0x0100, value: 0x80 },
  ]);
  assert.equal(ram.read(0x0100), 0x80);
  assert.equal(ram.read(0x01ff), 0x00);
});

test("6502 stack accesses can overlap code without changing captured instruction bytes", () => {
  for (const sp of [0x80, 0x81]) {
    const ram = new ObservedRam();
    ram.write(0x0180, 0x48);
    ram.write(0x0181, 0x68);
    ram.accesses.length = 0;
    const before = initialState({ pc: 0x0180, sp, a: 0xa9 });
    const cpu = new Cpu6502(ram, before);
    const record = cpu.step();
    assert.deepEqual(record, {
      instruction: { address: 0x0180, bytes: [0x48] },
      before,
      after: { ...before, pc: 0x0181, sp: sp - 1 },
      accesses: [
        { kind: "read", address: 0x0180, value: 0x48 },
        { kind: "write", address: 0x0100 + sp, value: 0xa9 },
      ],
      outcome: "executed",
    });
    assert.deepEqual(ram.accesses, record.accesses);
    assert.equal(ram.read(0x0100 + sp), 0xa9);
  }
  const ram = new ObservedRam();
  ram.write(0x0180, 0x68);
  ram.accesses.length = 0;
  const before = initialState({ pc: 0x0180, sp: 0x7f });
  const cpu = new Cpu6502(ram, before);
  const record = cpu.step();
  assert.deepEqual(record, {
    instruction: { address: 0x0180, bytes: [0x68] },
    before,
    after: { ...before, pc: 0x0181, sp: 0x80, a: 0x68, flags: { ...before.flags, n: false, z: false } },
    accesses: [
      { kind: "read", address: 0x0180, value: 0x68 },
      { kind: "read", address: 0x0180, value: 0x68 },
    ],
    outcome: "executed",
  });
  assert.deepEqual(ram.accesses, record.accesses);
});

test("6502 PLA reads current stack RAM and stack records remain detached from later changes", () => {
  const ram = new ObservedRam();
  ram.write(0, 0x48);
  ram.write(1, 0x68);
  ram.write(2, 0x48);
  const cpu = new Cpu6502(ram, initialState({ pc: 0, sp: 0, a: 0x80 }));
  const push = cpu.step();
  const savedPush = structuredClone(push);
  ram.write(0x0100, 0);
  ram.accesses.length = 0;
  const pull = cpu.step();
  const savedPull = structuredClone(pull);
  assert.deepEqual(pull, {
    instruction: { address: 1, bytes: [0x68] },
    before: savedPush.after,
    after: { ...savedPush.after, a: 0, pc: 2, sp: 0, flags: { ...savedPush.after.flags, n: false, z: true } },
    accesses: [
      { kind: "read", address: 1, value: 0x68 },
      { kind: "read", address: 0x0100, value: 0 },
    ],
    outcome: "executed",
  });
  assert.deepEqual(ram.accesses, pull.accesses);
  assert.deepEqual(push, savedPush);
  Reflect.set(push.before.flags, "c", false);
  assert.deepEqual(push.after, savedPush.after);
  Reflect.set(push.after, "sp", 0x80);
  Reflect.set(push.instruction.bytes, 0, 0xff);
  assert.ok(push.accesses[1]);
  Reflect.set(push.accesses[1], "value", 0xff);
  assert.deepEqual(cpu.snapshot(), savedPull.after);
  assert.equal(cpu.step().outcome, "executed");
  assert.equal(ram.read(0x0100), 0);
  ram.write(0x0100, 0xff);
  cpu.reset();
  assert.deepEqual(pull, savedPull);
});

// Enumerate all stored flags independently of any packed-status representation.
function flagCombinations(): readonly Cpu6502Flags[] {
  return Array.from({ length: 64 }, (_, bits) => ({
    n: Boolean(bits & 1), v: Boolean(bits & 2), d: Boolean(bits & 4),
    i: Boolean(bits & 8), z: Boolean(bits & 16), c: Boolean(bits & 32),
  }));
}

for (const [mnemonic, opcode, register] of [["LDX", 0xa2, "x"], ["LDY", 0xa0, "y"]] as const) {
  test(`6502 ${mnemonic} immediate loads every byte, replaces N/Z, and preserves all other state`, () => {
    const ram = new ObservedRam();
    for (const pc of [0x1234, 0xffff]) {
      ram.write(pc, opcode);
      const operandAddress = pc === 0xffff ? 0 : 0x1235;
      for (let value = 0; value < 256; value++) {
        ram.write(operandAddress, value);
        for (const flags of flagCombinations()) {
          ram.accesses.length = 0;
          const before = initialState({ pc, flags });
          const cpu = new Cpu6502(ram, before);
          const record = cpu.step();
          assert.deepEqual(record, {
            instruction: { address: pc, bytes: [opcode, value] }, before,
            after: { ...before, [register]: value, pc: pc === 0xffff ? 1 : 0x1236,
              flags: { ...flags, n: value >= 128, z: value === 0 } },
            accesses: [
              { kind: "read", address: pc, value: opcode },
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
}

for (const [mnemonic, opcode, source, destination] of [
  ["TAX", 0xaa, "a", "x"], ["TAY", 0xa8, "a", "y"],
  ["TXA", 0x8a, "x", "a"], ["TYA", 0x98, "y", "a"],
] as const) {
  test(`6502 ${mnemonic} transfers every byte, preserving its source and replacing only N/Z`, () => {
    const ram = new ObservedRam();
    ram.write(0xffff, opcode);
    for (let value = 0; value < 256; value++) {
      for (const flags of flagCombinations()) {
        ram.accesses.length = 0;
        // Includes an unchanged destination value; flags must still be refreshed.
        const before = initialState({ pc: 0xffff, [source]: value, flags });
        const cpu = new Cpu6502(ram, before);
        const record = cpu.step();
        assert.deepEqual(record, {
          instruction: { address: 0xffff, bytes: [opcode] }, before,
          after: { ...before, [destination]: value, pc: 0,
            flags: { ...flags, n: value >= 128, z: value === 0 } },
          accesses: [{ kind: "read", address: 0xffff, value: opcode }],
          outcome: "executed",
        });
        assert.deepEqual(cpu.snapshot(), record.after);
        assert.deepEqual(ram.accesses, record.accesses);
      }
    }
  });
}

for (const [mnemonic, opcode, register, delta] of [
  ["INX", 0xe8, "x", 1], ["DEX", 0xca, "x", -1],
  ["INY", 0xc8, "y", 1], ["DEY", 0x88, "y", -1],
] as const) {
  test(`6502 ${mnemonic} wraps at eight bits for every input and replaces only N/Z`, () => {
    const ram = new ObservedRam();
    ram.write(0xffff, opcode);
    for (let value = 0; value < 256; value++) {
      const result = (value + delta + 256) % 256;
      for (const flags of flagCombinations()) {
        ram.accesses.length = 0;
        const before = initialState({ pc: 0xffff, [register]: value, flags });
        const cpu = new Cpu6502(ram, before);
        const record = cpu.step();
        assert.deepEqual(record, {
          instruction: { address: 0xffff, bytes: [opcode] }, before,
          after: { ...before, [register]: result, pc: 0,
            flags: { ...flags, n: result >= 128, z: result === 0 } },
          accesses: [{ kind: "read", address: 0xffff, value: opcode }],
          outcome: "executed",
        });
        assert.deepEqual(cpu.snapshot(), record.after);
        assert.deepEqual(ram.accesses, record.accesses);
      }
    }
  });
}

const branchCases = [
  { mnemonic: "BPL", opcode: 0x10, flag: "n", value: false },
  { mnemonic: "BMI", opcode: 0x30, flag: "n", value: true },
  { mnemonic: "BVC", opcode: 0x50, flag: "v", value: false },
  { mnemonic: "BVS", opcode: 0x70, flag: "v", value: true },
  { mnemonic: "BCC", opcode: 0x90, flag: "c", value: false },
  { mnemonic: "BCS", opcode: 0xb0, flag: "c", value: true },
  { mnemonic: "BNE", opcode: 0xd0, flag: "z", value: false },
  { mnemonic: "BEQ", opcode: 0xf0, flag: "z", value: true },
] as const;

for (const { mnemonic, opcode, flag, value } of branchCases) {
  test(`6502 ${mnemonic} tests only ${flag.toUpperCase()}, with signed offsets and wrapping on both paths`, () => {
    const ram = new ObservedRam();
    // Literal targets include both displacement endpoints, both page crossings,
    // both address-space crossings, and overlap with opcode/operand/fallthrough.
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
      for (const flags of flagCombinations()) {
        ram.accesses.length = 0;
        const before = initialState({ pc, flags });
        const cpu = new Cpu6502(ram, before);
        const record = cpu.step();
        assert.deepEqual(record, {
          instruction: { address: pc, bytes: [opcode, displacement] }, before,
          after: { ...before, pc: flags[flag] === value ? target : fallthrough },
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

test("6502 branches decode every displacement from the address following the operand", () => {
  const ram = new ObservedRam();
  const operand = new DataView(new ArrayBuffer(1));
  for (const { opcode, flag, value } of branchCases) {
    for (const pc of [0, 0x1234, 0xffff]) {
      ram.write(pc, opcode);
      for (let displacement = 0; displacement < 256; displacement++) {
        ram.write((pc + 1) % 65536, displacement);
        operand.setUint8(0, displacement);
        for (const take of [false, true]) {
          const before = initialState({ pc,
            flags: { ...initialState().flags, [flag]: take ? value : !value } });
          const cpu = new Cpu6502(ram, before);
          ram.accesses.length = 0;
          const record = cpu.step();
          const target = (pc + 2 + (take ? operand.getInt8(0) : 0) + 65536) % 65536;
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

test("6502 branches see carry and overflow produced by ADC and preserved through TAX and INX", () => {
  for (const [a, branch, sum, x, c, v] of [
    [0x7f, 0x70, 0x80, 0x81, false, true], // BVS after signed overflow
    [0xff, 0xb0, 0x00, 0x01, true, false], // BCS after unsigned carry
  ] as const) {
    const ram = new ObservedRam();
    for (const [offset, byte] of [0x69, 1, 0xaa, 0xe8, branch, 2, 0, 0, 0x8a].entries()) {
      ram.write(0x0200 + offset, byte);
    }
    const before = initialState({ a, pc: 0x0200,
      flags: { n: false, v: false, d: false, i: true, z: false, c: false } });
    const cpu = new Cpu6502(ram, before);
    const addition = cpu.step();
    const transfer = cpu.step();
    const increment = cpu.step();
    assert.equal(addition.after.a, sum);
    assert.equal(transfer.after.x, sum);
    assert.equal(increment.after.x, x);
    assert.deepEqual(increment.after.flags, { n: x >= 128, v, d: false, i: true, z: false, c });
    ram.accesses.length = 0;
    const record = cpu.step();
    assert.deepEqual(record.after, { ...increment.after, pc: 0x0208 });
    assert.deepEqual(record.accesses, [
      { kind: "read", address: 0x0204, value: branch },
      { kind: "read", address: 0x0205, value: 2 },
    ]);
    assert.deepEqual(ram.accesses, record.accesses);
    assert.equal(cpu.step().after.a, x); // TXA reads the updated X.
  }
});

test("6502 branches fetch current operands and retain independent records across later execution and reset", () => {
  const ram = new ObservedRam();
  ram.write(0x1234, 0xd0);
  ram.write(0x1235, 0xfe); // BNE to itself
  ram.write(0x1236, 0xa2);
  ram.write(0x1237, 0);
  const cpu = new Cpu6502(ram, initialState());
  const first = cpu.step();
  const saved = structuredClone(first);
  assert.equal(first.after.pc, 0x1234);
  ram.write(0x1235, 0);
  const next = cpu.step();
  assert.deepEqual(next.instruction.bytes, [0xd0, 0]);
  assert.equal(next.after.pc, 0x1236);
  Reflect.set(first.after.flags, "z", true);
  Reflect.set(first.instruction.bytes, 1, 0x80);
  assert.deepEqual(cpu.snapshot(), next.after);
  const loaded = cpu.step();
  assert.equal(loaded.after.x, 0);
  assert.equal(loaded.after.flags.z, true);
  const savedNext = structuredClone(next);
  cpu.reset();
  ram.write(0x1235, 0xff);
  assert.deepEqual(next, savedNext);
  assert.deepEqual(saved.after, initialState());
});

for (const [mnemonic, opcode] of [["JMP", 0x4c], ["JSR", 0x20]] as const) {
  test(`6502 ${mnemonic} absolute reaches every 16-bit destination`, () => {
    const ram = new Ram(0x10000);
    ram.write(0x2000, opcode);
    for (let target = 0; target < 0x10000; target++) {
      const before = initialState({ pc: 0x2000 });
      const cpu = new Cpu6502(ram, before);
      // Operands are read from current RAM, including edits after construction.
      ram.write(0x2001, target % 256);
      ram.write(0x2002, Math.floor(target / 256));
      assert.deepEqual(cpu.step().after, { ...before, pc: target, sp: mnemonic === "JSR" ? 0xa9 : 0xab });
    }
  });
}

test("6502 JMP absolute preserves all flags and reads only its three bytes across PC wrapping", () => {
  const ram = new ObservedRam();
  for (const [pc, lowAt, highAt] of [[0x1234, 0x1235, 0x1236], [0xfffe, 0xffff, 0], [0xffff, 0, 1]] as const) {
    for (const target of [0, 0xff, 0x100, 0xffff, pc, lowAt, highAt]) {
      for (const flags of flagCombinations()) {
        const low = target % 256, high = Math.floor(target / 256);
        ram.write(pc, 0x4c);
        ram.write(lowAt, low);
        ram.write(highAt, high);
        ram.accesses.length = 0;
        const before = initialState({ pc, flags });
        const cpu = new Cpu6502(ram, before);
        const record = cpu.step();
        assert.deepEqual(record, {
          before, after: { ...before, pc: target }, outcome: "executed",
          instruction: { address: pc, bytes: [0x4c, low, high] },
          accesses: [{ kind: "read", address: pc, value: 0x4c },
            { kind: "read", address: lowAt, value: low }, { kind: "read", address: highAt, value: high }],
        });
        assert.deepEqual(cpu.snapshot(), record.after);
        assert.deepEqual(ram.accesses, record.accesses);
      }
    }
  }
});

test("6502 JSR preserves every flag pattern at every SP and pushes its last-byte address before fetching target high", () => {
  const ram = new ObservedRam();
  // PC, operand addresses, and the literal high/low return-pointer bytes.
  const cases = [[0x1234, 0x1235, 0x1236, 0x12, 0x36], [0x00fe, 0x00ff, 0x0100, 1, 0],
    [0xfffd, 0xfffe, 0xffff, 0xff, 0xff], [0xfffe, 0xffff, 0, 0, 0], [0xffff, 0, 1, 0, 1]] as const;
  for (const [pc, lowAt, highAt, returnHigh, returnLow] of cases) {
    for (let sp = 0; sp < 256; sp++) {
      const highStack = 0x0100 + sp, lowStack = 0x0100 + (sp + 255) % 256;
      for (const flags of flagCombinations()) {
        // Preload identical stack values: even unchanged-value pushes must be recorded.
        ram.write(highStack, returnHigh);
        ram.write(lowStack, returnLow);
        ram.write(pc, 0x20);
        ram.write(lowAt, 0x67);
        ram.write(highAt, 0x45);
        ram.accesses.length = 0;
        const before = initialState({ pc, sp, flags });
        const cpu = new Cpu6502(ram, before);
        const targetHigh = highAt === highStack ? returnHigh : highAt === lowStack ? returnLow : 0x45;
        const record = cpu.step();
        assert.deepEqual(record, {
          before, after: { ...before, pc: targetHigh * 256 + 0x67, sp: (sp + 254) % 256 }, outcome: "executed",
          instruction: { address: pc, bytes: [0x20, 0x67, targetHigh] },
          accesses: [{ kind: "read", address: pc, value: 0x20 }, { kind: "read", address: lowAt, value: 0x67 },
            { kind: "write", address: highStack, value: returnHigh }, { kind: "write", address: lowStack, value: returnLow },
            { kind: "read", address: highAt, value: targetHigh }],
        });
        assert.deepEqual(cpu.snapshot(), record.after);
        assert.deepEqual(ram.accesses, record.accesses);
        assert.equal(ram.read(highStack), returnHigh);
        assert.equal(ram.read(lowStack), returnLow);
      }
    }
  }
});

test("6502 JSR keeps captured bytes when pushes overwrite code but observes a replaced high operand", () => {
  // PC, SP, push addresses/values, high byte actually fetched, target, final SP.
  const cases = [
    [0x01fd, 0xff, 0x01ff, 1, 0x01fe, 0xff, 1, 0x0144, 0xfd],
    [0x01fd, 0x00, 0x0100, 1, 0x01ff, 0xff, 0xff, 0xff44, 0xfe],
    [0x0100, 0x02, 0x0102, 1, 0x0101, 2, 1, 0x0144, 0x00],
    [0x0100, 0x01, 0x0101, 1, 0x0100, 2, 0x55, 0x5544, 0xff],
    [0x0100, 0x00, 0x0100, 1, 0x01ff, 2, 0x55, 0x5544, 0xfe],
  ] as const;
  for (const [pc, sp, highStack, returnHigh, lowStack, returnLow, high, target, nextSp] of cases) {
    const ram = new ObservedRam();
    ram.write(pc, 0x20);
    ram.write(pc + 1, 0x44);
    ram.write(pc + 2, 0x55);
    ram.accesses.length = 0;
    const before = initialState({ pc, sp });
    const cpu = new Cpu6502(ram, before);
    const record = cpu.step();
    assert.deepEqual(record, {
      before, after: { ...before, pc: target, sp: nextSp }, outcome: "executed",
      instruction: { address: pc, bytes: [0x20, 0x44, high] },
      accesses: [{ kind: "read", address: pc, value: 0x20 }, { kind: "read", address: pc + 1, value: 0x44 },
        { kind: "write", address: highStack, value: returnHigh }, { kind: "write", address: lowStack, value: returnLow },
        { kind: "read", address: pc + 2, value: high }],
    });
    assert.deepEqual(ram.accesses, record.accesses);
    assert.equal(ram.read(highStack), returnHigh);
    assert.equal(ram.read(lowStack), returnLow);
  }
});

test("6502 RTS accepts every return pointer from RAM and increments it with 16-bit wrapping", () => {
  const ram = new Ram(0x10000);
  ram.write(0x2000, 0x60);
  for (let pointer = 0; pointer < 0x10000; pointer++) {
    const before = initialState({ pc: 0x2000 });
    const cpu = new Cpu6502(ram, before);
    ram.write(0x01ac, pointer % 256);
    ram.write(0x01ad, Math.floor(pointer / 256));
    assert.deepEqual(cpu.step().after, { ...before, pc: (pointer + 1) % 0x10000, sp: 0xad });
  }
});

test("6502 RTS preserves every flag pattern at every SP and reads only opcode, low, and high", () => {
  const ram = new ObservedRam();
  for (const pc of [0x2000, 0xffff]) {
    for (let sp = 0; sp < 256; sp++) {
      const lowStack = 0x0100 + (sp + 1) % 256, highStack = 0x0100 + (sp + 2) % 256;
      for (const flags of flagCombinations()) {
        ram.write(pc, 0x60);
        ram.write(lowStack, 0xff);
        ram.write(highStack, 0x12);
        ram.accesses.length = 0;
        const before = initialState({ pc, sp, flags });
        const cpu = new Cpu6502(ram, before);
        const record = cpu.step();
        assert.deepEqual(record, {
          before, after: { ...before, pc: 0x1300, sp: (sp + 2) % 256 }, outcome: "executed",
          instruction: { address: pc, bytes: [0x60] },
          accesses: [{ kind: "read", address: pc, value: 0x60 }, { kind: "read", address: lowStack, value: 0xff },
            { kind: "read", address: highStack, value: 0x12 }],
        });
        assert.deepEqual(cpu.snapshot(), record.after);
        assert.deepEqual(ram.accesses, record.accesses);
        assert.equal(ram.read(lowStack), 0xff);
        assert.equal(ram.read(highStack), 0x12);
      }
    }
  }
});

test("6502 RTS can read its own opcode as either return-pointer byte", () => {
  for (const [sp, lowAt, low, highAt, high, target, nextSp] of [
    [0xfe, 0x01ff, 0x60, 0x0100, 0x12, 0x1261, 0],
    [0xfd, 0x01fe, 0x34, 0x01ff, 0x60, 0x6035, 0xff],
  ] as const) {
    const ram = new ObservedRam();
    ram.write(lowAt, low);
    ram.write(highAt, high);
    ram.accesses.length = 0;
    const before = initialState({ pc: 0x01ff, sp });
    const cpu = new Cpu6502(ram, before);
    const record = cpu.step();
    assert.deepEqual(record, {
      before, after: { ...before, pc: target, sp: nextSp }, outcome: "executed",
      instruction: { address: 0x01ff, bytes: [0x60] },
      accesses: [{ kind: "read", address: 0x01ff, value: 0x60 }, { kind: "read", address: lowAt, value: low },
        { kind: "read", address: highAt, value: high }],
    });
    assert.deepEqual(ram.accesses, record.accesses);
  }
});

test("6502 RTS uses edited stack RAM and the next step fetches current target code without altering earlier records", () => {
  const ram = new ObservedRam();
  ram.write(0x2000, 0x20);
  ram.write(0x2001, 0);
  ram.write(0x2002, 0x30);
  ram.write(0x3000, 0x60);
  const cpu = new Cpu6502(ram, initialState({ pc: 0x2000 }));
  const call = cpu.step();
  const savedCall = structuredClone(call);
  ram.write(0x01aa, 4);
  ram.write(0x01ab, 0x40);
  ram.accesses.length = 0;
  const returned = cpu.step();
  const savedReturn = structuredClone(returned);
  assert.deepEqual(returned, {
    before: savedCall.after, after: { ...savedCall.after, pc: 0x4005, sp: 0xab }, outcome: "executed",
    instruction: { address: 0x3000, bytes: [0x60] },
    accesses: [{ kind: "read", address: 0x3000, value: 0x60 }, { kind: "read", address: 0x01aa, value: 4 },
      { kind: "read", address: 0x01ab, value: 0x40 }],
  });
  assert.deepEqual(ram.accesses, returned.accesses);
  ram.write(0x4005, 0xa9);
  ram.write(0x4006, 0xff);
  assert.deepEqual(cpu.step().after, { ...returned.after, pc: 0x4007, a: 0xff,
    flags: { ...returned.after.flags, n: true, z: false } });
  cpu.reset();
  ram.write(0x01aa, 0xff);
  assert.deepEqual(call, savedCall);
  assert.deepEqual(returned, savedReturn);
  Reflect.set(call.after, "sp", 0);
  Reflect.set(call.instruction.bytes, 1, 0xff);
  Reflect.set(call.accesses[2]!, "value", 0xff);
  assert.deepEqual(returned, savedReturn);
  assert.equal(cpu.snapshot().sp, 0xa8);
});

test("every unimplemented 6502 opcode reads once and preserves state on repeated attempts", () => {
  const ram = new ObservedRam();
  ram.write(0, 0xa9);
  for (let opcode = 0; opcode < 256; opcode++) {
    if ([
      0x10, 0x18, 0x20, 0x30, 0x48, 0x4c, 0x50, 0x60, 0x68, 0x69, 0x70, 0x85, 0x88, 0x8a, 0x8d,
      0x90, 0x98, 0xa0, 0xa2, 0xa5, 0xa8, 0xa9, 0xaa, 0xb0, 0xc8, 0xca, 0xd0, 0xe8, 0xf0,
    ].includes(opcode)) continue;
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

test("unsupported 6502 records are independent and execution resumes after host memory changes", () => {
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

test("6502 LDA records retain actual bytes and stay independent of execution, inspection, and edits", () => {
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

test("6502 reset changes only PC, I, and SP and performs exactly two vector reads", () => {
  for (const preserved of [
    { n: false, v: true, d: false, z: true, c: false },
    { n: true, v: false, d: true, z: false, c: true },
  ]) {
    for (const i of [false, true]) {
      const ram = new ObservedRam();
      ram.write(0xfffc, 0x78);
      ram.write(0xfffd, 0x56);
      ram.write(0x5678, 0xa9);
      ram.write(0x0080, 5);
      ram.write(0x01ab, 0xa5);
      ram.write(0x01aa, 0x5a);
      ram.write(0x01a9, 0xff);
      ram.accesses.length = 0;
      const before = initialState({ flags: { ...preserved, i } });
      const cpu = new Cpu6502(ram, before);
      const expectedAccesses = [
        { kind: "read", address: 0xfffc, value: 0x78 },
        { kind: "read", address: 0xfffd, value: 0x56 },
      ];
      const record = cpu.reset();
      assert.deepEqual(record, {
        before,
        after: { ...before, pc: 0x5678, sp: 0xa8, flags: { ...preserved, i: true } },
        accesses: expectedAccesses,
      });
      assert.deepEqual(cpu.snapshot(), record.after);
      // This excludes stack writes, dummy reads, and prefetching the target opcode.
      assert.deepEqual(ram.accesses, expectedAccesses);
      assert.equal(ram.read(0x0080), 5);
      assert.equal(ram.read(0x01ab), 0xa5);
      assert.equal(ram.read(0x01aa), 0x5a);
      assert.equal(ram.read(0x01a9), 0xff);
    }
  }
});

test("6502 reset decrements SP on every call and wraps within eight bits", () => {
  // Literal expectations cover underflow and the lesson's FF -> FC -> F9 sequence.
  for (const [initialSp, firstSp, secondSp] of [
    [0x00, 0xfd, 0xfa],
    [0x01, 0xfe, 0xfb],
    [0x02, 0xff, 0xfc],
    [0x03, 0x00, 0xfd],
    [0xff, 0xfc, 0xf9],
  ] as const) {
    const ram = new ObservedRam();
    ram.write(0xfffc, 0);
    ram.write(0xfffd, 2);
    let before = initialState({ sp: initialSp });
    const cpu = new Cpu6502(ram, before);
    for (const sp of [firstSp, secondSp]) {
      ram.accesses.length = 0;
      const after = { ...before, pc: 0x0200, sp, flags: { ...before.flags, i: true } };
      const record = cpu.reset();
      assert.deepEqual(record, {
        before,
        after,
        accesses: [
          { kind: "read", address: 0xfffc, value: 0 },
          { kind: "read", address: 0xfffd, value: 2 },
        ],
      });
      assert.deepEqual(cpu.snapshot(), after);
      assert.deepEqual(ram.accesses, record.accesses);
      before = after;
    }
  }
});

test("6502 reset rereads both vector bytes and execution resumes at any target address", () => {
  const ram = new ObservedRam();
  const cpu = new Cpu6502(ram, initialState());
  for (const [low, high, target, operandAddress, nextPc] of [
    [0x00, 0x00, 0x0000, 0x0001, 0x0002],
    [0x56, 0x34, 0x3456, 0x3457, 0x3458],
    [0xff, 0xff, 0xffff, 0x0000, 0x0001],
  ] as const) {
    ram.write(0xfffc, low);
    ram.write(0xfffd, high);
    ram.write(target, 0xa9);
    ram.write(operandAddress, 0x80);
    ram.accesses.length = 0;
    const before = cpu.snapshot();
    const reset = cpu.reset();
    const savedReset = structuredClone(reset);
    assert.deepEqual(reset.before, before);
    assert.equal(reset.after.pc, target);
    assert.deepEqual(reset.accesses, [
      { kind: "read", address: 0xfffc, value: low },
      { kind: "read", address: 0xfffd, value: high },
    ]);
    assert.deepEqual(ram.accesses, reset.accesses);

    // The next step must use current memory, not anything cached during reset.
    ram.write(operandAddress, 0x5a);
    ram.accesses.length = 0;
    const step = cpu.step();
    assert.deepEqual(step, {
      instruction: { address: target, bytes: [0xa9, 0x5a] },
      before: reset.after,
      after: { ...reset.after, pc: nextPc, a: 0x5a, flags: { ...reset.after.flags, n: false, z: false } },
      accesses: [
        { kind: "read", address: target, value: 0xa9 },
        { kind: "read", address: operandAddress, value: 0x5a },
      ],
      outcome: "executed",
    });
    assert.deepEqual(cpu.snapshot(), step.after);
    assert.deepEqual(ram.accesses, step.accesses);
    assert.deepEqual(reset, savedReset);
  }
});

test("6502 reset and step records stay independent of later execution, resets, and caller edits", () => {
  const ram = new ObservedRam();
  ram.write(0x1234, 0xa9);
  ram.write(0x1235, 0);
  ram.write(0xfffc, 0);
  ram.write(0xfffd, 0x40);
  ram.write(0x4000, 0xa9);
  ram.write(0x4001, 2);
  const cpu = new Cpu6502(ram, initialState({ flags: { ...initialState().flags, i: false } }));
  const oldStep = cpu.step();
  const savedOldStep = structuredClone(oldStep);
  const first = cpu.reset();
  const savedFirst = structuredClone(first);
  const nextStep = cpu.step();
  const savedNextStep = structuredClone(nextStep);
  ram.write(0xfffc, 2);
  ram.write(0x1235, 0xff);
  assert.deepEqual(first, savedFirst);
  assert.deepEqual(oldStep, savedOldStep);

  const second = cpu.reset();
  const savedSecond = structuredClone(second);
  assert.deepEqual(second.before, nextStep.after);
  assert.deepEqual(first, savedFirst);
  // Simulate edits from JavaScript, which has no readonly checks.
  Reflect.set(first.before, "a", 0xff);
  Reflect.set(first.before.flags, "n", true);
  assert.deepEqual(first.after, savedFirst.after);
  Reflect.set(first.after, "pc", 0xffff);
  Reflect.set(first.after.flags, "d", false);
  assert.ok(first.accesses[0]);
  Reflect.set(first.accesses[0], "value", 0xff);
  Reflect.set(first.accesses, first.accesses.length, { kind: "write", address: 0, value: 0xff });
  Reflect.set(cpu.snapshot().flags, "i", false);
  assert.equal(first.after.pc, 0xffff);
  assert.deepEqual(second, savedSecond);
  assert.deepEqual(oldStep, savedOldStep);
  assert.deepEqual(nextStep, savedNextStep);
  assert.deepEqual(cpu.snapshot(), savedSecond.after);
  assert.equal(ram.read(0xfffc), 2);
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
