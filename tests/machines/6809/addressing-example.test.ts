import assert from "node:assert/strict";
import { test } from "node:test";
import type { Cpu6809StepRecord } from "../../../src/components/cpus/6809.js";
import type { Ram } from "../../../src/components/memory/ram.js";
import {
  create6809AddressingExample,
  create6809AddressingExampleMemory,
} from "../../../src/machines/generated/6809/addressing-example.js";

function expectedInitialState() {
  return {
    a: 0x11, b: 0x34, dp: 0x12, x: 0x2345, y: 0x4567,
    s: 0x8000, u: 0x4000, pc: 0x0200, d: 0x1134,
    flags: { e: true, f: false, h: true, i: false, n: false, z: true, v: true, c: true },
  };
}

function checkExampleMemory(ram: Ram, changes: readonly (readonly [number, number])[] = []): void {
  // Literal expectations from the specification, independent of the definition.
  const expected = new Uint8Array(65_536);
  expected.set([0x96, 0x80, 0x97, 0x81], 0x0200);
  expected[0x0080] = 0x5a;
  expected[0x1280] = 0xa5;
  expected[0xfffe] = 0x02;
  expected[0xffff] = 0x00;
  for (const [address, value] of changes) expected[address] = value;
  assert.equal(ram.size, expected.length);
  for (const [address, value] of expected.entries()) {
    assert.equal(ram.read(address), value, `memory at ${address}`);
  }
}

test("the 6809 addressing example creates its program, two source pages, reset vector, state, and endpoint", () => {
  const { cpu, ram, endAddress } = create6809AddressingExample();
  assert.deepEqual(cpu.snapshot(), expectedInitialState());
  assert.equal(endAddress, 0x0204);
  checkExampleMemory(ram);
  const memory = create6809AddressingExampleMemory();
  checkExampleMemory(memory);
  assert.notEqual(memory, ram);
  memory.write(0x0200, 0);
  memory.write(0x1280, 0);
  memory.write(0x1281, 0xff);
  checkExampleMemory(ram);
});

test("the 6809 addressing lesson copies A5 from 1280 to 1281 and stops before fetching its endpoint", t => {
  const { cpu, ram, endAddress } = create6809AddressingExample();
  const read = t.mock.method(ram, "read");
  const write = t.mock.method(ram, "write");
  const records: Cpu6809StepRecord[] = [];
  for (let remaining = 4; remaining > 0 && cpu.snapshot().pc !== endAddress; remaining--) {
    const record = cpu.step();
    records.push(record);
    if (record.outcome === "unsupported") break;
  }
  const before = expectedInitialState();
  const afterLoad = {
    ...before, a: 0xa5, d: 0xa534, pc: 0x0202,
    flags: { ...before.flags, n: true, z: false, v: false },
  };
  const afterStore = { ...afterLoad, pc: 0x0204 };
  assert.deepEqual(records, [
    {
      instruction: { address: 0x0200, bytes: [0x96, 0x80] },
      before, after: afterLoad,
      accesses: [
        { kind: "read", address: 0x0200, value: 0x96 },
        { kind: "read", address: 0x0201, value: 0x80 },
        { kind: "read", address: 0x1280, value: 0xa5 },
      ],
      outcome: "executed",
    },
    {
      instruction: { address: 0x0202, bytes: [0x97, 0x81] },
      before: afterLoad, after: afterStore,
      accesses: [
        { kind: "read", address: 0x0202, value: 0x97 },
        { kind: "read", address: 0x0203, value: 0x81 },
        { kind: "write", address: 0x1281, value: 0xa5 },
      ],
      outcome: "executed",
    },
  ]);
  assert.equal(cpu.snapshot().pc, endAddress);
  assert.deepEqual(cpu.snapshot(), afterStore);
  assert.deepEqual(read.mock.calls.map(call => call.arguments), [
    [0x0200], [0x0201], [0x1280], [0x0202], [0x0203],
  ]);
  assert.deepEqual(write.mock.calls.map(call => call.arguments), [[0x1281, 0xa5]]);
  t.mock.restoreAll();
  checkExampleMemory(ram, [[0x1281, 0xa5]]);
  // Completion belongs to the caller; a direct step still attempts opcode 00.
  assert.deepEqual(cpu.step(), {
    instruction: { address: 0x0204, bytes: [0x00] },
    before: afterStore, after: afterStore,
    accesses: [{ kind: "read", address: 0x0204, value: 0x00 }],
    outcome: "unsupported", reason: "opcode",
  });
});

test("6809 reset redirects the same program to page zero while lesson restart restores DP and fresh RAM", t => {
  const first = create6809AddressingExample();
  const records = [first.cpu.step(), first.cpu.step()];
  const savedRecords = structuredClone(records);
  const initial = expectedInitialState();
  const before = {
    ...initial, a: 0xa5, d: 0xa534, pc: 0x0204,
    flags: { ...initial.flags, n: true, z: false, v: false },
  };
  assert.deepEqual(first.cpu.snapshot(), before);
  const afterReset = { ...before, dp: 0, pc: 0x0200, flags: { ...before.flags, f: true, i: true } };
  const read = t.mock.method(first.ram, "read");
  const write = t.mock.method(first.ram, "write");
  const reset = first.cpu.reset();
  const savedReset = structuredClone(reset);
  assert.deepEqual(reset, {
    before, after: afterReset,
    accesses: [
      { kind: "read", address: 0xfffe, value: 0x02 },
      { kind: "read", address: 0xffff, value: 0x00 },
    ],
  });
  assert.deepEqual(first.cpu.snapshot(), afterReset);
  assert.deepEqual(read.mock.calls.map(call => call.arguments), [[0xfffe], [0xffff]]);
  assert.deepEqual(write.mock.calls, []);
  t.mock.restoreAll();
  checkExampleMemory(first.ram, [[0x1281, 0xa5]]);

  const afterLoad = {
    ...afterReset, a: 0x5a, d: 0x5a34, pc: 0x0202, flags: { ...afterReset.flags, n: false },
  };
  const afterStore = { ...afterLoad, pc: 0x0204 };
  assert.deepEqual(first.cpu.step(), {
    instruction: { address: 0x0200, bytes: [0x96, 0x80] },
    before: afterReset, after: afterLoad,
    accesses: [
      { kind: "read", address: 0x0200, value: 0x96 },
      { kind: "read", address: 0x0201, value: 0x80 },
      { kind: "read", address: 0x0080, value: 0x5a },
    ],
    outcome: "executed",
  });
  assert.deepEqual(first.cpu.step(), {
    instruction: { address: 0x0202, bytes: [0x97, 0x81] },
    before: afterLoad, after: afterStore,
    accesses: [
      { kind: "read", address: 0x0202, value: 0x97 },
      { kind: "read", address: 0x0203, value: 0x81 },
      { kind: "write", address: 0x0081, value: 0x5a },
    ],
    outcome: "executed",
  });
  assert.deepEqual(first.cpu.snapshot(), afterStore);
  checkExampleMemory(first.ram, [[0x1281, 0xa5], [0x0081, 0x5a]]);

  const restarted = create6809AddressingExample();
  assert.notEqual(restarted.cpu, first.cpu);
  assert.notEqual(restarted.ram, first.ram);
  assert.deepEqual(restarted.cpu.snapshot(), initial);
  assert.equal(restarted.endAddress, 0x0204);
  checkExampleMemory(restarted.ram);
  assert.deepEqual(restarted.cpu.step(), savedRecords[0]);
  assert.deepEqual(restarted.cpu.step(), savedRecords[1]);
  restarted.ram.write(0x1281, 0xff);
  assert.equal(first.ram.read(0x1281), 0xa5);
  assert.deepEqual(first.cpu.snapshot(), afterStore);
  assert.deepEqual(records, savedRecords);
  assert.deepEqual(reset, savedReset);
});
