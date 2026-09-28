import assert from "node:assert/strict";
import { test } from "node:test";
import { createAltairProgram } from "../../site/interactive/altair-program.js";
import { format8080Trace } from "../../site/interactive/instruction-trace.js";

type Lesson = ReturnType<typeof createAltairProgram>;

function switches(lesson: Lesson, value: number): void {
  for (let bit = 0; bit < 16; bit++) {
    if ((lesson.panel.switches ^ value) & (1 << bit)) lesson.panel.toggleSwitch(bit);
  }
}

function examine(lesson: Lesson, address: number): void {
  switches(lesson, address);
  lesson.panel.examine();
}

function deposit(lesson: Lesson, address: number, value: number): void {
  examine(lesson, address);
  switches(lesson, value);
  lesson.panel.deposit();
}

function enterProgram(lesson: Lesson, operand = 1): void {
  examine(lesson, 0x100);
  // Independently transcribed 8080 encodings: LDA 0003H; ADI n; STA 0004H.
  for (const [index, byte] of [0x3a, 3, 0, 0xc6, operand, 0x32, 4, 0].entries()) {
    switches(lesson, byte);
    if (index === 0) lesson.panel.deposit();
    else lesson.panel.depositNext();
  }
}

function step(lesson: Lesson) {
  const record = lesson.step();
  assert.equal(record.outcome, "executed");
  if (record.outcome !== "executed") throw new Error("Expected an executed instruction");
  return record;
}

const read = (address: number, value: number) => ({ kind: "read", address, value });
const clearFlags = { s: false, z: false, ac: false, p: false, cy: false };

test("the entry lesson starts with data but no program, and refuses to execute empty RAM", () => {
  const lesson = createAltairProgram();
  assert.equal(lesson.ram.size, 0x10000);
  assert.equal(lesson.endAddress, 0x108);
  for (let address = 0; address < lesson.ram.size; address++) {
    assert.equal(lesson.ram.read(address), address === 3 ? 41 : 0, `address ${address}`);
  }
  const before = lesson.snapshot();
  assert.deepEqual([before.a, before.pc, before.sp, before.flags], [0, 0, 0, clearFlags]);
  assert.match(lesson.stepProblem()!, /0100.*00.*3A/);
  assert.throws(() => lesson.step(), /enter 3A/);
  assert.deepEqual(lesson.snapshot(), before);
});

test("eight manual deposits become three real CPU instructions with the expected memory accesses", () => {
  const lesson = createAltairProgram();
  const initial = lesson.snapshot();
  enterProgram(lesson);
  assert.deepEqual(lesson.snapshot(), { ...initial, pc: 0x107 });
  assert.throws(() => lesson.step(), /instruction starts/);
  examine(lesson, 0x100);
  const load = step(lesson);
  assert.deepEqual(load.instruction, { address: 0x100, bytes: [0x3a, 3, 0] });
  assert.deepEqual(load.accesses, [read(0x100, 0x3a), read(0x101, 3), read(0x102, 0), read(3, 41)]);
  assert.deepEqual(load.after, { ...initial, a: 41, pc: 0x103 });
  assert.deepEqual([lesson.panel.address, lesson.panel.data, lesson.ram.read(4)], [0x103, 0xc6, 0]);
  const add = step(lesson);
  assert.deepEqual(add.instruction, { address: 0x103, bytes: [0xc6, 1] });
  assert.deepEqual(add.accesses, [read(0x103, 0xc6), read(0x104, 1)]);
  assert.deepEqual(add.after, { ...initial, a: 42, pc: 0x105 });
  const store = step(lesson);
  assert.deepEqual(store.instruction, { address: 0x105, bytes: [0x32, 4, 0] });
  assert.deepEqual(store.accesses, [read(0x105, 0x32), read(0x106, 4), read(0x107, 0), { kind: "write", address: 4, value: 42 }]);
  assert.deepEqual(store.after, { ...initial, a: 42, pc: 0x108 });
  assert.deepEqual([lesson.panel.address, lesson.panel.data, lesson.ram.read(3), lesson.ram.read(4)], [0x108, 0, 41, 42]);
  assert.throws(() => lesson.step(), /just after the program/);
  const expected = new Map([[3, 41], [4, 42], [0x100, 0x3a], [0x101, 3], [0x103, 0xc6], [0x104, 1], [0x105, 0x32], [0x106, 4]]);
  for (let address = 0; address < lesson.ram.size; address++) assert.equal(lesson.ram.read(address), expected.get(address) ?? 0);
});

test("examining and editing an operand preserve CPU state and the captured instruction; rerunning reads the edit", () => {
  const lesson = createAltairProgram();
  enterProgram(lesson);
  examine(lesson, 0x100);
  step(lesson);
  const add = step(lesson);
  const trace = format8080Trace(add, "ADI 1");
  assert.match(trace, /0103: C6 01  ADI 1/);
  assert.match(trace, /Read  0104: 01/);
  step(lesson);
  const completed = lesson.snapshot();
  examine(lesson, 4);
  assert.deepEqual(lesson.snapshot(), { ...completed, pc: 4 });
  assert.equal(lesson.panel.data, 42);
  deposit(lesson, 0x104, 2);
  assert.deepEqual(lesson.snapshot(), { ...completed, pc: 0x104 });
  assert.equal(format8080Trace(add, "ADI 1"), trace);
  assert.deepEqual(add.instruction.bytes, [0xc6, 1]);
  examine(lesson, 0x100);
  assert.deepEqual(lesson.snapshot(), { ...completed, pc: 0x100 });
  assert.equal(lesson.ram.read(4), 42);
  step(lesson);
  const changed = step(lesson);
  assert.deepEqual(changed.instruction.bytes, [0xc6, 2]);
  assert.deepEqual(changed.after.flags, { ...clearFlags, p: true });
  assert.equal(changed.after.a, 43);
  step(lesson);
  assert.equal(lesson.ram.read(4), 43);
});

test("every operand byte is allowed, with arithmetic performed by the CPU on editable source data", () => {
  const lesson = createAltairProgram();
  enterProgram(lesson);
  deposit(lesson, 3, 254);
  for (const [operand, result, carry] of [[0, 254, false], [1, 255, false], [2, 0, true], [255, 253, true]] as const) {
    deposit(lesson, 0x104, operand);
    examine(lesson, 0x100);
    assert.equal(lesson.stepProblem(), undefined);
    step(lesson);
    const record = step(lesson);
    assert.deepEqual([record.after.a, record.after.flags.cy], [result, carry]);
    step(lesson);
    assert.equal(lesson.ram.read(4), result);
    assert.equal(lesson.ram.read(3), 254);
  }
});

test("entry guards reject each incorrect fixed byte and non-instruction PC without executing", () => {
  const lesson = createAltairProgram();
  enterProgram(lesson);
  for (const offset of [0, 1, 2, 3, 5, 6, 7]) {
    const address = 0x100 + offset;
    const original = lesson.ram.read(address);
    deposit(lesson, address, original ^ 0xff);
    examine(lesson, 0x100);
    const before = lesson.snapshot();
    assert.throws(() => lesson.step(), /reference card/);
    assert.deepEqual(lesson.snapshot(), before);
    assert.equal(lesson.ram.read(4), 0);
    deposit(lesson, address, original);
  }
  for (const address of [0, 4, 0x101, 0x102, 0x104, 0x106, 0x107, 0xffff]) {
    examine(lesson, address);
    const before = lesson.snapshot();
    assert.throws(() => lesson.step(), /instruction starts/);
    assert.deepEqual(lesson.snapshot(), before);
  }
});

test("both NEXT operations move PC with 16-bit wrapping while preserving registers, flags, and switches", () => {
  for (const action of ["examineNext", "depositNext"] as const) {
    const lesson = createAltairProgram();
    enterProgram(lesson, 255);
    examine(lesson, 0x100);
    step(lesson);
    step(lesson);
    const before = lesson.snapshot();
    assert.equal(before.flags.cy, true);
    examine(lesson, 0xffff);
    switches(lesson, 0xab2a);
    lesson.panel[action]();
    assert.deepEqual(lesson.snapshot(), { ...before, pc: 0 });
    assert.deepEqual([lesson.panel.address, lesson.panel.data, lesson.panel.switches], [0, action === "depositNext" ? 42 : 0, 0xab2a]);
    lesson.panel[action]();
    assert.deepEqual(lesson.snapshot(), { ...before, pc: 1 });
    assert.equal(lesson.ram.read(1), action === "depositNext" ? 42 : 0);
    assert.equal(lesson.ram.read(0xffff), 0);
  }
});

test("a fresh lesson restores initial data and an empty program without modifying the old session", () => {
  const old = createAltairProgram();
  enterProgram(old);
  examine(old, 0x100);
  step(old); step(old); step(old);
  const fresh = createAltairProgram();
  assert.notEqual(fresh.ram, old.ram);
  assert.deepEqual([fresh.snapshot().a, fresh.snapshot().pc, fresh.panel.switches], [0, 0, 0]);
  assert.deepEqual([fresh.ram.read(3), fresh.ram.read(4), fresh.ram.read(0x100)], [41, 0, 0]);
  assert.deepEqual([old.ram.read(3), old.ram.read(4), old.ram.read(0x100)], [41, 42, 0x3a]);
});
