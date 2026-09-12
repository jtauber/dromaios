import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu8080 } from "../../../src/components/cpus/8080.js";
import type { Cpu8080Flags, Cpu8080State } from "../../../src/components/cpus/8080.js";
import { Ram } from "../../../src/components/memory/ram.js";
import { ObservedRam } from "../../helpers/observed-ram.js";

function initialState(overrides: Partial<Cpu8080State> = {}): Cpu8080State {
  return {
    a: 0x11, b: 0x22, c: 0x33, d: 0x44, e: 0x55, h: 0x66, l: 0x77,
    pc: 0x1234,
    sp: 0xabcd,
    flags: { s: true, z: false, ac: true, p: false, cy: true },
    interruptEnabled: true,
    halted: false,
    ...overrides,
  };
}

test("8080 owns its initial state and returns independent snapshots without RAM accesses", () => {
  const ram = new ObservedRam();
  const supplied = initialState();
  const cpu = new Cpu8080(ram, supplied);
  const first = cpu.snapshot();
  const second = cpu.snapshot();
  assert.deepEqual(first, initialState());

  supplied.a = 0xff;
  supplied.flags.s = false;
  // Deliberately bypass TypeScript readonly to check runtime isolation too.
  Reflect.set(first, "b", 0xff);
  Reflect.set(first.flags, "cy", false);
  assert.equal(first.b, 0xff);
  assert.equal(first.flags.cy, false);
  assert.deepEqual(second, initialState());
  assert.deepEqual(cpu.snapshot(), initialState());
  assert.deepEqual(ram.accesses, []);
});

test("8080 copies only model fields, excluding extra state and flag metadata", () => {
  const ram = new ObservedRam();
  const supplied = {
    ...initialState(),
    metadata: { label: "initial state" },
    flags: { ...initialState().flags, metadata: { label: "initial flags" } },
  };
  const cpu = new Cpu8080(ram, supplied);
  const snapshot = cpu.snapshot();
  const first = cpu.step();
  const second = cpu.step();
  const saved = structuredClone(first);

  supplied.metadata.label = "changed state metadata";
  supplied.flags.metadata.label = "changed flag metadata";
  assert.deepEqual(snapshot, initialState());
  assert.deepEqual(first.before, initialState());
  assert.deepEqual(first.after, initialState());
  assert.deepEqual(first, saved);
  assert.deepEqual(second, saved);
  assert.deepEqual(cpu.snapshot(), initialState());
});

test("8080 accepts inherited flag getters and non-enumerable state fields", () => {
  class GetterFlags implements Cpu8080Flags {
    get s() { return true; }
    get z() { return false; }
    get ac() { return true; }
    get p() { return false; }
    get cy() { return true; }
  }
  const ram = new ObservedRam();
  let a = 0x11;
  const supplied = { ...initialState(), flags: new GetterFlags() };
  Object.defineProperty(supplied, "a", { enumerable: false, get: () => a });
  const cpu = new Cpu8080(ram, supplied);
  a = 0xff;
  assert.deepEqual(cpu.snapshot(), initialState());
  assert.deepEqual(ram.accesses, []);
});

test("8080 MVI A,n preserves unrelated state and records exactly the two actual reads", () => {
  for (const immediate of [0, 0x02, 0x80, 0xff]) {
    for (const setFlags of [false, true]) {
      const ram = new ObservedRam();
      ram.write(0x1234, 0x3e);
      ram.write(0x1235, immediate);
      ram.accesses.length = 0;
      const before = initialState({
        flags: { s: setFlags, z: setFlags, ac: setFlags, p: setFlags, cy: setFlags },
      });
      const cpu = new Cpu8080(ram, before);
      const record = cpu.step();
      const expectedAccesses = [
        { kind: "read", address: 0x1234, value: 0x3e },
        { kind: "read", address: 0x1235, value: immediate },
      ];
      assert.deepEqual(record, {
        instruction: { address: 0x1234, bytes: [0x3e, immediate] },
        before,
        after: { ...before, a: immediate, pc: 0x1236 },
        accesses: expectedAccesses,
        outcome: "executed",
      });
      assert.deepEqual(cpu.snapshot(), record.after);
      assert.deepEqual(ram.accesses, expectedAccesses);
    }
  }
});

test("8080 MVI A,n wraps operand fetching and PC advancement at the 16-bit boundary", () => {
  for (const [address, operandAddress, nextPc] of [
    [0xfffe, 0xffff, 0x0000],
    [0xffff, 0x0000, 0x0001],
  ] as const) {
    const ram = new ObservedRam();
    ram.write(address, 0x3e);
    ram.write(operandAddress, 0xa5);
    ram.accesses.length = 0;
    const before = initialState({ pc: address });
    const cpu = new Cpu8080(ram, before);
    const record = cpu.step();
    assert.deepEqual(record, {
      instruction: { address, bytes: [0x3e, 0xa5] },
      before,
      after: { ...before, a: 0xa5, pc: nextPc },
      accesses: [
        { kind: "read", address, value: 0x3e },
        { kind: "read", address: operandAddress, value: 0xa5 },
      ],
      outcome: "executed",
    });
    assert.deepEqual(ram.accesses, record.accesses);
    assert.deepEqual(cpu.snapshot(), record.after);
  }
});

test("8080 ADI replaces all arithmetic flags, preserves unrelated state, and records only two reads", () => {
  // Literal expectations from the specification and Intel's ADI examples.
  const cases = [
    { a: 0x02, immediate: 0x03, result: 0x05,
      flags: { s: false, z: false, ac: false, p: true, cy: false } },
    { a: 0xff, immediate: 0x01, result: 0x00,
      flags: { s: false, z: true, ac: true, p: true, cy: true } },
    { a: 0x7f, immediate: 0x01, result: 0x80,
      flags: { s: true, z: false, ac: true, p: false, cy: false } },
    { a: 0xff, immediate: 0x00, result: 0xff,
      flags: { s: true, z: false, ac: false, p: true, cy: false } },
    { a: 0x08, immediate: 0x08, result: 0x10,
      flags: { s: false, z: false, ac: true, p: false, cy: false } },
    { a: 0x80, immediate: 0x80, result: 0x00,
      flags: { s: false, z: true, ac: false, p: true, cy: true } },
    { a: 0x14, immediate: 0x42, result: 0x56,
      flags: { s: false, z: false, ac: false, p: true, cy: false } },
    { a: 0x56, immediate: 0xbe, result: 0x14,
      flags: { s: false, z: false, ac: true, p: true, cy: true } },
  ] satisfies readonly { a: number; immediate: number; result: number; flags: Cpu8080Flags }[];

  for (const { a, immediate, result, flags } of cases) {
    for (const setFlags of [false, true]) {
      const ram = new ObservedRam();
      ram.write(0x1234, 0xc6);
      ram.write(0x1235, immediate);
      ram.accesses.length = 0;
      const before = initialState({
        a,
        flags: { s: setFlags, z: setFlags, ac: setFlags, p: setFlags, cy: setFlags },
      });
      const cpu = new Cpu8080(ram, before);
      const record = cpu.step();
      const expectedAccesses = [
        { kind: "read", address: 0x1234, value: 0xc6 },
        { kind: "read", address: 0x1235, value: immediate },
      ];
      const context = `A=${a}, immediate=${immediate}, initial flags=${setFlags}`;
      assert.deepEqual(record, {
        instruction: { address: 0x1234, bytes: [0xc6, immediate] },
        before,
        after: { ...before, a: result, flags, pc: 0x1236 },
        accesses: expectedAccesses,
        outcome: "executed",
      }, context);
      assert.deepEqual(cpu.snapshot(), record.after, context);
      assert.deepEqual(ram.accesses, expectedAccesses, context);
    }
  }
});

// Reference addition works one binary column at a time, independently of the
// CPU's whole-byte sum, bit masks, and parity helper. Carry starts at zero for ADI.
function referenceAddition(a: number, immediate: number): { result: number; flags: Cpu8080Flags } {
  let result = 0;
  let carry = 0;
  let auxiliaryCarry = false;
  let setBits = 0;
  for (let bit = 0; bit < 8; bit++) {
    const column = (a % 2) + (immediate % 2) + carry;
    const digit = column % 2;
    result += digit * 2 ** bit;
    setBits += digit;
    carry = column >= 2 ? 1 : 0;
    if (bit === 3) auxiliaryCarry = carry === 1;
    a = Math.floor(a / 2);
    immediate = Math.floor(immediate / 2);
  }
  return {
    result,
    flags: {
      s: result >= 128,
      z: result === 0,
      ac: auxiliaryCarry,
      p: setBits % 2 === 0,
      cy: carry === 1,
    },
  };
}

test("8080 ADI matches reference addition for all operand pairs with old flags clear and set", () => {
  const ram = new Ram(0x10000);
  ram.write(0, 0xc6);
  for (let immediate = 0; immediate < 256; immediate++) {
    ram.write(1, immediate);
    for (let a = 0; a < 256; a++) {
      const expected = referenceAddition(a, immediate);
      for (const setFlags of [false, true]) {
        const cpu = new Cpu8080(ram, initialState({
          a, pc: 0,
          flags: { s: setFlags, z: setFlags, ac: setFlags, p: setFlags, cy: setFlags },
        }));
        const record = cpu.step();
        assert.equal(record.outcome, "executed");
        assert.deepEqual({ result: record.after.a, flags: record.after.flags }, expected,
          `A=${a}, immediate=${immediate}, initial flags=${setFlags}`);
      }
    }
  }
});

test("8080 ADI wraps operand fetching and PC advancement at the 16-bit boundary", () => {
  for (const [address, operandAddress, nextPc] of [
    [0xfffe, 0xffff, 0x0000],
    [0xffff, 0x0000, 0x0001],
  ] as const) {
    const ram = new ObservedRam();
    ram.write(address, 0xc6);
    ram.write(operandAddress, 1);
    ram.accesses.length = 0;
    const before = initialState({ a: 0xff, pc: address });
    const cpu = new Cpu8080(ram, before);
    const record = cpu.step();
    assert.deepEqual(record, {
      instruction: { address, bytes: [0xc6, 0x01] },
      before,
      after: {
        ...before, a: 0, pc: nextPc,
        flags: { s: false, z: true, ac: true, p: true, cy: true },
      },
      accesses: [
        { kind: "read", address, value: 0xc6 },
        { kind: "read", address: operandAddress, value: 1 },
      ],
      outcome: "executed",
    });
    assert.deepEqual(cpu.snapshot(), record.after);
    assert.deepEqual(ram.accesses, record.accesses);
  }
});

test("8080 STA decodes low/high address bytes and writes once while preserving CPU state", () => {
  for (const [low, high, destination] of [
    [0x34, 0x12, 0x1234],
    [0x00, 0x00, 0x0000],
    [0xff, 0xff, 0xffff],
  ] as const) {
    for (const a of [0x00, 0x5a, 0xff]) {
      for (const flags of [
        { s: true, z: false, ac: true, p: false, cy: true },
        { s: false, z: true, ac: false, p: true, cy: false },
      ]) {
        const ram = new ObservedRam();
        ram.write(0x2000, 0x32);
        ram.write(0x2001, low);
        ram.write(0x2002, high);
        // A write is still required when the destination already contains A.
        ram.write(destination, 0x5a);
        ram.accesses.length = 0;
        const before = initialState({ a, pc: 0x2000, flags });
        const cpu = new Cpu8080(ram, before);
        const record = cpu.step();
        const expectedAccesses = [
          { kind: "read", address: 0x2000, value: 0x32 },
          { kind: "read", address: 0x2001, value: low },
          { kind: "read", address: 0x2002, value: high },
          { kind: "write", address: destination, value: a },
        ];
        const context = `destination=${destination}, A=${a}, flags=${JSON.stringify(flags)}`;
        assert.deepEqual(record, {
          instruction: { address: 0x2000, bytes: [0x32, low, high] },
          before,
          after: { ...before, pc: 0x2003 },
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

test("8080 STA wraps both operand fetching and PC advancement at the 16-bit boundary", () => {
  for (const [address, lowAddress, highAddress, nextPc] of [
    [0xfffd, 0xfffe, 0xffff, 0x0000],
    [0xfffe, 0xffff, 0x0000, 0x0001],
    [0xffff, 0x0000, 0x0001, 0x0002],
  ] as const) {
    const ram = new ObservedRam();
    ram.write(address, 0x32);
    ram.write(lowAddress, 0x34);
    ram.write(highAddress, 0x12);
    ram.accesses.length = 0;
    const before = initialState({ a: 0xa5, pc: address });
    const cpu = new Cpu8080(ram, before);
    const record = cpu.step();
    assert.deepEqual(record, {
      instruction: { address, bytes: [0x32, 0x34, 0x12] },
      before,
      after: { ...before, pc: nextPc },
      accesses: [
        { kind: "read", address, value: 0x32 },
        { kind: "read", address: lowAddress, value: 0x34 },
        { kind: "read", address: highAddress, value: 0x12 },
        { kind: "write", address: 0x1234, value: 0xa5 },
      ],
      outcome: "executed",
    });
    assert.deepEqual(cpu.snapshot(), record.after);
    assert.deepEqual(ram.accesses, record.accesses);
    assert.equal(ram.read(0x1234), 0xa5);
  }
});

test("8080 STA can overwrite its opcode or either operand without changing fetched bytes", () => {
  for (const [low, destination] of [
    [0x00, 0x2000], [0x01, 0x2001], [0x02, 0x2002],
  ] as const) {
    const ram = new ObservedRam();
    ram.write(0x2000, 0x32);
    ram.write(0x2001, low);
    ram.write(0x2002, 0x20);
    ram.accesses.length = 0;
    const before = initialState({ a: 0xe7, pc: 0x2000 });
    const cpu = new Cpu8080(ram, before);
    const record = cpu.step();
    assert.deepEqual(record, {
      instruction: { address: 0x2000, bytes: [0x32, low, 0x20] },
      before,
      after: { ...before, pc: 0x2003 },
      accesses: [
        { kind: "read", address: 0x2000, value: 0x32 },
        { kind: "read", address: 0x2001, value: low },
        { kind: "read", address: 0x2002, value: 0x20 },
        { kind: "write", address: destination, value: 0xe7 },
      ],
      outcome: "executed",
    });
    assert.deepEqual(ram.accesses, record.accesses);
    assert.equal(ram.read(destination), 0xe7);

    const saved = structuredClone(record);
    ram.write(destination, 0x99);
    cpu.reset();
    assert.deepEqual(record, saved);
    const afterReset = cpu.snapshot();
    const write = record.accesses[3];
    assert.ok(write);
    // Bypass readonly as JavaScript could, checking that the write entry is detached.
    assert.ok(Reflect.set(write, "value", 0));
    assert.ok(Reflect.set(write, "address", 0xffff));
    assert.equal(ram.read(destination), 0x99);
    assert.deepEqual(cpu.snapshot(), afterReset);
  }
});

test("8080 HLT advances PC with wrapping, preserves unrelated state, and stops further fetching", () => {
  for (const [address, nextPc] of [
    [0x0000, 0x0001], [0x1234, 0x1235], [0xffff, 0x0000],
  ] as const) {
    for (const flags of [
      { s: true, z: false, ac: true, p: false, cy: true },
      { s: false, z: true, ac: false, p: true, cy: false },
    ]) {
      for (const interruptEnabled of [false, true]) {
        const ram = new ObservedRam();
        ram.write(address, 0x76);
        ram.write(nextPc, 0x3e);
        ram.accesses.length = 0;
        const before = initialState({ pc: address, flags, interruptEnabled });
        const after = { ...before, pc: nextPc, halted: true };
        const cpu = new Cpu8080(ram, before);
        const record = cpu.step();
        const expectedAccesses = [{ kind: "read", address, value: 0x76 }];
        const context = `PC=${address}, flags=${JSON.stringify(flags)}, INTE=${interruptEnabled}`;
        assert.deepEqual(record, {
          instruction: { address, bytes: [0x76] },
          before,
          after,
          accesses: expectedAccesses,
          outcome: "halted",
        }, context);
        assert.deepEqual(cpu.snapshot(), after, context);
        assert.deepEqual(ram.accesses, expectedAccesses, context);

        const saved = structuredClone(record);
        ram.accesses.length = 0;
        for (let attempt = 0; attempt < 2; attempt++) {
          assert.deepEqual(cpu.step(), {
            instruction: null, before: after, after, accesses: [], outcome: "halted",
          }, context);
        }
        assert.deepEqual(cpu.snapshot(), after, context);
        assert.deepEqual(ram.accesses, [], context);
        assert.deepEqual(record, saved, context);

        // Bypass readonly to check that a HLT record cannot resume the CPU.
        assert.ok(Reflect.set(record.after, "halted", false));
        assert.deepEqual(record.before, before, context);
        assert.deepEqual(cpu.snapshot(), after, context);
        assert.equal(cpu.step().instruction, null, context);
        assert.deepEqual(ram.accesses, [], context);
      }
    }
  }
});

test("every other 8080 opcode reports unsupported repeatedly with one read and unchanged state", () => {
  const ram = new ObservedRam();
  const before = initialState({ pc: 0xffff });
  const cpu = new Cpu8080(ram, before);
  for (let opcode = 0; opcode <= 0xff; opcode++) {
    if (opcode === 0x3e || opcode === 0xc6 || opcode === 0x32 || opcode === 0x76) continue;
    ram.write(0xffff, opcode);
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
});

test("an already halted 8080 returns independent records without fetching", () => {
  const ram = new ObservedRam();
  const before = initialState({ halted: true });
  const cpu = new Cpu8080(ram, before);
  const first = cpu.step();
  const second = cpu.step();
  const expected = {
    instruction: null, before, after: before, accesses: [], outcome: "halted",
  };
  assert.deepEqual(first, expected);
  assert.deepEqual(second, expected);
  // Simulate edits from JavaScript, which has no readonly checks.
  Reflect.set(first.before.flags, "s", false);
  Reflect.set(first.after, "a", 0xff);
  Reflect.set(first.accesses, first.accesses.length, { kind: "read", address: 0, value: 0 });
  assert.deepEqual(second, expected);
  assert.deepEqual(cpu.snapshot(), before);
  assert.deepEqual(ram.accesses, []);
});

test("8080 reset after HLT clears only control state without accessing RAM, then execution resumes", () => {
  const ram = new ObservedRam();
  ram.write(0, 0x3e);
  ram.write(1, 0x5a);
  ram.write(0x0080, 0xa5);
  ram.write(0x1234, 0x76);
  ram.accesses.length = 0;
  const before = initialState();
  const cpu = new Cpu8080(ram, before);
  const oldRecord = cpu.step();
  assert.equal(oldRecord.outcome, "halted");
  const savedRecord = structuredClone(oldRecord);
  ram.accesses.length = 0;
  const reset = cpu.reset();
  const afterReset = {
    ...before, pc: 0, interruptEnabled: false, halted: false,
  };
  assert.deepEqual(reset, { before: oldRecord.after, after: afterReset, accesses: [] });
  const savedReset = structuredClone(reset);
  assert.deepEqual(cpu.snapshot(), afterReset);
  assert.deepEqual(ram.accesses, []);
  assert.deepEqual(oldRecord, savedRecord);
  assert.equal(ram.read(0x0080), 0xa5);
  ram.accesses.length = 0;
  const resumed = cpu.step();
  assert.deepEqual(resumed, {
    instruction: { address: 0, bytes: [0x3e, 0x5a] },
    before: afterReset,
    after: { ...afterReset, a: 0x5a, pc: 2 },
    accesses: [
      { kind: "read", address: 0, value: 0x3e },
      { kind: "read", address: 1, value: 0x5a },
    ],
    outcome: "executed",
  });
  assert.deepEqual(cpu.snapshot(), resumed.after);
  assert.deepEqual(ram.accesses, resumed.accesses);
  assert.deepEqual(oldRecord, savedRecord);
  assert.deepEqual(reset, savedReset);
});

test("8080 reset records stay independent across repeated resets, execution, and caller edits", () => {
  const ram = new ObservedRam();
  ram.write(0, 0xc6);
  ram.write(1, 0xef);
  ram.accesses.length = 0;
  const before = initialState();
  const cpu = new Cpu8080(ram, before);
  const afterReset = { ...before, pc: 0, interruptEnabled: false, halted: false };
  const first = cpu.reset();
  const savedFirst = structuredClone(first);
  const second = cpu.reset();
  const savedSecond = structuredClone(second);
  assert.deepEqual(first, { before, after: afterReset, accesses: [] });
  assert.deepEqual(second, { before: afterReset, after: afterReset, accesses: [] });
  assert.deepEqual(cpu.snapshot(), afterReset);
  assert.deepEqual(ram.accesses, []);

  const step = cpu.step();
  const savedStep = structuredClone(step);
  assert.equal(step.outcome, "executed");
  assert.equal(step.after.a, 0);
  assert.deepEqual(first, savedFirst);
  assert.deepEqual(second, savedSecond);

  // Deliberately bypass readonly to check nested snapshots and empty access lists.
  assert.ok(Reflect.set(first.before, "pc", 0xffff));
  assert.ok(Reflect.set(first.before.flags, "s", false));
  assert.deepEqual(first.after, savedFirst.after);
  assert.ok(Reflect.set(first.after, "halted", true));
  assert.ok(Reflect.set(first.after.flags, "cy", false));
  assert.equal(first.before.flags.cy, true);
  assert.ok(Reflect.set(first.accesses, 0, { kind: "write", address: 0, value: 0 }));
  assert.deepEqual(second, savedSecond);
  assert.deepEqual(step, savedStep);
  assert.deepEqual(cpu.snapshot(), savedStep.after);
  assert.equal(ram.read(0), 0xc6);

  ram.write(0, 0x76);
  cpu.reset();
  cpu.step();
  assert.deepEqual(second, savedSecond);
  assert.deepEqual(step, savedStep);
});

test("8080 records stay independent of execution, inspection, RAM edits, reset, and each other", () => {
  const ram = new ObservedRam();
  ram.write(0, 0x3e);
  ram.write(1, 0x02);
  ram.write(2, 0xc6);
  ram.write(3, 0x03);
  const before = initialState({ pc: 0 });
  const cpu = new Cpu8080(ram, before);
  const first = cpu.step();
  const savedFirst = structuredClone(first);
  const second = cpu.step();
  const savedSecond = structuredClone(second);
  const live = cpu.snapshot();
  ram.accesses.length = 0;
  // Simulate edits from JavaScript, which has no readonly checks.
  Reflect.set(cpu.snapshot().flags, "p", false);
  assert.deepEqual(cpu.snapshot(), live);
  assert.deepEqual(ram.accesses, []);
  assert.deepEqual(first, savedFirst);

  assert.ok(first.instruction);
  assert.ok(first.accesses[0]);
  Reflect.set(first.before, "a", 0xff);
  Reflect.set(first.before.flags, "s", false);
  assert.deepEqual(first.after, savedFirst.after);
  Reflect.set(first.after, "pc", 0xffff);
  Reflect.set(first.after.flags, "ac", false);
  Reflect.set(first.instruction.bytes, 0, 0);
  Reflect.set(first.accesses[0], "value", 0);
  Reflect.set(first.accesses, first.accesses.length, { kind: "write", address: 0, value: 0 });
  assert.deepEqual(second, savedSecond);
  assert.deepEqual(cpu.snapshot(), live);
  assert.equal(ram.read(0), 0x3e);

  ram.write(2, 0);
  cpu.reset();
  assert.deepEqual(second, savedSecond);
  const third = cpu.step();
  assert.equal(third.after.a, 2);
  assert.deepEqual(second, savedSecond);
});

test("8080 rejects RAM sizes outside its flat 64 KiB model", () => {
  for (const size of [1, 0xffff, 0x10001]) {
    assert.throws(() => new Cpu8080(new Ram(size), initialState()), RangeError);
  }
});

test("8080 rejects invalid initial register values without accessing RAM", () => {
  const ram = new ObservedRam();
  for (const name of ["a", "b", "c", "d", "e", "h", "l", "pc", "sp"] as const) {
    const maximum = name === "pc" || name === "sp" ? 0xffff : 0xff;
    for (const value of [-1, maximum + 1, 1.5, NaN, Infinity, -Infinity]) {
      const state = initialState({ [name]: value });
      assert.throws(() => new Cpu8080(ram, state), RangeError, `${name}: ${value}`);
    }
    assert.equal(new Cpu8080(ram, initialState({ [name]: maximum })).snapshot()[name], maximum);
  }
  assert.deepEqual(ram.accesses, []);
});

test("8080 rejects non-boolean initial flags and control latches", () => {
  const ram = new ObservedRam();
  for (const name of ["s", "z", "ac", "p", "cy"] as const) {
    const state = initialState();
    // @ts-expect-error Exercise invalid JavaScript input at the host boundary.
    state.flags[name] = 1;
    assert.throws(() => new Cpu8080(ram, state), TypeError);
  }
  for (const name of ["interruptEnabled", "halted"] as const) {
    const state = initialState();
    // @ts-expect-error Exercise invalid JavaScript input at the host boundary.
    state[name] = 0;
    assert.throws(() => new Cpu8080(ram, state), TypeError);
  }
  assert.deepEqual(ram.accesses, []);
});
