import assert from "node:assert/strict";
import { test } from "node:test";
import { createTerminalLesson } from "../../site/interactive/terminal-lesson.js";
import { format8080Trace } from "../../site/interactive/instruction-trace.js";

test("offering and receiving a character remain distinct from storing it, counting it, and printing it", () => {
  const lesson = createTerminalLesson("buffer");
  const initial = lesson.snapshot();
  assert.equal(lesson.offerInput(72), true);
  assert.equal(lesson.offerInput(73), false);
  assert.deepEqual(lesson.snapshot(), initial);
  for (let i = 0; i < 8; i++) lesson.step();
  assert.deepEqual([lesson.snapshot().pc, lesson.snapshot().a, lesson.snapshot().hl, lesson.snapshot().b], [0x13, 72, 0x100, 8]);
  assert.equal(lesson.ram.read(0x100), 0);
  assert.deepEqual(lesson.terminalSnapshot(), { text: "", retained: 0 });
  lesson.offerInput(10); // The next arrival cannot replace the character already in A.
  const store = lesson.step();
  assert.deepEqual(store.accesses, [{ kind: "read", address: 0x13, value: 0x77 }, { kind: "write", address: 0x100, value: 72 }]);
  assert.deepEqual([store.after.a, store.after.hl, store.after.b], [72, 0x100, 8]);
  const instruction = lesson.instructions.find(instruction => instruction.address === 0x13)!;
  const description = instruction.describe(store, 0);
  const trace = format8080Trace(store, "MOV M,A");
  assert.match(description, /Wrote 72 from A to RAM at 0100/);
  assert.match(trace, /Write 0100: 48/);
  lesson.ram.write(0x100, 74);
  assert.equal(instruction.describe(store, 0), description);
  assert.equal(format8080Trace(store, "MOV M,A"), trace);
  for (let i = 0; i < 12; i++) lesson.step(); // Finish collection and rewind, stopping before readback.
  assert.equal(lesson.snapshot().pc, 0x1f);
  assert.deepEqual(lesson.terminalSnapshot(), { text: "", retained: 0 });
  for (let i = 0; i < 10; i++) lesson.step();
  assert.deepEqual(lesson.terminalSnapshot(), { text: "J", retained: 1 });
  assert.equal(lesson.snapshot().halted, true);
  assert.deepEqual(lesson.inputSnapshot(), { pendingByte: null });
});

test("readback retains spaces, repeated characters, the digit zero, and literal punctuation without echoing input", () => {
  const lesson = createTerminalLesson("buffer");
  lesson.step(); lesson.step();
  for (const value of [32, 76, 76, 60, 38, 48]) {
    lesson.offerInput(value);
    for (let i = 0; i < 10; i++) lesson.step();
    assert.deepEqual(lesson.terminalSnapshot(), { text: "", retained: 0 });
  }
  lesson.offerInput(10);
  for (let i = 0; i < 49; i++) lesson.step(); // Receive LF, append NUL, rewind, and print six bytes.
  assert.deepEqual(lesson.terminalSnapshot(), { text: " LL<&0", retained: 6 });
  assert.deepEqual([lesson.snapshot().a, lesson.snapshot().b, lesson.snapshot().hl, lesson.snapshot().pc], [0, 2, 0x106, 0x2c]);
  assert.equal(lesson.outputSnapshot()!.writes, 6);
  assert.match(lesson.stepProblem()!, /CPU is halted/);
});

test("all buffer instruction bytes are guarded while buffer data remains editable", () => {
  const lesson = createTerminalLesson("buffer");
  assert.equal(lesson.startAddress, 0);
  assert.equal(lesson.bytes.length, 44);
  for (let address = 0; address < 44; address++) {
    const expected = lesson.ram.read(address);
    lesson.ram.write(address, expected ^ 0xff);
    const state = lesson.snapshot();
    assert.throws(() => lesson.step(), /from the reference card/);
    assert.deepEqual(lesson.snapshot(), state);
    lesson.ram.write(address, expected);
  }
  lesson.ram.write(0x100, 74);
  const starts = [0, 3, 5, 7, 9, 12, 14, 16, 19, 20, 21, 22, 25, 27, 28, 31, 32, 34, 37, 39, 40, 43];
  for (let address = 0; address <= 44; address++) {
    for (let bit = 0; bit < 16; bit++) {
      if ((lesson.panel.switches ^ address) & (1 << bit)) lesson.panel.toggleSwitch(bit);
    }
    lesson.panel.examine();
    if (starts.includes(address)) assert.equal(lesson.stepProblem(), undefined);
    else assert.match(lesson.stepProblem()!, /EXAMINE 0000.*only at instruction starts/);
  }
  assert.equal(lesson.outputSnapshot()!.writes, 0);
  assert.equal(lesson.ram.read(0x100), 74);
});
