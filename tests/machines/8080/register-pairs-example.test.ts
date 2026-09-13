import assert from "node:assert/strict";
import { test } from "node:test";
import type { Ram } from "../../../src/components/memory/ram.js";
import {
  create8080RegisterPairsExample,
  create8080RegisterPairsExampleMemory,
} from "../../../src/machines/generated/8080/register-pairs-example.js";

function expectedInitialState() {
  return {
    a: 0x11, b: 0x22, c: 0x33, d: 0x44, e: 0x55, h: 0x66, l: 0x77,
    bc: 0x2233, de: 0x4455, hl: 0x6677, pc: 0, sp: 0xabcd,
    flags: { s: true, z: false, ac: true, p: false, cy: true },
    interruptEnabled: false,
    halted: false,
  };
}

function checkExampleMemory(ram: Ram): void {
  // Literal bytes and addresses from the specification, independent of the loader.
  const expected = new Uint8Array(65_536);
  expected.set([0x21, 0xff, 0x12, 0x23, 0x76], 0x0000);
  assert.equal(ram.size, expected.length);
  for (const [address, value] of expected.entries()) {
    assert.equal(ram.read(address), value, `memory at ${address}`);
  }
}

test("the 8080 register-pair example loads exactly its five-byte program into zeroed RAM", () => {
  const first = create8080RegisterPairsExampleMemory();
  checkExampleMemory(first);
  first.write(0, 0);
  first.write(0xffff, 0xff);
  const second = create8080RegisterPairsExampleMemory();
  checkExampleMemory(second);
  assert.notEqual(first, second);
  assert.equal(first.read(0), 0);
  assert.equal(first.read(0xffff), 0xff);
});

test("the 8080 register-pair lesson shows HL changing from 12FF to 1300 and then halts", () => {
  const { cpu, ram } = create8080RegisterPairsExample();
  const before = expectedInitialState();
  const afterLoad = { ...before, h: 0x12, l: 0xff, hl: 0x12ff, pc: 3 };
  const afterIncrement = { ...afterLoad, h: 0x13, l: 0x00, hl: 0x1300, pc: 4 };
  const afterHalt = { ...afterIncrement, pc: 5, halted: true };
  assert.deepEqual(cpu.snapshot(), before);
  assert.deepEqual(cpu.step(), {
    instruction: { address: 0, bytes: [0x21, 0xff, 0x12] },
    before,
    after: afterLoad,
    accesses: [
      { kind: "read", address: 0, value: 0x21 },
      { kind: "read", address: 1, value: 0xff },
      { kind: "read", address: 2, value: 0x12 },
    ],
    outcome: "executed",
  });
  assert.deepEqual(cpu.step(), {
    instruction: { address: 3, bytes: [0x23] },
    before: afterLoad,
    after: afterIncrement,
    accesses: [{ kind: "read", address: 3, value: 0x23 }],
    outcome: "executed",
  });
  assert.deepEqual(cpu.step(), {
    instruction: { address: 4, bytes: [0x76] },
    before: afterIncrement,
    after: afterHalt,
    accesses: [{ kind: "read", address: 4, value: 0x76 }],
    outcome: "halted",
  });
  assert.deepEqual(cpu.step(), {
    instruction: null, before: afterHalt, after: afterHalt, accesses: [], outcome: "halted",
  });
  assert.deepEqual(cpu.snapshot(), afterHalt);
  checkExampleMemory(ram);
});

test("8080 register-pair reset preserves data; lesson restart restores independent components", () => {
  const first = create8080RegisterPairsExample();
  const records = [first.cpu.step(), first.cpu.step(), first.cpu.step()];
  const saved = structuredClone(records);
  const beforeReset = {
    ...expectedInitialState(), h: 0x13, l: 0, hl: 0x1300, pc: 5, halted: true,
  };
  first.ram.write(0, 0);
  first.ram.write(0x0080, 0xa5);
  const reset = first.cpu.reset();
  const afterReset = { ...beforeReset, pc: 0, halted: false };
  assert.deepEqual(reset, { before: beforeReset, after: afterReset, accesses: [] });
  assert.deepEqual(first.cpu.snapshot(), afterReset);
  assert.equal(first.ram.read(0), 0);
  assert.equal(first.ram.read(0x0080), 0xa5);
  assert.equal(first.cpu.step().outcome, "unsupported");

  const restarted = create8080RegisterPairsExample();
  assert.notEqual(restarted.cpu, first.cpu);
  assert.notEqual(restarted.ram, first.ram);
  assert.deepEqual(restarted.cpu.snapshot(), expectedInitialState());
  checkExampleMemory(restarted.ram);
  restarted.cpu.step();
  restarted.ram.write(0x0080, 0x5a);
  assert.deepEqual(first.cpu.snapshot(), afterReset);
  assert.equal(first.ram.read(0x0080), 0xa5);
  assert.deepEqual(records, saved);
});
