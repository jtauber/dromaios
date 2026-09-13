import assert from "node:assert/strict";
import { test } from "node:test";
import type { Ram } from "../../../src/components/memory/ram.js";
import { create8080Example, create8080ExampleMemory } from "../../../src/machines/generated/8080/example.js";

function expectedInitialState() {
  return {
    a: 0, b: 0, c: 0, d: 0, e: 0, h: 0, l: 0,
    pc: 0, sp: 0, bc: 0, de: 0, hl: 0,
    flags: { s: false, z: false, ac: false, p: false, cy: false },
    interruptEnabled: false,
    halted: false,
  };
}

function checkExampleMemory(ram: Ram, result: number): void {
  // Literal bytes and addresses from the specification, independent of the loader.
  const expected = new Uint8Array(65_536);
  expected.set([0x3e, 0x02, 0xc6, 0x03, 0x32, 0x80, 0x00, 0x76], 0x0000);
  expected[0x0080] = result;
  assert.equal(ram.size, expected.length);
  for (const [address, value] of expected.entries()) {
    assert.equal(ram.read(address), value, `memory at ${address}`);
  }
}

test("the 8080 example loads exactly the specified program into 64 KiB of zeroed RAM", () => {
  const ram = create8080ExampleMemory();
  checkExampleMemory(ram, 0);
});

test("each 8080 setup creates independent memory with the original program and zero result", () => {
  const first = create8080ExampleMemory();
  first.write(0x0000, 0);
  first.write(0x0080, 5);
  first.write(0xffff, 0xff);

  const second = create8080ExampleMemory();
  assert.equal(second.read(0x0000), 0x3e);
  assert.equal(second.read(0x0080), 0);
  assert.equal(second.read(0xffff), 0);
  assert.equal(first.read(0x0000), 0);
  assert.equal(first.read(0x0080), 5);
  assert.equal(first.read(0xffff), 0xff);

  second.write(0x0080, 9);
  assert.equal(first.read(0x0080), 5);
});

test("the 8080 example loads, adds, stores 5, and halts with the specified records", () => {
  const { cpu, ram } = create8080Example();
  const before = expectedInitialState();
  const afterLoad = { ...before, a: 2, pc: 2 };
  const afterAdd = { ...before, a: 5, pc: 4, flags: { ...before.flags, p: true } };
  const afterStore = { ...afterAdd, pc: 7 };
  const afterHalt = { ...afterStore, pc: 8, halted: true };
  assert.deepEqual(cpu.snapshot(), before);
  assert.deepEqual(cpu.step(), {
    instruction: { address: 0, bytes: [0x3e, 0x02] },
    before,
    after: afterLoad,
    accesses: [
      { kind: "read", address: 0, value: 0x3e },
      { kind: "read", address: 1, value: 0x02 },
    ],
    outcome: "executed",
  });
  assert.deepEqual(cpu.step(), {
    instruction: { address: 2, bytes: [0xc6, 0x03] },
    before: afterLoad,
    after: afterAdd,
    accesses: [
      { kind: "read", address: 2, value: 0xc6 },
      { kind: "read", address: 3, value: 0x03 },
    ],
    outcome: "executed",
  });
  assert.equal(ram.read(0x0080), 0);
  assert.deepEqual(cpu.step(), {
    instruction: { address: 4, bytes: [0x32, 0x80, 0x00] },
    before: afterAdd,
    after: afterStore,
    accesses: [
      { kind: "read", address: 4, value: 0x32 },
      { kind: "read", address: 5, value: 0x80 },
      { kind: "read", address: 6, value: 0x00 },
      { kind: "write", address: 0x0080, value: 5 },
    ],
    outcome: "executed",
  });
  assert.equal(ram.read(0x0080), 5);
  assert.deepEqual(cpu.step(), {
    instruction: { address: 7, bytes: [0x76] },
    before: afterStore,
    after: afterHalt,
    accesses: [{ kind: "read", address: 7, value: 0x76 }],
    outcome: "halted",
  });
  assert.deepEqual(cpu.snapshot(), afterHalt);
  assert.deepEqual(cpu.step(), {
    instruction: null,
    before: afterHalt,
    after: afterHalt,
    accesses: [],
    outcome: "halted",
  });
  assert.deepEqual(cpu.snapshot(), afterHalt);
  checkExampleMemory(ram, 5);
});

test("8080 lesson restart creates fresh CPU state and memory while reset preserves data", () => {
  const first = create8080Example();
  const record = first.cpu.step();
  const savedRecord = structuredClone(record);
  const additionRecord = first.cpu.step();
  const savedAdditionRecord = structuredClone(additionRecord);
  const storeRecord = first.cpu.step();
  const savedStoreRecord = structuredClone(storeRecord);
  const haltRecord = first.cpu.step();
  const savedHaltRecord = structuredClone(haltRecord);
  assert.equal(first.cpu.snapshot().halted, true);
  first.ram.write(0, 0);
  first.cpu.reset();
  const afterReset = {
    ...expectedInitialState(), a: 5,
    flags: { s: false, z: false, ac: false, p: true, cy: false },
  };
  assert.deepEqual(first.cpu.snapshot(), afterReset);
  assert.equal(first.ram.read(0), 0);
  assert.equal(first.ram.read(0x0080), 5);

  const restarted = create8080Example();
  assert.deepEqual(restarted.cpu.snapshot(), expectedInitialState());
  checkExampleMemory(restarted.ram, 0);
  assert.deepEqual(record, savedRecord);
  assert.deepEqual(additionRecord, savedAdditionRecord);
  assert.deepEqual(storeRecord, savedStoreRecord);
  assert.deepEqual(haltRecord, savedHaltRecord);
  restarted.cpu.step();
  restarted.ram.write(0x0080, 9);
  assert.deepEqual(first.cpu.snapshot(), afterReset);
  assert.equal(first.ram.read(0x0080), 5);
  assert.deepEqual(record, savedRecord);
  assert.deepEqual(additionRecord, savedAdditionRecord);
  assert.deepEqual(storeRecord, savedStoreRecord);
  assert.deepEqual(haltRecord, savedHaltRecord);
});
