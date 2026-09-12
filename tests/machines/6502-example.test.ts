import assert from "node:assert/strict";
import { test } from "node:test";
import type { Cpu6502StepRecord } from "../../src/components/cpus/6502.js";
import type { Ram } from "../../src/components/memory/ram.js";
import { create6502Example } from "../../src/machines/6502-example.js";

function expectedInitialState() {
  return {
    a: 0, x: 0, y: 0, sp: 0xff, pc: 0x0200,
    flags: { n: false, v: false, d: false, i: true, z: false, c: true },
  };
}

function checkExampleMemory(ram: Ram, result: number): void {
  // Literal bytes and addresses from the specification, independent of the loader.
  const expected = new Uint8Array(65_536);
  expected.set([0x18, 0xa9, 0x02, 0x69, 0x03, 0x8d, 0x80, 0x00], 0x0200);
  expected[0xfffc] = 0x00;
  expected[0xfffd] = 0x02;
  expected[0x0080] = result;
  assert.equal(ram.size, expected.length);
  for (const [address, value] of expected.entries()) {
    assert.equal(ram.read(address), value, `memory at ${address}`);
  }
}

test("the 6502 example creates the full image, vector, initial state, and completion address", () => {
  const { cpu, ram, endAddress } = create6502Example();
  assert.deepEqual(cpu.snapshot(), expectedInitialState());
  assert.equal(endAddress, 0x0208);
  checkExampleMemory(ram, 0);
});

test("the complete 6502 lesson stores 5 and stops before fetching at its completion address", (t) => {
  const { cpu, ram, endAddress } = create6502Example();
  // Observe real calls without changing the factory's CPU or RAM.
  const read = t.mock.method(ram, "read");
  const write = t.mock.method(ram, "write");
  const records: Cpu6502StepRecord[] = [];
  for (let remaining = 8; remaining > 0 && cpu.snapshot().pc !== endAddress; remaining--) {
    const record = cpu.step();
    records.push(record);
    if (record.outcome === "unsupported") break;
  }
  const before = expectedInitialState();
  const afterClear = { ...before, pc: 0x0201, flags: { ...before.flags, c: false } };
  const afterLoad = { ...afterClear, a: 2, pc: 0x0203 };
  const afterAdd = { ...afterLoad, a: 5, pc: 0x0205 };
  const afterStore = { ...afterAdd, pc: 0x0208 };
  assert.deepEqual(records, [
    {
      instruction: { address: 0x0200, bytes: [0x18] },
      before,
      after: afterClear,
      accesses: [{ kind: "read", address: 0x0200, value: 0x18 }],
      outcome: "executed",
    },
    {
      instruction: { address: 0x0201, bytes: [0xa9, 0x02] },
      before: afterClear,
      after: afterLoad,
      accesses: [
        { kind: "read", address: 0x0201, value: 0xa9 },
        { kind: "read", address: 0x0202, value: 0x02 },
      ],
      outcome: "executed",
    },
    {
      instruction: { address: 0x0203, bytes: [0x69, 0x03] },
      before: afterLoad,
      after: afterAdd,
      accesses: [
        { kind: "read", address: 0x0203, value: 0x69 },
        { kind: "read", address: 0x0204, value: 0x03 },
      ],
      outcome: "executed",
    },
    {
      instruction: { address: 0x0205, bytes: [0x8d, 0x80, 0x00] },
      before: afterAdd,
      after: afterStore,
      accesses: [
        { kind: "read", address: 0x0205, value: 0x8d },
        { kind: "read", address: 0x0206, value: 0x80 },
        { kind: "read", address: 0x0207, value: 0x00 },
        { kind: "write", address: 0x0080, value: 5 },
      ],
      outcome: "executed",
    },
  ]);
  assert.equal(cpu.snapshot().pc, endAddress);
  assert.deepEqual(cpu.snapshot(), afterStore);
  assert.deepEqual(read.mock.calls.map((call) => call.arguments), [
    [0x0200], [0x0201], [0x0202], [0x0203], [0x0204], [0x0205], [0x0206], [0x0207],
  ]);
  assert.deepEqual(write.mock.calls.map((call) => call.arguments), [[0x0080, 5]]);

  // Completion belongs to the caller; a direct CPU step still attempts BRK.
  read.mock.resetCalls();
  write.mock.resetCalls();
  assert.deepEqual(cpu.step(), {
    instruction: { address: 0x0208, bytes: [0x00] },
    before: afterStore,
    after: afterStore,
    accesses: [{ kind: "read", address: 0x0208, value: 0x00 }],
    outcome: "unsupported",
    reason: "opcode",
  });
  assert.deepEqual(cpu.snapshot(), afterStore);
  assert.deepEqual(read.mock.calls.map((call) => call.arguments), [[0x0208]]);
  assert.deepEqual(write.mock.calls, []);
  t.mock.restoreAll();
  checkExampleMemory(ram, 5);
});

test("reset after the complete 6502 lesson preserves the result and decrements SP on each call", () => {
  const { cpu, ram } = create6502Example();
  for (let step = 0; step < 4; step++) {
    assert.equal(cpu.step().outcome, "executed");
  }
  const finalState = {
    ...expectedInitialState(), a: 5, pc: 0x0208,
    flags: { ...expectedInitialState().flags, c: false },
  };
  assert.deepEqual(cpu.snapshot(), finalState);
  let before = finalState;
  for (const sp of [0xfc, 0xf9]) {
    const after = { ...before, pc: 0x0200, sp };
    assert.deepEqual(cpu.reset(), {
      before,
      after,
      accesses: [
        { kind: "read", address: 0xfffc, value: 0 },
        { kind: "read", address: 0xfffd, value: 2 },
      ],
    });
    assert.deepEqual(cpu.snapshot(), after);
    checkExampleMemory(ram, 5);
    before = after;
  }
});

test("6502 CPU reset preserves lesson data while restart restores the original state and image", () => {
  const first = create6502Example();
  const record = first.cpu.step();
  const savedRecord = structuredClone(record);
  const loadRecord = first.cpu.step();
  const savedLoadRecord = structuredClone(loadRecord);
  const addRecord = first.cpu.step();
  const savedAddRecord = structuredClone(addRecord);
  const storeRecord = first.cpu.step();
  const savedStoreRecord = structuredClone(storeRecord);
  const changedState = first.cpu.snapshot();
  assert.equal(changedState.a, 5);
  assert.equal(changedState.pc, 0x0208);
  assert.equal(changedState.flags.c, false);
  assert.equal(first.ram.read(0x0080), 5);
  first.ram.write(0x0200, 0);
  first.ram.write(0x0201, 0xff);
  first.ram.write(0xfffd, 0xff);
  first.ram.write(0xffff, 0xff);

  const savedMemory = Array.from({ length: first.ram.size }, (_, address) => first.ram.read(address));
  const reset = first.cpu.reset();
  const savedReset = structuredClone(reset);
  const afterReset = { ...changedState, pc: 0xff00, sp: 0xfc };
  assert.deepEqual(reset, {
    before: changedState,
    after: afterReset,
    accesses: [
      { kind: "read", address: 0xfffc, value: 0 },
      { kind: "read", address: 0xfffd, value: 0xff },
    ],
  });
  assert.deepEqual(first.cpu.snapshot(), afterReset);
  for (const [address, value] of savedMemory.entries()) {
    assert.equal(first.ram.read(address), value, `reset preserves memory at ${address}`);
  }

  const restarted = create6502Example();
  assert.notEqual(restarted.cpu, first.cpu);
  assert.notEqual(restarted.ram, first.ram);
  assert.deepEqual(restarted.cpu.snapshot(), expectedInitialState());
  assert.equal(restarted.endAddress, 0x0208);
  checkExampleMemory(restarted.ram, 0);
  restarted.ram.write(0x0080, 9);
  assert.equal(first.ram.read(0x0080), 5);
  assert.equal(first.ram.read(0xfffd), 0xff);
  assert.deepEqual(first.cpu.snapshot(), afterReset);
  assert.deepEqual(record, savedRecord);
  assert.deepEqual(loadRecord, savedLoadRecord);
  assert.deepEqual(addRecord, savedAddRecord);
  assert.deepEqual(storeRecord, savedStoreRecord);
  assert.deepEqual(reset, savedReset);
});
