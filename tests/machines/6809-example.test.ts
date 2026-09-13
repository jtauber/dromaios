import assert from "node:assert/strict";
import { test } from "node:test";
import type { Cpu6809StepRecord } from "../../src/components/cpus/6809.js";
import type { Ram } from "../../src/components/memory/ram.js";
import { create6809Example } from "../../src/machines/generated/6809-example.js";

function expectedInitialState() {
  return {
    a: 0, b: 0x34, dp: 0x12, x: 0, y: 0, s: 0x8000, u: 0x4000, pc: 0x0200, d: 0x0034,
    flags: { e: false, f: true, h: true, i: true, n: false, z: false, v: true, c: true },
  };
}

function checkExampleMemory(ram: Ram, result: number): void {
  // Literal bytes and addresses from the specification, independent of the loader.
  const expected = new Uint8Array(65_536);
  expected.set([0x86, 0x02, 0x8b, 0x03, 0xb7, 0x00, 0x80], 0x0200);
  expected[0xfffe] = 0x02;
  expected[0xffff] = 0x00;
  expected[0x0080] = result;
  assert.equal(ram.size, expected.length);
  for (const [address, value] of expected.entries()) {
    assert.equal(ram.read(address), value, `memory at ${address}`);
  }
}

test("the 6809 example creates the full image, high/low reset vector, state, and completion address", () => {
  const { cpu, ram, endAddress } = create6809Example();
  assert.deepEqual(cpu.snapshot(), expectedInitialState());
  assert.equal(endAddress, 0x0207);
  checkExampleMemory(ram, 0);
});

test("the complete 6809 lesson stores 5 and stops before fetching at its completion address", (t) => {
  const { cpu, ram, endAddress } = create6809Example();
  const read = t.mock.method(ram, "read");
  const write = t.mock.method(ram, "write");
  const records: Cpu6809StepRecord[] = [];
  for (let remaining = 8; remaining > 0 && cpu.snapshot().pc !== endAddress; remaining--) {
    const record = cpu.step();
    records.push(record);
    if (record.outcome === "unsupported") break;
  }
  const before = expectedInitialState();
  const afterLoad = { ...before, a: 2, d: 0x0234, pc: 0x0202, flags: { ...before.flags, v: false } };
  const afterAdd = {
    ...afterLoad, a: 5, d: 0x0534, pc: 0x0204, flags: { ...afterLoad.flags, h: false, c: false },
  };
  const afterStore = { ...afterAdd, pc: 0x0207 };
  assert.deepEqual(records, [
    {
      instruction: { address: 0x0200, bytes: [0x86, 0x02] },
      before,
      after: afterLoad,
      accesses: [
        { kind: "read", address: 0x0200, value: 0x86 },
        { kind: "read", address: 0x0201, value: 0x02 },
      ],
      outcome: "executed",
    },
    {
      instruction: { address: 0x0202, bytes: [0x8b, 0x03] },
      before: afterLoad,
      after: afterAdd,
      accesses: [
        { kind: "read", address: 0x0202, value: 0x8b },
        { kind: "read", address: 0x0203, value: 0x03 },
      ],
      outcome: "executed",
    },
    {
      instruction: { address: 0x0204, bytes: [0xb7, 0x00, 0x80] },
      before: afterAdd,
      after: afterStore,
      accesses: [
        { kind: "read", address: 0x0204, value: 0xb7 },
        { kind: "read", address: 0x0205, value: 0x00 },
        { kind: "read", address: 0x0206, value: 0x80 },
        { kind: "write", address: 0x0080, value: 5 },
      ],
      outcome: "executed",
    },
  ]);
  assert.deepEqual(cpu.snapshot(), afterStore);
  assert.equal(cpu.snapshot().pc, endAddress);
  assert.deepEqual(read.mock.calls.map((call) => call.arguments), [
    [0x0200], [0x0201], [0x0202], [0x0203], [0x0204], [0x0205], [0x0206],
  ]);
  assert.deepEqual(write.mock.calls.map((call) => call.arguments), [[0x0080, 5]]);

  // Completion belongs to the caller; a direct CPU step still attempts opcode 00.
  read.mock.resetCalls();
  write.mock.resetCalls();
  assert.deepEqual(cpu.step(), {
    instruction: { address: 0x0207, bytes: [0x00] },
    before: afterStore,
    after: afterStore,
    accesses: [{ kind: "read", address: 0x0207, value: 0x00 }],
    outcome: "unsupported",
    reason: "opcode",
  });
  assert.deepEqual(cpu.snapshot(), afterStore);
  assert.deepEqual(read.mock.calls.map((call) => call.arguments), [[0x0207]]);
  assert.deepEqual(write.mock.calls, []);
  t.mock.restoreAll();
  checkExampleMemory(ram, 5);
});

test("6809 reset preserves the completed lesson's result on repeated calls and resumes with DP cleared", (t) => {
  const { cpu, ram } = create6809Example();
  assert.equal(cpu.step().outcome, "executed");
  assert.equal(cpu.step().outcome, "executed");
  assert.equal(cpu.step().outcome, "executed");
  const read = t.mock.method(ram, "read");
  const write = t.mock.method(ram, "write");
  const initial = expectedInitialState();
  const before = {
    ...initial, a: 5, d: 0x0534, pc: 0x0207,
    flags: { ...initial.flags, h: false, v: false, c: false },
  };
  const afterReset = { ...before, pc: 0x0200, dp: 0 };
  for (const current of [before, afterReset]) {
    assert.deepEqual(cpu.reset(), {
      before: current,
      after: afterReset,
      accesses: [
        { kind: "read", address: 0xfffe, value: 2 },
        { kind: "read", address: 0xffff, value: 0 },
      ],
    });
    assert.deepEqual(cpu.snapshot(), afterReset);
    assert.deepEqual(read.mock.calls.map((call) => call.arguments), [[0xfffe], [0xffff]]);
    assert.deepEqual(write.mock.calls, []);
    read.mock.resetCalls();
  }
  assert.equal(ram.read(0x0080), 5);
  read.mock.resetCalls();

  const afterLoad = { ...afterReset, a: 2, d: 0x0234, pc: 0x0202 };
  assert.deepEqual(cpu.step(), {
    instruction: { address: 0x0200, bytes: [0x86, 2] },
    before: afterReset,
    after: afterLoad,
    accesses: [
      { kind: "read", address: 0x0200, value: 0x86 },
      { kind: "read", address: 0x0201, value: 2 },
    ],
    outcome: "executed",
  });
  assert.deepEqual(cpu.snapshot(), afterLoad);
  const afterAdd = { ...afterLoad, a: 5, d: 0x0534, pc: 0x0204 };
  assert.deepEqual(cpu.step(), {
    instruction: { address: 0x0202, bytes: [0x8b, 3] },
    before: afterLoad,
    after: afterAdd,
    accesses: [
      { kind: "read", address: 0x0202, value: 0x8b },
      { kind: "read", address: 0x0203, value: 3 },
    ],
    outcome: "executed",
  });
  assert.deepEqual(cpu.snapshot(), afterAdd);
  const afterStore = { ...afterAdd, pc: 0x0207 };
  assert.deepEqual(cpu.step(), {
    instruction: { address: 0x0204, bytes: [0xb7, 0, 0x80] },
    before: afterAdd,
    after: afterStore,
    accesses: [
      { kind: "read", address: 0x0204, value: 0xb7 },
      { kind: "read", address: 0x0205, value: 0 },
      { kind: "read", address: 0x0206, value: 0x80 },
      { kind: "write", address: 0x0080, value: 5 },
    ],
    outcome: "executed",
  });
  assert.deepEqual(cpu.snapshot(), afterStore);
  assert.deepEqual(read.mock.calls.map((call) => call.arguments), [
    [0x0200], [0x0201], [0x0202], [0x0203], [0x0204], [0x0205], [0x0206],
  ]);
  assert.deepEqual(write.mock.calls.map((call) => call.arguments), [[0x0080, 5]]);
  t.mock.restoreAll();
  checkExampleMemory(ram, 5);
});

test("6809 reset preserves lesson data while restart restores the original state and image", () => {
  const first = create6809Example();
  const loaded = first.cpu.step();
  const added = first.cpu.step();
  const stored = first.cpu.step();
  const rejected = first.cpu.step();
  const savedLoaded = structuredClone(loaded);
  const savedAdded = structuredClone(added);
  const savedStored = structuredClone(stored);
  const savedRejected = structuredClone(rejected);
  const changedState = first.cpu.snapshot();
  assert.equal(changedState.a, 5);
  assert.equal(changedState.d, 0x0534);
  assert.equal(changedState.pc, 0x0207);
  assert.equal(changedState.flags.h, false);
  assert.equal(changedState.flags.c, false);
  assert.equal(first.ram.read(0x0080), 5);
  first.ram.write(0x0200, 0);
  first.ram.write(0x0201, 0xff);
  first.ram.write(0xfffe, 0xff);
  first.ram.write(0xffff, 0xff);
  const savedMemory = Array.from({ length: first.ram.size }, (_, address) => first.ram.read(address));
  const reset = first.cpu.reset();
  const savedReset = structuredClone(reset);
  const afterReset = { ...changedState, pc: 0xffff, dp: 0 };
  assert.deepEqual(reset, {
    before: changedState,
    after: afterReset,
    accesses: [
      { kind: "read", address: 0xfffe, value: 0xff },
      { kind: "read", address: 0xffff, value: 0xff },
    ],
  });
  assert.deepEqual(first.cpu.snapshot(), afterReset);

  const restarted = create6809Example();
  assert.notEqual(restarted.cpu, first.cpu);
  assert.notEqual(restarted.ram, first.ram);
  assert.deepEqual(restarted.cpu.snapshot(), expectedInitialState());
  assert.equal(restarted.endAddress, 0x0207);
  checkExampleMemory(restarted.ram, 0);
  assert.deepEqual(restarted.cpu.step(), savedLoaded);
  assert.deepEqual(restarted.cpu.step(), savedAdded);
  assert.deepEqual(restarted.cpu.step(), savedStored);
  assert.deepEqual(restarted.cpu.step(), savedRejected);
  restarted.ram.write(0x0080, 9);
  assert.deepEqual(first.cpu.snapshot(), afterReset);
  for (const [address, value] of savedMemory.entries()) {
    assert.equal(first.ram.read(address), value, `original memory at ${address}`);
  }
  assert.deepEqual(loaded, savedLoaded);
  assert.deepEqual(added, savedAdded);
  assert.deepEqual(stored, savedStored);
  assert.deepEqual(rejected, savedRejected);
  assert.deepEqual(reset, savedReset);
});
