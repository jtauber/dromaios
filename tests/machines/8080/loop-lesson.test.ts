import assert from "node:assert/strict";
import { test } from "node:test";
import { create8080LoopLesson } from "../../../src/machines/generated/8080/loop-lesson.js";

const initial = {
  a: 0, b: 0, c: 0, d: 0, e: 0, h: 0, l: 0, pc: 0x100, sp: 0,
  bc: 0, de: 0, hl: 0,
  flags: { s: false, z: false, ac: false, p: false, cy: false },
  interruptEnabled: false, interruptDeferred: false, halted: false,
};
const program = [0x3a, 3, 0, 0xc6, 1, 0x32, 4, 0, 0xc3, 3, 1];

test("the loop lesson initializes the full machine without a completion address", () => {
  const machine = create8080LoopLesson();
  assert.deepEqual(machine.cpu.snapshot(), initial);
  assert.equal("endAddress" in machine, false);
  const expected = new Uint8Array(0x10000);
  expected[3] = 41;
  expected.set(program, 0x100);
  assert.equal(machine.ram.size, expected.length);
  for (const [address, value] of expected.entries()) assert.equal(machine.ram.read(address), value, `address ${address}`);
});

test("the loop loads once and repeats exact add/store/jump records through a full byte wrap", () => {
  const { cpu, ram } = create8080LoopLesson();
  const load = cpu.step();
  const savedLoad = structuredClone(load);
  assert.deepEqual(load, {
    instruction: { address: 0x100, bytes: [0x3a, 3, 0] },
    before: initial, after: { ...initial, a: 41, pc: 0x103 }, outcome: "executed",
    accesses: [
      { kind: "read", address: 0x100, value: 0x3a },
      { kind: "read", address: 0x101, value: 3 },
      { kind: "read", address: 0x102, value: 0 },
      { kind: "read", address: 3, value: 41 },
    ],
  });
  ram.write(3, 99); // Returning to the addition must not reload this changed source.
  let previousStored = 0;
  for (let iteration = 0; iteration < 258; iteration++) {
    const value = (41 + iteration) % 256;
    const result = (value + 1) % 256;
    const flags = {
      s: result >= 128, z: result === 0, ac: value % 16 === 15,
      p: [...result.toString(2)].filter(bit => bit === "1").length % 2 === 0,
      cy: value === 255,
    };
    const before = cpu.snapshot();
    assert.deepEqual([before.a, before.pc], [value, 0x103]);
    const added = { ...before, a: result, flags, pc: 0x105 };
    assert.deepEqual(cpu.step(), {
      instruction: { address: 0x103, bytes: [0xc6, 1] },
      before, after: added, outcome: "executed",
      accesses: [{ kind: "read", address: 0x103, value: 0xc6 }, { kind: "read", address: 0x104, value: 1 }],
    });
    assert.deepEqual([ram.read(3), ram.read(4)], [99, previousStored]);
    const stored = { ...added, pc: 0x108 };
    assert.deepEqual(cpu.step(), {
      instruction: { address: 0x105, bytes: [0x32, 4, 0] },
      before: added, after: stored, outcome: "executed",
      accesses: [
        { kind: "read", address: 0x105, value: 0x32 },
        { kind: "read", address: 0x106, value: 4 },
        { kind: "read", address: 0x107, value: 0 },
        { kind: "write", address: 4, value: result },
      ],
    });
    assert.deepEqual(cpu.step(), {
      instruction: { address: 0x108, bytes: [0xc3, 3, 1] },
      before: stored, after: { ...stored, pc: 0x103 }, outcome: "executed",
      accesses: [
        { kind: "read", address: 0x108, value: 0xc3 },
        { kind: "read", address: 0x109, value: 3 },
        { kind: "read", address: 0x10a, value: 1 },
      ],
    });
    assert.deepEqual([ram.read(3), ram.read(4)], [99, result]);
    previousStored = result;
  }
  assert.deepEqual(load, savedLoad);
  assert.deepEqual(Array.from({ length: program.length }, (_, offset) => ram.read(0x100 + offset)), program);
  assert.equal(cpu.snapshot().halted, false);
});

test("editing a stored result between iterations leaves A and the next calculation independent", () => {
  const { cpu, ram } = create8080LoopLesson();
  cpu.step(); cpu.step(); cpu.step(); // A and memory now contain 42.
  const before = cpu.snapshot();
  ram.write(4, 200);
  assert.deepEqual(cpu.snapshot(), before);
  cpu.step(); // The backward jump.
  assert.equal(ram.read(4), 200);
  assert.equal(cpu.step().after.a, 43);
  assert.equal(ram.read(4), 200);
  cpu.step();
  assert.deepEqual([cpu.snapshot().a, ram.read(3), ram.read(4)], [43, 41, 43]);
});

test("a fresh loop restores the load and clears carried state without altering the previous run", () => {
  const first = create8080LoopLesson();
  first.ram.write(3, 255);
  const records = Array.from({ length: 4 }, () => first.cpu.step());
  assert.deepEqual([first.cpu.snapshot().a, first.cpu.snapshot().flags.cy, first.cpu.snapshot().pc], [0, true, 0x103]);
  const fresh = create8080LoopLesson();
  assert.notEqual(fresh.cpu, first.cpu);
  assert.notEqual(fresh.ram, first.ram);
  assert.deepEqual(fresh.cpu.snapshot(), initial);
  assert.deepEqual([fresh.ram.read(3), fresh.ram.read(4)], [41, 0]);
  fresh.cpu.step();
  assert.equal(fresh.cpu.step().after.a, 42);
  assert.deepEqual(first.cpu.snapshot(), records[3]!.after);
});
