import assert from "node:assert/strict";
import { test } from "node:test";
import { runCpu } from "../../../src/runtime/run-cpu.js";
import type { Ram } from "../../../src/components/memory/ram.js";
import {
  create6502AddressingExample,
  create6502AddressingExampleMemory,
} from "../../../src/machines/generated/6502/addressing-example.js";

function expectedInitialState() {
  return {
    a: 0x11, x: 0x22, y: 0x33, pc: 0x0200, sp: 0xff,
    flags: { n: false, v: true, d: true, i: false, z: true, c: true },
  };
}

function checkExampleMemory(ram: Ram, changes: readonly (readonly [number, number])[] = []): void {
  // Literal expectations from the specification, independent of the definition.
  const expected = new Uint8Array(65_536);
  expected.set([0xa5, 0xff, 0x85, 0x00], 0x0200);
  expected[0x00ff] = 0xa5;
  expected[0xfffc] = 0x00;
  expected[0xfffd] = 0x02;
  for (const [address, value] of changes) expected[address] = value;
  assert.equal(ram.size, expected.length);
  for (const [address, value] of expected.entries()) {
    assert.equal(ram.read(address), value, `memory at ${address}`);
  }
}

test("the 6502 addressing example creates its four-byte program, source byte, vector, state, and endpoint", () => {
  const { cpu, ram, endAddress } = create6502AddressingExample();
  assert.deepEqual(cpu.snapshot(), expectedInitialState());
  assert.equal(endAddress, 0x0204);
  checkExampleMemory(ram);
  const memory = create6502AddressingExampleMemory();
  checkExampleMemory(memory);
  assert.notEqual(memory, ram);
  memory.write(0x0200, 0);
  memory.write(0x00ff, 0x5a);
  memory.write(0x0000, 0xff);
  checkExampleMemory(ram);
});

test("the 6502 addressing lesson copies A5 from 00FF to 0000 and stops before fetching its endpoint", t => {
  const { cpu, ram, endAddress } = create6502AddressingExample();
  const read = t.mock.method(ram, "read");
  const write = t.mock.method(ram, "write");
  const { records, stopReason } = runCpu(cpu, { maxSteps: 4, endAddress });
  assert.equal(stopReason, "completed");
  const before = expectedInitialState();
  const afterLoad = { ...before, a: 0xa5, pc: 0x0202, flags: { ...before.flags, n: true, z: false } };
  const afterStore = { ...afterLoad, pc: 0x0204 };
  assert.deepEqual(records, [
    {
      instruction: { address: 0x0200, bytes: [0xa5, 0xff] },
      before, after: afterLoad,
      accesses: [
        { kind: "read", address: 0x0200, value: 0xa5 },
        { kind: "read", address: 0x0201, value: 0xff },
        { kind: "read", address: 0x00ff, value: 0xa5 },
      ],
      outcome: "executed",
    },
    {
      instruction: { address: 0x0202, bytes: [0x85, 0x00] },
      before: afterLoad, after: afterStore,
      accesses: [
        { kind: "read", address: 0x0202, value: 0x85 },
        { kind: "read", address: 0x0203, value: 0x00 },
        { kind: "write", address: 0x0000, value: 0xa5 },
      ],
      outcome: "executed",
    },
  ]);
  assert.equal(cpu.snapshot().pc, endAddress);
  assert.deepEqual(cpu.snapshot(), afterStore);
  assert.deepEqual(read.mock.calls.map(call => call.arguments), [
    [0x0200], [0x0201], [0x00ff], [0x0202], [0x0203],
  ]);
  assert.deepEqual(write.mock.calls.map(call => call.arguments), [[0x0000, 0xa5]]);
  t.mock.restoreAll();
  checkExampleMemory(ram, [[0x0000, 0xa5]]);
  // Completion belongs to the caller; a direct step still attempts BRK.
  assert.deepEqual(cpu.step(), {
    instruction: { address: 0x0204, bytes: [0x00] },
    before: afterStore, after: afterStore,
    accesses: [{ kind: "read", address: 0x0204, value: 0x00 }],
    outcome: "unsupported", reason: "opcode",
  });
});

test("6502 addressing records retain loaded data, reset preserves RAM, and restart creates fresh components", () => {
  const first = create6502AddressingExample();
  const load = first.cpu.step();
  const savedLoad = structuredClone(load);
  first.ram.write(0x00ff, 0x5a); // Changing the source does not change the byte already in A.
  const store = first.cpu.step();
  const savedStore = structuredClone(store);
  const beforeReset = {
    ...expectedInitialState(), a: 0xa5, pc: 0x0204,
    flags: { ...expectedInitialState().flags, n: true, z: false },
  };
  assert.deepEqual(first.cpu.snapshot(), beforeReset);
  checkExampleMemory(first.ram, [[0x00ff, 0x5a], [0x0000, 0xa5]]);
  const afterReset = { ...beforeReset, pc: 0x0200, sp: 0xfc, flags: { ...beforeReset.flags, i: true } };
  const reset = first.cpu.reset();
  const savedReset = structuredClone(reset);
  assert.deepEqual(reset, {
    before: beforeReset, after: afterReset,
    accesses: [
      { kind: "read", address: 0xfffc, value: 0x00 },
      { kind: "read", address: 0xfffd, value: 0x02 },
    ],
  });
  assert.deepEqual(first.cpu.snapshot(), afterReset);
  checkExampleMemory(first.ram, [[0x00ff, 0x5a], [0x0000, 0xa5]]);
  const resumed = first.cpu.step();
  assert.deepEqual(resumed.before, afterReset);
  assert.deepEqual(resumed.after, {
    ...afterReset, a: 0x5a, pc: 0x0202, flags: { ...afterReset.flags, n: false, z: false },
  });

  const restarted = create6502AddressingExample();
  assert.notEqual(restarted.cpu, first.cpu);
  assert.notEqual(restarted.ram, first.ram);
  assert.deepEqual(restarted.cpu.snapshot(), expectedInitialState());
  assert.equal(restarted.endAddress, 0x0204);
  checkExampleMemory(restarted.ram);
  restarted.cpu.step();
  restarted.ram.write(0x0000, 0xff);
  assert.deepEqual(first.cpu.snapshot(), resumed.after);
  assert.equal(first.ram.read(0x0000), 0xa5);
  assert.deepEqual(load, savedLoad);
  assert.deepEqual(store, savedStore);
  assert.deepEqual(reset, savedReset);
});
