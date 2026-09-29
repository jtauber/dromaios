import assert from "node:assert/strict";
import { test } from "node:test";
import { createTerminalLesson } from "../../site/interactive/terminal-lesson.js";
import { format8080Trace } from "../../site/interactive/instruction-trace.js";

test("PUSH copies HL, POP restores it without returning, and RET reads the following pair", () => {
  const lesson = createTerminalLesson("save-registers");
  for (let i = 0; i < 3; i++) lesson.step();
  assert.deepEqual([lesson.snapshot().pc, lesson.snapshot().hl, lesson.snapshot().sp], [13, 0x100, 0x1fe]);
  const pushed = lesson.step();
  assert.deepEqual([pushed.after.pc, pushed.after.hl, pushed.after.sp], [14, 0x100, 0x1fc]);
  assert.deepEqual([0x1fc, 0x1fd, 0x1fe, 0x1ff].map(address => lesson.ram.read(address)), [0, 1, 9, 0]);
  assert.deepEqual(lesson.terminalSnapshot(), { text: "", retained: 0 });
  const push = lesson.instructions.find(instruction => instruction.address === 13)!;
  const description = push.describe(pushed, 0);
  const trace = format8080Trace(pushed, "PUSH H");
  assert.match(description, /Saved HL 0100.*01FD ← 01, then 01FC ← 00.*HL still holds 0100/);
  assert.match(trace, /SP: 01FE → 01FC/);
  assert.match(trace, /Read  000D: E5\nWrite 01FD: 01\nWrite 01FC: 00/);
  for (let i = 4; i < 43; i++) lesson.step();
  assert.deepEqual([lesson.snapshot().pc, lesson.snapshot().hl, lesson.snapshot().sp], [26, 0x106, 0x1fc]);
  const popped = lesson.step();
  assert.deepEqual([popped.after.pc, popped.after.hl, popped.after.sp], [27, 0x100, 0x1fe]);
  assert.deepEqual(popped.after.flags, popped.before.flags);
  assert.equal(popped.after.a, 0);
  const pop = lesson.instructions.find(instruction => instruction.address === 26)!;
  const popDescription = pop.describe(popped, 0);
  const popTrace = format8080Trace(popped, "POP H");
  assert.match(popDescription, /Read L 00.*01FC and H 01 from 01FD.*HL changed from 0106 to 0100.*POP did not return/);
  assert.match(popTrace, /Read  001A: E1\nRead  01FC: 00\nRead  01FD: 01/);
  assert.deepEqual(lesson.terminalSnapshot(), { text: "HELLO\n", retained: 6 });
  const returned = lesson.step();
  assert.deepEqual([returned.after.pc, returned.after.hl, returned.after.sp], [9, 0x100, 0x200]);
  for (let i = 45; i < 89; i++) lesson.step();
  assert.deepEqual(lesson.terminalSnapshot(), { text: "HELLO\nHELLO\n", retained: 12 });
  assert.deepEqual([lesson.snapshot().pc, lesson.snapshot().hl, lesson.snapshot().sp], [13, 0x100, 0x200]);
  assert.match(lesson.stepProblem()!, /CPU is halted/);
  for (let address = 0x1fc; address <= 0x1ff; address++) lesson.ram.write(address, 0xff);
  assert.equal(push.describe(pushed, 0), description);
  assert.equal(format8080Trace(pushed, "PUSH H"), trace);
  assert.equal(pop.describe(popped, 0), popDescription);
  assert.equal(format8080Trace(popped, "POP H"), popTrace);
});

test("POP reads both saved bytes from live RAM and the next call uses the restored pointer", () => {
  for (const pointer of [0x101, 0x201]) {
    const lesson = createTerminalLesson("save-registers");
    for (let i = 0; i < 4; i++) lesson.step();
    lesson.ram.write(0x201, 65); // A second message for the high-byte edit.
    lesson.ram.write(0x1fc, pointer & 0xff);
    lesson.ram.write(0x1fd, pointer >> 8);
    assert.equal(lesson.snapshot().hl, 0x100);
    for (let i = 4; i < 44; i++) lesson.step();
    assert.deepEqual([lesson.snapshot().hl, lesson.snapshot().sp, lesson.snapshot().pc], [pointer, 0x1fe, 27]);
    assert.deepEqual(lesson.terminalSnapshot(), { text: "HELLO\n", retained: 6 });
    assert.equal(lesson.step().after.pc, 9); // The return address was untouched.
    const steps = pointer === 0x101 ? 83 : 59;
    for (let i = 45; i < steps; i++) lesson.step();
    assert.deepEqual(lesson.terminalSnapshot(), pointer === 0x101
      ? { text: "HELLO\nELLO\n", retained: 11 } : { text: "HELLO\nA", retained: 7 });
    assert.equal(lesson.snapshot().hl, pointer);
    assert.equal(lesson.snapshot().halted, true);
  }
});

test("skipping POP lets RET consume the saved pointer without restoring HL", () => {
  const lesson = createTerminalLesson("save-registers");
  for (let i = 0; i < 43; i++) lesson.step();
  for (let bit = 0; bit < 16; bit++) if (27 & (1 << bit)) lesson.panel.toggleSwitch(bit);
  lesson.panel.examine();
  const returned = lesson.step();
  assert.deepEqual([returned.after.pc, returned.after.hl, returned.after.sp], [0x100, 0x106, 0x1fe]);
  assert.deepEqual(returned.accesses, [
    { kind: "read", address: 27, value: 0xc9 },
    { kind: "read", address: 0x1fc, value: 0 }, { kind: "read", address: 0x1fd, value: 1 },
  ]);
  assert.throws(() => lesson.step(), /only at instruction starts/);
  assert.deepEqual(lesson.terminalSnapshot(), { text: "HELLO\n", retained: 6 });
});

test("register-saving guards cover all program bytes and instruction starts while allowing data edits", () => {
  const lesson = createTerminalLesson("save-registers");
  assert.equal(lesson.startAddress, 0);
  assert.equal(lesson.bytes.length, 28);
  assert.equal(lesson.inputSnapshot(), undefined);
  for (let address = 0; address < 28; address++) {
    const expected = lesson.ram.read(address);
    lesson.ram.write(address, expected ^ 0xff);
    const state = lesson.snapshot();
    assert.throws(() => lesson.step(), /from the reference card/);
    assert.deepEqual(lesson.snapshot(), state);
    lesson.ram.write(address, expected);
  }
  lesson.ram.write(0x100, 0); lesson.ram.write(0x1fc, 42);
  for (let address = 0; address <= 28; address++) {
    for (let bit = 0; bit < 16; bit++) {
      if ((lesson.panel.switches ^ address) & (1 << bit)) lesson.panel.toggleSwitch(bit);
    }
    lesson.panel.examine();
    if ([0, 3, 6, 9, 12, 13, 14, 15, 17, 20, 22, 23, 26, 27].includes(address)) assert.equal(lesson.stepProblem(), undefined);
    else assert.match(lesson.stepProblem()!, /only at instruction starts/);
  }
});
