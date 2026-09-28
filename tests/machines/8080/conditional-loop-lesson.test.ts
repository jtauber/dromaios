import assert from "node:assert/strict";
import { test } from "node:test";
import { create8080ConditionalLoopLesson } from "../../../src/machines/generated/8080/conditional-loop-lesson.js";

const initial = {
  a: 0, b: 0, c: 0, d: 0, e: 0, h: 0, l: 0, pc: 0x100, sp: 0,
  bc: 0, de: 0, hl: 0,
  flags: { s: false, z: false, ac: false, p: false, cy: false },
  interruptEnabled: false, interruptDeferred: false, halted: false,
};
const program = [0x3a, 3, 0, 0xc6, 1, 0x32, 4, 0, 0xd2, 3, 1];

test("the conditional loop initializes 254 and a completion boundary after JNC", () => {
  const { cpu, ram, endAddress } = create8080ConditionalLoopLesson();
  assert.deepEqual(cpu.snapshot(), initial);
  assert.equal(endAddress, 0x10b);
  const expected = new Uint8Array(0x10000);
  expected[3] = 254;
  expected.set(program, 0x100);
  assert.equal(ram.size, expected.length);
  for (const [address, value] of expected.entries()) assert.equal(ram.read(address), value, `address ${address}`);
});

test("the default conditional loop takes one jump then falls through, fetching JNC on both paths", () => {
  const { cpu, ram, endAddress } = create8080ConditionalLoopLesson();
  const loaded = { ...initial, a: 254, pc: 0x103 };
  const added = {
    ...loaded, a: 255, pc: 0x105,
    flags: { s: true, z: false, ac: false, p: true, cy: false },
  };
  const stored = { ...added, pc: 0x108 };
  const returned = { ...stored, pc: 0x103 };
  const wrapped = {
    ...returned, a: 0, pc: 0x105,
    flags: { s: false, z: true, ac: true, p: true, cy: true },
  };
  const storedZero = { ...wrapped, pc: 0x108 };
  const completed = { ...storedZero, pc: endAddress };
  const states = [initial, loaded, added, stored, returned, wrapped, storedZero, completed];
  const expectedSteps = [
    { address: 0x100, bytes: [0x3a, 3, 0], data: [{ kind: "read", address: 3, value: 254 }], destination: 0 },
    { address: 0x103, bytes: [0xc6, 1], data: [], destination: 0 },
    { address: 0x105, bytes: [0x32, 4, 0], data: [{ kind: "write", address: 4, value: 255 }], destination: 255 },
    { address: 0x108, bytes: [0xd2, 3, 1], data: [], destination: 255 },
    { address: 0x103, bytes: [0xc6, 1], data: [], destination: 255 },
    { address: 0x105, bytes: [0x32, 4, 0], data: [{ kind: "write", address: 4, value: 0 }], destination: 0 },
    { address: 0x108, bytes: [0xd2, 3, 1], data: [], destination: 0 },
  ];
  const records = expectedSteps.map(({ address, bytes, data, destination }, index) => {
    const record = cpu.step();
    assert.deepEqual(record, {
      instruction: { address, bytes }, before: states[index], after: states[index + 1], outcome: "executed",
      accesses: [...bytes.map((value, offset) => ({ kind: "read", address: address + offset, value })), ...data],
    });
    assert.deepEqual([ram.read(3), ram.read(4)], [254, destination]);
    return record;
  });
  assert.deepEqual(records.map(record => record.after.pc), [0x103, 0x105, 0x108, 0x103, 0x105, 0x108, 0x10b]);
  assert.deepEqual(records[0]!.after, loaded); // Later steps have not rewritten earlier snapshots.
  assert.deepEqual(Array.from({ length: program.length }, (_, offset) => ram.read(0x100 + offset)), program);
  assert.equal(cpu.snapshot().halted, false);
});

test("starting bytes control the trip count, while later memory edits cannot change the carry decision", () => {
  for (const source of [0, 127, 253, 254, 255]) {
    const { cpu, ram, endAddress } = create8080ConditionalLoopLesson();
    ram.write(3, source);
    cpu.step();
    ram.write(3, 99); // The load never runs again.
    for (let value = source; value <= 255; value++) {
      assert.deepEqual([cpu.snapshot().a, cpu.snapshot().pc], [value, 0x103]);
      const add = cpu.step();
      assert.deepEqual([add.after.a, add.after.flags.cy], [(value + 1) % 256, value === 255]);
      const store = cpu.step();
      assert.deepEqual(store.after, { ...add.after, pc: 0x108 });
      assert.equal(ram.read(4), add.after.a);
      ram.write(4, 77); // JNC tests the flag, not the stored result.
      const jump = cpu.step();
      assert.deepEqual(jump.after, { ...store.after, pc: value === 255 ? endAddress : 0x103 });
      assert.deepEqual([ram.read(3), ram.read(4)], [99, 77]);
    }
    assert.deepEqual([cpu.snapshot().pc, cpu.snapshot().a, cpu.snapshot().flags.cy], [endAddress, 0, true]);
  }
});

test("a fresh conditional loop restores its data and clear flags after completion", () => {
  const first = create8080ConditionalLoopLesson();
  first.ram.write(3, 255);
  const records = Array.from({ length: 4 }, () => first.cpu.step());
  const saved = structuredClone(records);
  assert.equal(first.cpu.snapshot().pc, first.endAddress);
  const fresh = create8080ConditionalLoopLesson();
  assert.notEqual(fresh.cpu, first.cpu);
  assert.notEqual(fresh.ram, first.ram);
  assert.deepEqual(fresh.cpu.snapshot(), initial);
  assert.deepEqual([fresh.ram.read(3), fresh.ram.read(4)], [254, 0]);
  Array.from({ length: 4 }, () => fresh.cpu.step());
  assert.equal(fresh.cpu.snapshot().pc, 0x103);
  assert.deepEqual(records, saved);
  assert.deepEqual(first.cpu.snapshot(), saved[3]!.after);
});
