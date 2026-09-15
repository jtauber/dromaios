import assert from "node:assert/strict";
import { test } from "node:test";
import type { Ram } from "../../../src/components/memory/ram.js";
import {
  create8080AddressingExample,
  create8080AddressingExampleMemory,
} from "../../../src/machines/generated/8080/addressing-example.js";

function expectedInitialState() {
  return {
    a: 0x11, b: 0x22, c: 0x33, d: 0x44, e: 0x55, h: 0x66, l: 0x77,
    bc: 0x2233, de: 0x4455, hl: 0x6677, pc: 0, sp: 0xabcd,
    flags: { s: true, z: false, ac: true, p: false, cy: true },
    interruptEnabled: false, interruptDeferred: false,
    halted: false,
  };
}

function checkExampleMemory(ram: Ram, copied: boolean): void {
  // Literal bytes and addresses from the specification, independent of the loader.
  const expected = new Uint8Array(65_536);
  expected.set([0x21, 0xff, 0x12, 0x7e, 0x23, 0x77, 0x76], 0);
  expected[0x12ff] = 0xa5;
  if (copied) expected[0x1300] = 0xa5;
  assert.equal(ram.size, expected.length);
  for (const [address, value] of expected.entries()) {
    assert.equal(ram.read(address), value, `memory at ${address}`);
  }
}

test("the 8080 addressing example creates independent RAM with its seven-byte program and source byte", () => {
  const first = create8080AddressingExampleMemory();
  checkExampleMemory(first, false);
  first.write(0, 0);
  first.write(0x12ff, 0x5a);
  first.write(0x1300, 0xff);
  const second = create8080AddressingExampleMemory();
  checkExampleMemory(second, false);
  assert.notEqual(first, second);
  assert.equal(first.read(0), 0);
  assert.equal(first.read(0x12ff), 0x5a);
  assert.equal(first.read(0x1300), 0xff);
});

test("the 8080 addressing lesson copies A5 from 12FF to 1300 through HL with the specified records", () => {
  const { cpu, ram } = create8080AddressingExample();
  const before = expectedInitialState();
  const afterSetHl = { ...before, h: 0x12, l: 0xff, hl: 0x12ff, pc: 3 };
  const afterLoad = { ...afterSetHl, a: 0xa5, pc: 4 };
  const afterIncrement = { ...afterLoad, h: 0x13, l: 0, hl: 0x1300, pc: 5 };
  const afterStore = { ...afterIncrement, pc: 6 };
  const afterHalt = { ...afterStore, pc: 7, halted: true };
  assert.deepEqual(cpu.snapshot(), before);
  checkExampleMemory(ram, false);
  assert.deepEqual(cpu.step(), {
    instruction: { address: 0, bytes: [0x21, 0xff, 0x12] },
    before,
    after: afterSetHl,
    accesses: [
      { kind: "read", address: 0, value: 0x21 },
      { kind: "read", address: 1, value: 0xff },
      { kind: "read", address: 2, value: 0x12 },
    ],
    outcome: "executed",
  });
  assert.deepEqual(cpu.step(), {
    instruction: { address: 3, bytes: [0x7e] },
    before: afterSetHl,
    after: afterLoad,
    accesses: [
      { kind: "read", address: 3, value: 0x7e },
      { kind: "read", address: 0x12ff, value: 0xa5 },
    ],
    outcome: "executed",
  });
  assert.deepEqual(cpu.step(), {
    instruction: { address: 4, bytes: [0x23] },
    before: afterLoad,
    after: afterIncrement,
    accesses: [{ kind: "read", address: 4, value: 0x23 }],
    outcome: "executed",
  });
  assert.equal(ram.read(0x1300), 0);
  assert.deepEqual(cpu.step(), {
    instruction: { address: 5, bytes: [0x77] },
    before: afterIncrement,
    after: afterStore,
    accesses: [
      { kind: "read", address: 5, value: 0x77 },
      { kind: "write", address: 0x1300, value: 0xa5 },
    ],
    outcome: "executed",
  });
  assert.deepEqual(cpu.step(), {
    instruction: { address: 6, bytes: [0x76] },
    before: afterStore,
    after: afterHalt,
    accesses: [{ kind: "read", address: 6, value: 0x76 }],
    outcome: "halted",
  });
  assert.deepEqual(cpu.step(), {
    instruction: null, before: afterHalt, after: afterHalt, accesses: [], outcome: "halted",
  });
  assert.deepEqual(cpu.snapshot(), afterHalt);
  checkExampleMemory(ram, true);
});

test("8080 reset retains the copied byte while addressing lesson restart restores fresh state and RAM", () => {
  const first = create8080AddressingExample();
  const records = Array.from({ length: 5 }, () => first.cpu.step());
  const saved = structuredClone(records);
  const beforeReset = {
    ...expectedInitialState(), a: 0xa5, h: 0x13, l: 0, hl: 0x1300, pc: 7, halted: true,
  };
  const afterReset = { ...beforeReset, pc: 0, halted: false };
  assert.deepEqual(first.cpu.reset(), { before: beforeReset, after: afterReset, accesses: [] });
  assert.deepEqual(first.cpu.snapshot(), afterReset);
  checkExampleMemory(first.ram, true);
  const resumed = first.cpu.step();
  assert.deepEqual(resumed.before, afterReset);
  assert.deepEqual(resumed.after, { ...afterReset, h: 0x12, l: 0xff, hl: 0x12ff, pc: 3 });
  first.ram.write(0x12ff, 0x5a);
  assert.equal(first.cpu.step().after.a, 0x5a);

  const restarted = create8080AddressingExample();
  assert.notEqual(restarted.cpu, first.cpu);
  assert.notEqual(restarted.ram, first.ram);
  assert.deepEqual(restarted.cpu.snapshot(), expectedInitialState());
  checkExampleMemory(restarted.ram, false);
  restarted.cpu.step();
  restarted.ram.write(0x1300, 0xff);
  assert.deepEqual(first.cpu.snapshot(), { ...resumed.after, a: 0x5a, pc: 4 });
  assert.equal(first.ram.read(0x12ff), 0x5a);
  assert.equal(first.ram.read(0x1300), 0xa5);
  assert.deepEqual(records, saved);
});
