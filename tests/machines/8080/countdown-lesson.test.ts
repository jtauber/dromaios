import assert from "node:assert/strict";
import { test } from "node:test";
import { create8080CountdownLesson } from "../../../src/machines/generated/8080/countdown-lesson.js";

const initial = {
  a: 0, b: 0, c: 0, d: 0, e: 0, h: 0, l: 0, pc: 0x100, sp: 0,
  bc: 0, de: 0, hl: 0,
  flags: { s: false, z: false, ac: false, p: false, cy: false },
  interruptEnabled: false, interruptDeferred: false, halted: false,
};
const program = [0x3a, 3, 0, 0xd6, 1, 0x32, 4, 0, 0xc2, 3, 1];

test("the countdown starts at three with clear flags and a boundary after JNZ", () => {
  const { cpu, ram, endAddress } = create8080CountdownLesson();
  assert.deepEqual(cpu.snapshot(), initial);
  assert.equal(endAddress, 0x10b);
  const expected = new Uint8Array(0x10000);
  expected[3] = 3;
  expected.set(program, 0x100);
  assert.equal(ram.size, expected.length);
  for (const [address, value] of expected.entries()) assert.equal(ram.read(address), value, `address ${address}`);
});

test("the countdown records ten instructions, storing 2, 1, and 0 before falling through", () => {
  const { cpu, ram, endAddress } = create8080CountdownLesson();
  const load = cpu.step();
  const savedLoad = structuredClone(load);
  assert.deepEqual(load, {
    instruction: { address: 0x100, bytes: [0x3a, 3, 0] },
    before: initial, after: { ...initial, a: 3, pc: 0x103 }, outcome: "executed",
    accesses: [
      { kind: "read", address: 0x100, value: 0x3a },
      { kind: "read", address: 0x101, value: 3 },
      { kind: "read", address: 0x102, value: 0 },
      { kind: "read", address: 3, value: 3 },
    ],
  });
  const path = [0x100, load.after.pc];
  let previous = load.after;
  let storedValue = 0;
  for (const result of [2, 1, 0]) {
    const subtracted = {
      ...previous, a: result, pc: 0x105,
      flags: { s: false, z: result === 0, ac: true, p: result === 0, cy: false },
    };
    assert.deepEqual(cpu.step(), {
      instruction: { address: 0x103, bytes: [0xd6, 1] },
      before: previous, after: subtracted, outcome: "executed",
      accesses: [{ kind: "read", address: 0x103, value: 0xd6 }, { kind: "read", address: 0x104, value: 1 }],
    });
    assert.equal(ram.read(4), storedValue);
    const stored = { ...subtracted, pc: 0x108 };
    assert.deepEqual(cpu.step(), {
      instruction: { address: 0x105, bytes: [0x32, 4, 0] },
      before: subtracted, after: stored, outcome: "executed",
      accesses: [
        { kind: "read", address: 0x105, value: 0x32 },
        { kind: "read", address: 0x106, value: 4 },
        { kind: "read", address: 0x107, value: 0 },
        { kind: "write", address: 4, value: result },
      ],
    });
    previous = { ...stored, pc: result === 0 ? endAddress : 0x103 };
    assert.deepEqual(cpu.step(), {
      instruction: { address: 0x108, bytes: [0xc2, 3, 1] },
      before: stored, after: previous, outcome: "executed",
      accesses: [
        { kind: "read", address: 0x108, value: 0xc2 },
        { kind: "read", address: 0x109, value: 3 },
        { kind: "read", address: 0x10a, value: 1 },
      ],
    });
    path.push(0x105, 0x108, previous.pc);
    storedValue = result;
    assert.deepEqual([ram.read(3), ram.read(4)], [3, result]);
  }
  assert.deepEqual(path, [0x100, 0x103, 0x105, 0x108, 0x103, 0x105, 0x108, 0x103, 0x105, 0x108, 0x10b]);
  assert.deepEqual(load, savedLoad);
  assert.deepEqual(Array.from({ length: program.length }, (_, offset) => ram.read(0x100 + offset)), program);
  assert.equal(cpu.snapshot().halted, false);
});

test("the starting byte determines the countdown, including zero's wraparound, independently of later memory edits", () => {
  for (const source of [0, 1, 2, 5, 16, 128, 255]) {
    const { cpu, ram, endAddress } = create8080CountdownLesson();
    ram.write(3, source);
    const load = cpu.step();
    assert.equal(load.after.a, source);
    assert.deepEqual(load.after.flags, initial.flags); // Even loading zero preserves Z = 0.
    ram.write(3, 99);
    const trips = source || 256;
    for (let iteration = 0; iteration < trips; iteration++) {
      const value = (source - iteration + 256) % 256;
      const result = (value + 255) % 256;
      assert.deepEqual([cpu.snapshot().a, cpu.snapshot().pc], [value, 0x103]);
      const subtract = cpu.step();
      assert.equal(subtract.after.a, result);
      assert.deepEqual(subtract.after.flags, {
        s: result >= 128, z: result === 0, ac: value % 16 !== 0,
        p: [...result.toString(2)].filter(bit => bit === "1").length % 2 === 0, cy: value === 0,
      });
      const store = cpu.step();
      assert.deepEqual(store.after, { ...subtract.after, pc: 0x108 });
      assert.equal(ram.read(4), result);
      ram.write(4, result === 0 ? 99 : 0); // Memory contradicts Z; JNZ must still follow the flag.
      const jump = cpu.step();
      assert.deepEqual(jump.after, { ...store.after, pc: iteration === trips - 1 ? endAddress : 0x103 });
      assert.deepEqual([ram.read(3), ram.read(4)], [99, result === 0 ? 99 : 0]);
    }
    assert.deepEqual([cpu.snapshot().pc, cpu.snapshot().a, cpu.snapshot().flags.z], [endAddress, 0, true]);
  }
});

test("a fresh countdown restores three and clears Z without rewriting the completed run", () => {
  const first = create8080CountdownLesson();
  first.ram.write(3, 1);
  const records = Array.from({ length: 4 }, () => first.cpu.step());
  const saved = structuredClone(records);
  assert.deepEqual([first.cpu.snapshot().pc, first.cpu.snapshot().flags.z], [first.endAddress, true]);
  const fresh = create8080CountdownLesson();
  assert.notEqual(fresh.cpu, first.cpu);
  assert.notEqual(fresh.ram, first.ram);
  assert.deepEqual(fresh.cpu.snapshot(), initial);
  assert.deepEqual([fresh.ram.read(3), fresh.ram.read(4)], [3, 0]);
  Array.from({ length: 4 }, () => fresh.cpu.step());
  assert.deepEqual([fresh.cpu.snapshot().pc, fresh.cpu.snapshot().a], [0x103, 2]);
  assert.deepEqual(records, saved);
  assert.deepEqual(first.cpu.snapshot(), saved[3]!.after);
});
