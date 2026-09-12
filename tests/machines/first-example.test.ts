import assert from "node:assert/strict";
import { test } from "node:test";
import { createFirstExample, createFirstExampleMemory } from "../../src/machines/first-example.js";

function expectedInitialState() {
  return {
    a: 0, b: 0, c: 0, d: 0, e: 0, h: 0, l: 0,
    pc: 0, sp: 0,
    flags: { s: false, z: false, ac: false, p: false, cy: false },
    interruptEnabled: false,
    halted: false,
  };
}

test("the first example loads exactly the specified program into 64 KiB of zeroed RAM", () => {
  const ram = createFirstExampleMemory();
  // Expected bytes are stated independently of the loader, from the specification.
  const expectedProgram = [0x3e, 0x02, 0xc6, 0x03, 0x32, 0x80, 0x00, 0x76];
  assert.equal(ram.size, 65_536);
  for (const [address, value] of expectedProgram.entries()) {
    assert.equal(ram.read(address), value, `program byte at ${address}`);
  }
  for (let address = expectedProgram.length; address < ram.size; address++) {
    assert.equal(ram.read(address), 0, `zero byte at ${address}`);
  }
});

test("each setup creates independent memory with the original program and zero result", () => {
  const first = createFirstExampleMemory();
  first.write(0x0000, 0);
  first.write(0x0080, 5);
  first.write(0xffff, 0xff);

  const second = createFirstExampleMemory();
  assert.equal(second.read(0x0000), 0x3e);
  assert.equal(second.read(0x0080), 0);
  assert.equal(second.read(0xffff), 0);
  assert.equal(first.read(0x0000), 0);
  assert.equal(first.read(0x0080), 5);
  assert.equal(first.read(0xffff), 0xff);

  second.write(0x0080, 9);
  assert.equal(first.read(0x0080), 5);
});

test("the first example loads, adds, and stores 5, then reports HLT as unsupported", () => {
  const { cpu, ram } = createFirstExample();
  const before = expectedInitialState();
  const afterLoad = { ...before, a: 2, pc: 2 };
  const afterAdd = { ...before, a: 5, pc: 4, flags: { ...before.flags, p: true } };
  const afterStore = { ...afterAdd, pc: 7 };
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
    after: afterStore,
    accesses: [{ kind: "read", address: 7, value: 0x76 }],
    outcome: "unsupported",
  });
  assert.deepEqual(cpu.snapshot(), afterStore);
  const expectedMemory = createFirstExampleMemory();
  expectedMemory.write(0x0080, 5);
  for (let address = 0; address < ram.size; address++) {
    assert.equal(ram.read(address), expectedMemory.read(address));
  }
});

test("lesson restart creates fresh CPU state and memory while reset preserves data", () => {
  const first = createFirstExample();
  const record = first.cpu.step();
  const savedRecord = structuredClone(record);
  const additionRecord = first.cpu.step();
  const savedAdditionRecord = structuredClone(additionRecord);
  const storeRecord = first.cpu.step();
  const savedStoreRecord = structuredClone(storeRecord);
  first.ram.write(0, 0);
  first.cpu.reset();
  const afterReset = {
    ...expectedInitialState(), a: 5,
    flags: { s: false, z: false, ac: false, p: true, cy: false },
  };
  assert.deepEqual(first.cpu.snapshot(), afterReset);
  assert.equal(first.ram.read(0), 0);
  assert.equal(first.ram.read(0x0080), 5);

  const restarted = createFirstExample();
  assert.deepEqual(restarted.cpu.snapshot(), expectedInitialState());
  assert.equal(restarted.ram.read(0), 0x3e);
  assert.equal(restarted.ram.read(0x0080), 0);
  assert.deepEqual(record, savedRecord);
  assert.deepEqual(additionRecord, savedAdditionRecord);
  assert.deepEqual(storeRecord, savedStoreRecord);
  restarted.cpu.step();
  restarted.ram.write(0x0080, 9);
  assert.deepEqual(first.cpu.snapshot(), afterReset);
  assert.equal(first.ram.read(0x0080), 5);
  assert.deepEqual(record, savedRecord);
  assert.deepEqual(additionRecord, savedAdditionRecord);
  assert.deepEqual(storeRecord, savedStoreRecord);
});
