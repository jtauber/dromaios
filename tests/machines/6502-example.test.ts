import assert from "node:assert/strict";
import { test } from "node:test";
import type { Ram } from "../../src/components/memory/ram.js";
import { create6502Example } from "../../src/machines/6502-example.js";

function expectedInitialState() {
  return {
    a: 0, x: 0, y: 0, sp: 0xff, pc: 0x0200,
    flags: { n: false, v: false, d: false, i: true, z: false, c: true },
  };
}

function checkInitialMemory(ram: Ram): void {
  // Literal bytes and addresses from the specification, independent of the loader.
  const expected = new Uint8Array(65_536);
  expected.set([0x18, 0xa9, 0x02, 0x69, 0x03, 0x8d, 0x80, 0x00], 0x0200);
  expected[0xfffc] = 0x00;
  expected[0xfffd] = 0x02;
  assert.equal(ram.size, expected.length);
  for (const [address, value] of expected.entries()) {
    assert.equal(ram.read(address), value, `memory at ${address}`);
  }
}

test("the 6502 example creates the full image, vector, initial state, and completion address", () => {
  const { cpu, ram, endAddress } = create6502Example();
  assert.deepEqual(cpu.snapshot(), expectedInitialState());
  assert.equal(endAddress, 0x0208);
  checkInitialMemory(ram);
});

test("the 6502 example executes CLC then LDA from its entry point and stops at unsupported ADC", () => {
  const { cpu, ram } = create6502Example();
  const before = expectedInitialState();
  const afterClear = { ...before, pc: 0x0201, flags: { ...before.flags, c: false } };
  const afterLoad = { ...afterClear, a: 2, pc: 0x0203 };
  assert.deepEqual(cpu.step(), {
    instruction: { address: 0x0200, bytes: [0x18] },
    before,
    after: afterClear,
    accesses: [{ kind: "read", address: 0x0200, value: 0x18 }],
    outcome: "executed",
  });
  assert.deepEqual(cpu.step(), {
    instruction: { address: 0x0201, bytes: [0xa9, 0x02] },
    before: afterClear,
    after: afterLoad,
    accesses: [
      { kind: "read", address: 0x0201, value: 0xa9 },
      { kind: "read", address: 0x0202, value: 0x02 },
    ],
    outcome: "executed",
  });
  assert.deepEqual(cpu.step(), {
    instruction: { address: 0x0203, bytes: [0x69] },
    before: afterLoad,
    after: afterLoad,
    accesses: [{ kind: "read", address: 0x0203, value: 0x69 }],
    outcome: "unsupported",
    reason: "opcode",
  });
  assert.deepEqual(cpu.snapshot(), afterLoad);
  checkInitialMemory(ram);
});

test("6502 lesson restart restores independent state and the entire original memory image", () => {
  const first = create6502Example();
  const record = first.cpu.step();
  const savedRecord = structuredClone(record);
  const loadRecord = first.cpu.step();
  const savedLoadRecord = structuredClone(loadRecord);
  const changedState = first.cpu.snapshot();
  assert.equal(changedState.a, 2);
  assert.equal(changedState.pc, 0x0203);
  assert.equal(changedState.flags.c, false);
  first.ram.write(0x0200, 0);
  first.ram.write(0x0201, 0xff);
  first.ram.write(0x0080, 5);
  first.ram.write(0xfffd, 0xff);
  first.ram.write(0xffff, 0xff);

  const restarted = create6502Example();
  assert.notEqual(restarted.cpu, first.cpu);
  assert.notEqual(restarted.ram, first.ram);
  assert.deepEqual(restarted.cpu.snapshot(), expectedInitialState());
  assert.equal(restarted.endAddress, 0x0208);
  checkInitialMemory(restarted.ram);
  restarted.ram.write(0x0080, 9);
  assert.equal(first.ram.read(0x0080), 5);
  assert.equal(first.ram.read(0xfffd), 0xff);
  assert.deepEqual(first.cpu.snapshot(), changedState);
  assert.deepEqual(record, savedRecord);
  assert.deepEqual(loadRecord, savedLoadRecord);
});
