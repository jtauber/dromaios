import assert from "node:assert/strict";
import { test } from "node:test";
import { create8080AddOneLesson } from "../../../src/machines/generated/8080/add-one-lesson.js";

const initial = {
  a: 0, b: 0, c: 0, d: 0, e: 0, h: 0, l: 0, pc: 0x100, sp: 0,
  bc: 0, de: 0, hl: 0,
  flags: { s: false, z: false, ac: false, p: false, cy: false },
  interruptEnabled: false, interruptDeferred: false, halted: false,
};
const program = [0x3a, 0x03, 0x00, 0xc6, 0x01, 0x32, 0x04, 0x00];

test("the add-one lesson separates editable data from its load, add, and store program", () => {
  const { cpu, ram, endAddress } = create8080AddOneLesson();
  assert.deepEqual(cpu.snapshot(), initial);
  assert.equal(endAddress, 0x108);
  const expected = new Uint8Array(0x10000);
  expected[3] = 41;
  expected.set(program, 0x100);
  assert.equal(ram.size, expected.length);
  for (const [address, value] of expected.entries()) assert.equal(ram.read(address), value, `address ${address}`);
});

test("the default lesson loads 41, adds one inside A, then stores 42 with exact records", () => {
  const { cpu, ram, endAddress } = create8080AddOneLesson();
  const loaded = { ...initial, a: 41, pc: 0x103 };
  const added = { ...initial, a: 42, pc: 0x105 };
  const stored = { ...added, pc: endAddress };
  assert.deepEqual(cpu.step(), {
    instruction: { address: 0x100, bytes: [0x3a, 3, 0] },
    before: initial, after: loaded, outcome: "executed",
    accesses: [
      { kind: "read", address: 0x100, value: 0x3a },
      { kind: "read", address: 0x101, value: 3 },
      { kind: "read", address: 0x102, value: 0 },
      { kind: "read", address: 3, value: 41 },
    ],
  });
  assert.deepEqual(cpu.step(), {
    instruction: { address: 0x103, bytes: [0xc6, 1] },
    before: loaded, after: added, outcome: "executed",
    accesses: [
      { kind: "read", address: 0x103, value: 0xc6 },
      { kind: "read", address: 0x104, value: 1 },
    ],
  });
  assert.deepEqual([ram.read(3), ram.read(4)], [41, 0]);
  assert.deepEqual(cpu.step(), {
    instruction: { address: 0x105, bytes: [0x32, 4, 0] },
    before: added, after: stored, outcome: "executed",
    accesses: [
      { kind: "read", address: 0x105, value: 0x32 },
      { kind: "read", address: 0x106, value: 4 },
      { kind: "read", address: 0x107, value: 0 },
      { kind: "write", address: 4, value: 42 },
    ],
  });
  assert.deepEqual(Array.from({ length: 8 }, (_, address) => ram.read(address)), [0, 0, 0, 41, 42, 0, 0, 0]);
  assert.equal(cpu.snapshot().halted, false); // The lesson stops at endAddress without HLT.
});

test("all input bytes produce the expected arithmetic flags and preserve independent memory values", () => {
  for (let value = 0; value < 256; value++) {
    const { cpu, ram, endAddress } = create8080AddOneLesson();
    ram.write(3, value);
    const load = cpu.step();
    ram.write(3, 255 - value);
    ram.write(4, 99);
    const beforeAdd = cpu.snapshot();
    const add = cpu.step();
    const result = (value + 1) % 256;
    const flags = {
      s: result >= 128, z: result === 0, ac: value % 16 === 15,
      p: [...result.toString(2)].filter(bit => bit === "1").length % 2 === 0,
      cy: value === 255,
    };
    assert.deepEqual(beforeAdd, { ...initial, a: value, pc: 0x103 });
    assert.deepEqual(add.after, { ...initial, a: result, flags, pc: 0x105 }, `input ${value}`);
    assert.deepEqual([ram.read(3), ram.read(4)], [255 - value, 99]);
    const retained = structuredClone([load, add]);
    const store = cpu.step();
    assert.deepEqual(store.after, { ...add.after, pc: endAddress });
    assert.deepEqual([ram.read(3), ram.read(4)], [255 - value, result]);
    assert.deepEqual(Array.from({ length: program.length }, (_, offset) => ram.read(0x100 + offset)), program);
    ram.write(4, 77);
    assert.deepEqual(cpu.snapshot(), store.after);
    assert.deepEqual([load, add], retained);
  }
});

test("a fresh lesson clears carry and restores the original setup without changing prior records", () => {
  const first = create8080AddOneLesson();
  first.ram.write(3, 255);
  first.cpu.step();
  const addition = first.cpu.step();
  first.cpu.step();
  assert.equal(first.cpu.snapshot().flags.cy, true);
  assert.equal(first.cpu.snapshot().a, 0);
  const retained = structuredClone(addition);
  const fresh = create8080AddOneLesson();
  assert.notEqual(fresh.cpu, first.cpu);
  assert.notEqual(fresh.ram, first.ram);
  assert.deepEqual(fresh.cpu.snapshot(), initial);
  assert.deepEqual([fresh.ram.read(3), fresh.ram.read(4)], [41, 0]);
  fresh.cpu.step();
  fresh.cpu.step();
  assert.deepEqual([fresh.cpu.snapshot().a, fresh.cpu.snapshot().flags.cy], [42, false]);
  assert.deepEqual(addition, retained);
  assert.equal(first.cpu.snapshot().flags.cy, true);
});

test("editing the immediate operand changes the calculation without changing the instruction path", () => {
  const cases = [
    [0, 41, false], [2, 43, false], [10, 51, false],
    [214, 255, false], [215, 0, true], [255, 40, true],
  ] as const;
  for (const [operand, result, carry] of cases) {
    const { cpu, ram, endAddress } = create8080AddOneLesson();
    ram.write(0x104, operand);
    assert.deepEqual(cpu.snapshot(), initial);
    const load = cpu.step(), add = cpu.step(), store = cpu.step();
    assert.deepEqual([load.after.pc, add.after.pc, store.after.pc], [0x103, 0x105, endAddress]);
    assert.deepEqual(add.instruction, { address: 0x103, bytes: [0xc6, operand] });
    assert.deepEqual(add.accesses, [
      { kind: "read", address: 0x103, value: 0xc6 },
      { kind: "read", address: 0x104, value: operand },
    ]);
    assert.deepEqual([load.after.a, add.after.a, store.after.a, store.after.flags.cy], [41, result, result, carry]);
    assert.deepEqual([ram.read(3), ram.read(4)], [41, result]);
    assert.deepEqual(Array.from({ length: program.length }, (_, offset) => ram.read(0x100 + offset)),
      [0x3a, 3, 0, 0xc6, operand, 0x32, 4, 0]);
    assert.equal(create8080AddOneLesson().ram.read(0x104), 1);
  }
});
