import assert from "node:assert/strict";
import { test } from "node:test";
import type { Ram } from "../../src/components/memory/ram.js";
import {
  create8080StackExample,
  create8080StackExampleMemory,
} from "../../src/machines/generated/8080-stack-example.js";

function expectedInitialState() {
  return {
    a: 0x11, b: 0x22, c: 0x33, d: 0x44, e: 0x55, h: 0x66, l: 0x77,
    bc: 0x2233, de: 0x4455, hl: 0x6677, pc: 0, sp: 0xabcd,
    flags: { s: true, z: false, ac: true, p: false, cy: true },
    interruptEnabled: false,
    halted: false,
  };
}

function checkExampleMemory(ram: Ram, pushed: boolean): void {
  // Literal bytes and addresses from the specification, independent of the loader.
  const expected = new Uint8Array(65_536);
  expected.set([0x31, 0x00, 0x20, 0x01, 0x34, 0x12, 0xc5, 0x01, 0x00, 0x00, 0xc1, 0x76], 0);
  if (pushed) {
    expected[0x1ffe] = 0x34;
    expected[0x1fff] = 0x12;
  }
  assert.equal(ram.size, expected.length);
  for (const [address, value] of expected.entries()) {
    assert.equal(ram.read(address), value, `memory at ${address}`);
  }
}

test("the 8080 stack example creates an independent twelve-byte image with a zeroed stack area", () => {
  const first = create8080StackExampleMemory();
  checkExampleMemory(first, false);
  first.write(0, 0);
  first.write(0x1ffe, 0xff);
  const second = create8080StackExampleMemory();
  checkExampleMemory(second, false);
  assert.notEqual(first, second);
  assert.equal(first.read(0), 0);
  assert.equal(first.read(0x1ffe), 0xff);
});

test("the 8080 stack lesson saves BC, clears it, restores it from RAM, and halts with the specified records", () => {
  const { cpu, ram } = create8080StackExample();
  const before = expectedInitialState();
  const afterSetSp = { ...before, sp: 0x2000, pc: 3 };
  const afterLoad = { ...afterSetSp, b: 0x12, c: 0x34, bc: 0x1234, pc: 6 };
  const afterPush = { ...afterLoad, sp: 0x1ffe, pc: 7 };
  const afterClear = { ...afterPush, b: 0, c: 0, bc: 0, pc: 10 };
  const afterPop = { ...afterLoad, pc: 11 };
  const afterHalt = { ...afterPop, pc: 12, halted: true };
  assert.deepEqual(cpu.snapshot(), before);
  checkExampleMemory(ram, false);
  assert.deepEqual(cpu.step(), {
    instruction: { address: 0, bytes: [0x31, 0x00, 0x20] },
    before,
    after: afterSetSp,
    accesses: [
      { kind: "read", address: 0, value: 0x31 },
      { kind: "read", address: 1, value: 0x00 },
      { kind: "read", address: 2, value: 0x20 },
    ],
    outcome: "executed",
  });
  assert.deepEqual(cpu.step(), {
    instruction: { address: 3, bytes: [0x01, 0x34, 0x12] },
    before: afterSetSp,
    after: afterLoad,
    accesses: [
      { kind: "read", address: 3, value: 0x01 },
      { kind: "read", address: 4, value: 0x34 },
      { kind: "read", address: 5, value: 0x12 },
    ],
    outcome: "executed",
  });
  assert.equal(ram.read(0x1ffe), 0);
  assert.equal(ram.read(0x1fff), 0);
  assert.deepEqual(cpu.step(), {
    instruction: { address: 6, bytes: [0xc5] },
    before: afterLoad,
    after: afterPush,
    accesses: [
      { kind: "read", address: 6, value: 0xc5 },
      { kind: "write", address: 0x1fff, value: 0x12 },
      { kind: "write", address: 0x1ffe, value: 0x34 },
    ],
    outcome: "executed",
  });
  assert.deepEqual(cpu.step(), {
    instruction: { address: 7, bytes: [0x01, 0x00, 0x00] },
    before: afterPush,
    after: afterClear,
    accesses: [
      { kind: "read", address: 7, value: 0x01 },
      { kind: "read", address: 8, value: 0x00 },
      { kind: "read", address: 9, value: 0x00 },
    ],
    outcome: "executed",
  });
  assert.deepEqual(cpu.step(), {
    instruction: { address: 10, bytes: [0xc1] },
    before: afterClear,
    after: afterPop,
    accesses: [
      { kind: "read", address: 10, value: 0xc1 },
      { kind: "read", address: 0x1ffe, value: 0x34 },
      { kind: "read", address: 0x1fff, value: 0x12 },
    ],
    outcome: "executed",
  });
  assert.deepEqual(cpu.step(), {
    instruction: { address: 11, bytes: [0x76] },
    before: afterPop,
    after: afterHalt,
    accesses: [{ kind: "read", address: 11, value: 0x76 }],
    outcome: "halted",
  });
  assert.deepEqual(cpu.step(), {
    instruction: null, before: afterHalt, after: afterHalt, accesses: [], outcome: "halted",
  });
  assert.deepEqual(cpu.snapshot(), afterHalt);
  checkExampleMemory(ram, true);
});

test("8080 reset preserves an occupied stack while lesson restart restores the original state and RAM", () => {
  const first = create8080StackExample();
  const records = [first.cpu.step(), first.cpu.step(), first.cpu.step()];
  const saved = structuredClone(records);
  const beforeReset = {
    ...expectedInitialState(), b: 0x12, c: 0x34, bc: 0x1234, sp: 0x1ffe, pc: 7,
  };
  const afterReset = { ...beforeReset, pc: 0 };
  assert.deepEqual(first.cpu.reset(), { before: beforeReset, after: afterReset, accesses: [] });
  assert.deepEqual(first.cpu.snapshot(), afterReset);
  checkExampleMemory(first.ram, true);
  // Executing LXI SP again changes SP; reset itself preserved it.
  const resumed = first.cpu.step();
  assert.deepEqual(resumed.before, afterReset);
  assert.deepEqual(resumed.after, { ...afterReset, sp: 0x2000, pc: 3 });
  first.ram.write(0, 0);

  const restarted = create8080StackExample();
  assert.notEqual(restarted.cpu, first.cpu);
  assert.notEqual(restarted.ram, first.ram);
  assert.deepEqual(restarted.cpu.snapshot(), expectedInitialState());
  checkExampleMemory(restarted.ram, false);
  restarted.cpu.step();
  restarted.ram.write(0x1ffe, 0x5a);
  assert.deepEqual(first.cpu.snapshot(), resumed.after);
  assert.equal(first.ram.read(0), 0);
  assert.equal(first.ram.read(0x1ffe), 0x34);
  assert.deepEqual(records, saved);
});
