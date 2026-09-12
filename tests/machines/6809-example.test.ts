import assert from "node:assert/strict";
import { test } from "node:test";
import type { Cpu6809StepRecord } from "../../src/components/cpus/6809.js";
import type { Ram } from "../../src/components/memory/ram.js";
import { create6809Example } from "../../src/machines/6809-example.js";

function expectedInitialState() {
  return {
    a: 0, b: 0x34, dp: 0x12, x: 0, y: 0, s: 0x8000, u: 0x4000, pc: 0x0200, d: 0x0034,
    flags: { e: false, f: true, h: true, i: true, n: false, z: false, v: true, c: true },
  };
}

function checkExampleMemory(ram: Ram): void {
  // Literal bytes and addresses from the specification, independent of the loader.
  const expected = new Uint8Array(65_536);
  expected.set([0x86, 0x02, 0x8b, 0x03, 0xb7, 0x00, 0x80], 0x0200);
  expected[0xfffe] = 0x02;
  expected[0xffff] = 0x00;
  assert.equal(ram.size, expected.length);
  for (const [address, value] of expected.entries()) {
    assert.equal(ram.read(address), value, `memory at ${address}`);
  }
}

test("the 6809 example creates the full image, high/low reset vector, state, and completion address", () => {
  const { cpu, ram, endAddress } = create6809Example();
  assert.deepEqual(cpu.snapshot(), expectedInitialState());
  assert.equal(endAddress, 0x0207);
  checkExampleMemory(ram);
});

test("the partial 6809 lesson loads 2 and stops at the unsupported ADDA with exact records", (t) => {
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
      instruction: { address: 0x0202, bytes: [0x8b] },
      before: afterLoad,
      after: afterLoad,
      accesses: [{ kind: "read", address: 0x0202, value: 0x8b }],
      outcome: "unsupported",
      reason: "opcode",
    },
  ]);
  assert.deepEqual(cpu.snapshot(), afterLoad);
  assert.notEqual(cpu.snapshot().pc, endAddress);
  assert.deepEqual(read.mock.calls.map((call) => call.arguments), [[0x0200], [0x0201], [0x0202]]);
  assert.deepEqual(write.mock.calls, []);
  t.mock.restoreAll();
  checkExampleMemory(ram);
});

test("restarting the 6809 lesson restores its original state and memory with independent components", () => {
  const first = create6809Example();
  const loaded = first.cpu.step();
  const rejected = first.cpu.step();
  const savedLoaded = structuredClone(loaded);
  const savedRejected = structuredClone(rejected);
  const changedState = first.cpu.snapshot();
  assert.equal(changedState.a, 2);
  assert.equal(changedState.d, 0x0234);
  assert.equal(changedState.pc, 0x0202);
  first.ram.write(0x0080, 5);
  first.ram.write(0x0200, 0);
  first.ram.write(0x0201, 0xff);
  first.ram.write(0xfffe, 0xff);
  first.ram.write(0xffff, 0xff);
  const savedMemory = Array.from({ length: first.ram.size }, (_, address) => first.ram.read(address));

  const restarted = create6809Example();
  assert.notEqual(restarted.cpu, first.cpu);
  assert.notEqual(restarted.ram, first.ram);
  assert.deepEqual(restarted.cpu.snapshot(), expectedInitialState());
  assert.equal(restarted.endAddress, 0x0207);
  checkExampleMemory(restarted.ram);
  assert.deepEqual(restarted.cpu.step(), savedLoaded);
  restarted.ram.write(0x0080, 9);
  assert.deepEqual(first.cpu.snapshot(), changedState);
  for (const [address, value] of savedMemory.entries()) {
    assert.equal(first.ram.read(address), value, `original memory at ${address}`);
  }
  assert.deepEqual(loaded, savedLoaded);
  assert.deepEqual(rejected, savedRejected);
});
