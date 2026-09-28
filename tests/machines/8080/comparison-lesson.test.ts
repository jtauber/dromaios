import assert from "node:assert/strict";
import { test } from "node:test";
import { create8080ComparisonLesson } from "../../../src/machines/generated/8080/comparison-lesson.js";

const initial = {
  a: 0, b: 0, c: 0, d: 0, e: 0, h: 0, l: 0, pc: 0x100, sp: 0,
  bc: 0, de: 0, hl: 0,
  flags: { s: false, z: false, ac: false, p: false, cy: false },
  interruptEnabled: false, interruptDeferred: false, halted: false,
};
const program = [0x3a, 3, 0, 0xc6, 1, 0x32, 4, 0, 0xfe, 44, 0xc2, 3, 1];

test("the comparison lesson starts at 41 with target 44 and a boundary after JNZ", () => {
  const { cpu, ram, endAddress } = create8080ComparisonLesson();
  assert.deepEqual(cpu.snapshot(), initial);
  assert.equal(endAddress, 0x10d);
  const expected = new Uint8Array(0x10000);
  expected[3] = 41;
  expected.set(program, 0x100);
  assert.equal(ram.size, expected.length);
  for (const [address, value] of expected.entries()) assert.equal(ram.read(address), value, `address ${address}`);
});

test("thirteen recorded instructions store 42, 43, and 44; comparison changes flags but preserves A", () => {
  const { cpu, ram, endAddress } = create8080ComparisonLesson();
  let previous = initial;
  const path = [initial.pc];
  const records: ReturnType<typeof cpu.step>[] = [];
  function checkStep(bytes: number[], after: typeof initial, data: { kind: "read" | "write"; address: number; value: number }[] = []) {
    const record = cpu.step();
    assert.deepEqual(record, {
      instruction: { address: previous.pc, bytes },
      before: previous, after, outcome: "executed",
      accesses: [...bytes.map((value, offset) => ({ kind: "read", address: previous.pc + offset, value })), ...data],
    });
    records.push(record);
    previous = after;
    path.push(after.pc);
  }
  checkStep([0x3a, 3, 0], { ...initial, a: 41, pc: 0x103 }, [{ kind: "read", address: 3, value: 41 }]);
  const load = structuredClone(records[0]);
  let destination = 0;
  // Independent flag expectations for 42−44 (FE), 43−44 (FF), and 44−44 (00).
  for (const [result, comparisonFlags] of [
    [42, { s: true, z: false, ac: false, p: false, cy: true }],
    [43, { s: true, z: false, ac: false, p: true, cy: true }],
    [44, { s: false, z: true, ac: true, p: true, cy: false }],
  ] as const) {
    checkStep([0xc6, 1], { ...previous, a: result, pc: 0x105,
      flags: { s: false, z: false, ac: false, p: result === 43, cy: false } });
    assert.equal(ram.read(4), destination);
    checkStep([0x32, 4, 0], { ...previous, pc: 0x108 }, [{ kind: "write", address: 4, value: result }]);
    checkStep([0xfe, 44], { ...previous, pc: 0x10a, flags: comparisonFlags });
    checkStep([0xc2, 3, 1], { ...previous, pc: result === 44 ? endAddress : 0x103 });
    destination = result;
    assert.deepEqual([ram.read(3), ram.read(4)], [41, result]);
  }
  assert.deepEqual(path, [0x100, 0x103, 0x105, 0x108, 0x10a, 0x103, 0x105, 0x108, 0x10a, 0x103, 0x105, 0x108, 0x10a, 0x10d]);
  assert.deepEqual(records[0], load);
  assert.deepEqual(Array.from({ length: program.length }, (_, offset) => ram.read(0x100 + offset)), program);
  assert.equal(cpu.snapshot().halted, false);
});

test("edited targets control repetition through equality and wraparound, independently of later data edits", () => {
  for (const [source, target, trips] of [[41, 42, 1], [41, 43, 2], [254, 0, 2], [41, 41, 256], [41, 40, 255], [0, 0, 256], [0, 255, 255]] as const) {
    const { cpu, ram, endAddress } = create8080ComparisonLesson();
    ram.write(3, source);
    ram.write(0x109, target);
    const load = cpu.step();
    assert.equal(load.after.a, source);
    assert.deepEqual(load.after.flags, initial.flags);
    ram.write(3, 99); // The next trip must not load again.
    for (let trip = 1; trip <= trips; trip++) {
      const value = (source + trip) % 256;
      const add = cpu.step();
      assert.equal(add.after.a, value);
      assert.equal(add.after.flags.z, value === 0);
      const store = cpu.step();
      assert.deepEqual(store.after, { ...add.after, pc: 0x108 });
      assert.equal(ram.read(4), value);
      const compare = cpu.step();
      assert.deepEqual(compare.instruction, { address: 0x108, bytes: [0xfe, target] });
      assert.deepEqual(compare.after, { ...store.after, pc: 0x10a, flags: compare.after.flags });
      assert.equal(compare.after.flags.z, value === target);
      assert.equal(ram.read(4), value);
      const edited = value === target ? (target + 1) % 256 : target;
      ram.write(4, edited); // Make RAM contradict equality; JNZ must still use Z.
      const jump = cpu.step();
      assert.deepEqual(jump.after, { ...compare.after, pc: trip === trips ? endAddress : 0x103 });
      assert.deepEqual([ram.read(3), ram.read(4)], [99, edited]);
    }
    assert.deepEqual([cpu.snapshot().pc, cpu.snapshot().a, cpu.snapshot().flags.z], [endAddress, target, true]);
    assert.equal(ram.read(0x109), target);
  }
});

test("a fresh comparison lesson restores source and target without changing completed records", () => {
  const first = create8080ComparisonLesson();
  first.ram.write(0x109, 42);
  const records = Array.from({ length: 5 }, () => first.cpu.step());
  const saved = structuredClone(records);
  assert.deepEqual([first.cpu.snapshot().pc, first.cpu.snapshot().a, first.cpu.snapshot().flags.z], [first.endAddress, 42, true]);
  const fresh = create8080ComparisonLesson();
  assert.notEqual(fresh.cpu, first.cpu);
  assert.notEqual(fresh.ram, first.ram);
  assert.deepEqual(fresh.cpu.snapshot(), initial);
  assert.deepEqual([fresh.ram.read(3), fresh.ram.read(4), fresh.ram.read(0x109)], [41, 0, 44]);
  Array.from({ length: 5 }, () => fresh.cpu.step());
  assert.deepEqual([fresh.cpu.snapshot().pc, fresh.cpu.snapshot().a], [0x103, 42]);
  assert.deepEqual(records, saved);
  assert.deepEqual(first.cpu.snapshot(), saved[4]!.after);
});
