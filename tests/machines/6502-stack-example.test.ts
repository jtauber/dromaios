import assert from "node:assert/strict";
import { test } from "node:test";
import type { Cpu6502StepRecord } from "../../src/components/cpus/6502.js";
import type { Ram } from "../../src/components/memory/ram.js";
import {
  create6502StackExample,
  create6502StackExampleMemory,
} from "../../src/machines/generated/6502-stack-example.js";

function expectedInitialState() {
  return {
    a: 0x11, x: 0x22, y: 0x33, pc: 0x0200, sp: 0xff,
    flags: { n: false, v: true, d: true, i: false, z: true, c: true },
  };
}

function checkExampleMemory(ram: Ram, changes: readonly (readonly [number, number])[] = []): void {
  // Literal expectations from the specification, independent of the definition.
  const expected = new Uint8Array(65_536);
  expected.set([0xa9, 0x80, 0x48, 0xa9, 0x00, 0x68, 0x8d, 0x80, 0x00], 0x0200);
  expected[0xfffc] = 0x00;
  expected[0xfffd] = 0x02;
  for (const [address, value] of changes) expected[address] = value;
  assert.equal(ram.size, expected.length);
  for (const [address, value] of expected.entries()) {
    assert.equal(ram.read(address), value, `memory at ${address}`);
  }
}

test("the 6502 stack example creates its full image, vector, explicit state, and completion address", () => {
  const { cpu, ram, endAddress } = create6502StackExample();
  assert.deepEqual(cpu.snapshot(), expectedInitialState());
  assert.equal(endAddress, 0x0209);
  checkExampleMemory(ram);
  const memory = create6502StackExampleMemory();
  checkExampleMemory(memory);
  memory.write(0x01ff, 0xff);
  assert.equal(ram.read(0x01ff), 0);
});

test("the 6502 stack lesson restores A, stores 80, and stops before its completion address is fetched", t => {
  const { cpu, ram, endAddress } = create6502StackExample();
  const read = t.mock.method(ram, "read");
  const write = t.mock.method(ram, "write");
  const records: Cpu6502StepRecord[] = [];
  for (let remaining = 8; remaining > 0 && cpu.snapshot().pc !== endAddress; remaining--) {
    const record = cpu.step();
    records.push(record);
    if (record.outcome === "unsupported") break;
  }
  const before = expectedInitialState();
  const afterLoad = { ...before, pc: 0x0202, a: 0x80, flags: { ...before.flags, n: true, z: false } };
  const afterPush = { ...afterLoad, pc: 0x0203, sp: 0xfe };
  const afterClear = { ...afterPush, pc: 0x0205, a: 0, flags: { ...afterPush.flags, n: false, z: true } };
  const afterPull = { ...afterLoad, pc: 0x0206 };
  const afterStore = { ...afterPull, pc: 0x0209 };
  assert.deepEqual(records, [
    {
      instruction: { address: 0x0200, bytes: [0xa9, 0x80] },
      before, after: afterLoad,
      accesses: [
        { kind: "read", address: 0x0200, value: 0xa9 },
        { kind: "read", address: 0x0201, value: 0x80 },
      ],
      outcome: "executed",
    },
    {
      instruction: { address: 0x0202, bytes: [0x48] },
      before: afterLoad, after: afterPush,
      accesses: [
        { kind: "read", address: 0x0202, value: 0x48 },
        { kind: "write", address: 0x01ff, value: 0x80 },
      ],
      outcome: "executed",
    },
    {
      instruction: { address: 0x0203, bytes: [0xa9, 0x00] },
      before: afterPush, after: afterClear,
      accesses: [
        { kind: "read", address: 0x0203, value: 0xa9 },
        { kind: "read", address: 0x0204, value: 0x00 },
      ],
      outcome: "executed",
    },
    {
      instruction: { address: 0x0205, bytes: [0x68] },
      before: afterClear, after: afterPull,
      accesses: [
        { kind: "read", address: 0x0205, value: 0x68 },
        { kind: "read", address: 0x01ff, value: 0x80 },
      ],
      outcome: "executed",
    },
    {
      instruction: { address: 0x0206, bytes: [0x8d, 0x80, 0x00] },
      before: afterPull, after: afterStore,
      accesses: [
        { kind: "read", address: 0x0206, value: 0x8d },
        { kind: "read", address: 0x0207, value: 0x80 },
        { kind: "read", address: 0x0208, value: 0x00 },
        { kind: "write", address: 0x0080, value: 0x80 },
      ],
      outcome: "executed",
    },
  ]);
  assert.equal(cpu.snapshot().pc, endAddress);
  assert.deepEqual(cpu.snapshot(), afterStore);
  assert.deepEqual(read.mock.calls.map(call => call.arguments), [
    [0x0200], [0x0201], [0x0202], [0x0203], [0x0204], [0x0205], [0x01ff],
    [0x0206], [0x0207], [0x0208],
  ]);
  assert.deepEqual(write.mock.calls.map(call => call.arguments), [[0x01ff, 0x80], [0x0080, 0x80]]);
  t.mock.restoreAll();
  checkExampleMemory(ram, [[0x01ff, 0x80], [0x0080, 0x80]]);
  // The endpoint belongs to the caller; a further CPU step still attempts BRK.
  assert.deepEqual(cpu.step(), {
    instruction: { address: 0x0209, bytes: [0x00] },
    before: afterStore, after: afterStore,
    accesses: [{ kind: "read", address: 0x0209, value: 0x00 }],
    outcome: "unsupported", reason: "opcode",
  });
});

test("reset with an occupied 6502 stack preserves its byte, while lesson restart restores fresh state", t => {
  const first = create6502StackExample();
  const load = first.cpu.step();
  const push = first.cpu.step();
  const savedLoad = structuredClone(load);
  const savedPush = structuredClone(push);
  const before = {
    ...expectedInitialState(), a: 0x80, pc: 0x0203, sp: 0xfe,
    flags: { ...expectedInitialState().flags, n: true, z: false },
  };
  assert.deepEqual(first.cpu.snapshot(), before);
  const after = { ...before, pc: 0x0200, sp: 0xfb, flags: { ...before.flags, i: true } };
  const read = t.mock.method(first.ram, "read");
  const write = t.mock.method(first.ram, "write");
  const reset = first.cpu.reset();
  const savedReset = structuredClone(reset);
  assert.deepEqual(reset, {
    before, after,
    accesses: [
      { kind: "read", address: 0xfffc, value: 0x00 },
      { kind: "read", address: 0xfffd, value: 0x02 },
    ],
  });
  assert.deepEqual(first.cpu.snapshot(), after);
  assert.deepEqual(read.mock.calls.map(call => call.arguments), [[0xfffc], [0xfffd]]);
  assert.deepEqual(write.mock.calls, []);
  t.mock.restoreAll();
  checkExampleMemory(first.ram, [[0x01ff, 0x80]]);

  // The resumed program uses the reset-adjusted SP; it does not reinitialize it.
  for (let step = 0; step < 5; step++) assert.equal(first.cpu.step().outcome, "executed");
  assert.deepEqual(first.cpu.snapshot(), { ...after, pc: 0x0209 });
  checkExampleMemory(first.ram, [[0x01ff, 0x80], [0x01fb, 0x80], [0x0080, 0x80]]);
  const restarted = create6502StackExample();
  assert.notEqual(restarted.cpu, first.cpu);
  assert.notEqual(restarted.ram, first.ram);
  assert.deepEqual(restarted.cpu.snapshot(), expectedInitialState());
  assert.equal(restarted.endAddress, 0x0209);
  checkExampleMemory(restarted.ram);
  restarted.ram.write(0x01ff, 0x55);
  assert.equal(first.ram.read(0x01ff), 0x80);
  assert.deepEqual(load, savedLoad);
  assert.deepEqual(push, savedPush);
  assert.deepEqual(reset, savedReset);
});
