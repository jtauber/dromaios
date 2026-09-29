import assert from "node:assert/strict";
import { test } from "node:test";
import { createTerminalLesson } from "../../site/interactive/terminal-lesson.js";
import { format8080Trace } from "../../site/interactive/instruction-trace.js";

test("the inner return resumes the printing loop while the outer return remains pending", () => {
  const lesson = createTerminalLesson("nested-call");
  for (let i = 0; i < 6; i++) lesson.step();
  const call = lesson.step();
  assert.deepEqual([call.before.sp, call.after.pc, call.after.sp, call.after.a, call.after.hl], [0x1fe, 27, 0x1fc, 72, 0x100]);
  assert.deepEqual([0x1fc, 0x1fd, 0x1fe, 0x1ff].map(address => lesson.ram.read(address)), [22, 0, 6, 0]);
  assert.deepEqual(lesson.terminalSnapshot(), { text: "", retained: 0 });
  const innerCall = lesson.instructions.find(instruction => instruction.address === 19)!;
  const description = innerCall.describe(call, 0);
  const trace = format8080Trace(call, "CALL 001BH");
  assert.match(description, /Saved return address 0016.*01FD ← 00, then 01FC ← 16/);
  assert.match(trace, /SP: 01FE → 01FC/);
  assert.match(trace, /Write 01FD: 00\nWrite 01FC: 16/);
  lesson.step(); // OUT is a separate instruction; it alone sends H.
  const returned = lesson.step();
  assert.deepEqual([returned.after.pc, returned.after.sp], [22, 0x1fe]);
  assert.deepEqual(lesson.terminalSnapshot(), { text: "H", retained: 1 });
  assert.deepEqual([0x1fc, 0x1fd, 0x1fe, 0x1ff].map(address => lesson.ram.read(address)), [22, 0, 6, 0]);
  const innerReturn = lesson.instructions.find(instruction => instruction.address === 29)!;
  const returnDescription = innerReturn.describe(returned, 0);
  const returnTrace = format8080Trace(returned, "RET");
  assert.match(returnDescription, /Read return address 0016.*01FC and 01FD.*Reading did not erase/);
  assert.match(returnTrace, /Read  001D: C9\nRead  01FC: 16\nRead  01FD: 00/);
  for (let i = 9; i < 55; i++) lesson.step();
  assert.deepEqual([lesson.snapshot().pc, lesson.snapshot().sp], [6, 0x200]);
  assert.deepEqual(lesson.terminalSnapshot(), { text: "HELLO\n", retained: 6 });
  lesson.step(); // The next outer call changes only the outer pair.
  assert.deepEqual([0x1fc, 0x1fd, 0x1fe, 0x1ff].map(address => lesson.ram.read(address)), [22, 0, 9, 0]);
  for (let i = 56; i < 110; i++) lesson.step();
  assert.deepEqual(lesson.terminalSnapshot(), { text: "HELLO\nHELLO\n", retained: 12 });
  assert.match(lesson.stepProblem()!, /CPU is halted/);
  // Captures survive both stack reuse and later edits to the bytes they described.
  for (let address = 0x1fc; address <= 0x1ff; address++) lesson.ram.write(address, 0xff);
  assert.equal(innerCall.describe(call, 0), description);
  assert.equal(format8080Trace(call, "CALL 001BH"), trace);
  assert.equal(innerReturn.describe(returned, 0), returnDescription);
  assert.equal(format8080Trace(returned, "RET"), returnTrace);
});

test("editing the outer continuation with the panel leaves the pending inner return alone", () => {
  const lesson = createTerminalLesson("nested-call");
  for (let i = 0; i < 7; i++) lesson.step();
  const setSwitches = (value: number): void => {
    for (let bit = 0; bit < 16; bit++) {
      if ((lesson.panel.switches ^ value) & (1 << bit)) lesson.panel.toggleSwitch(bit);
    }
  };
  setSwitches(0x1fe); lesson.panel.examine();
  setSwitches(9); lesson.panel.deposit();
  setSwitches(27); lesson.panel.examine();
  assert.deepEqual([lesson.snapshot().pc, lesson.snapshot().sp], [27, 0x1fc]);
  lesson.step();
  assert.equal(lesson.step().after.pc, 22);
  for (let i = 9; i < 55; i++) lesson.step();
  assert.deepEqual([lesson.snapshot().pc, lesson.snapshot().sp], [9, 0x200]);
  assert.equal(lesson.step().outcome, "halted");
  assert.deepEqual(lesson.terminalSnapshot(), { text: "HELLO\n", retained: 6 });
});

test("editing the inner continuation changes its RET without changing the outer address", () => {
  for (const destination of [26, 0x106]) {
    const lesson = createTerminalLesson("nested-call");
    for (let i = 0; i < 7; i++) lesson.step();
    lesson.ram.write(0x1fc, destination & 0xff);
    lesson.ram.write(0x1fd, destination >> 8);
    lesson.step();
    const returned = lesson.step();
    assert.deepEqual([returned.after.pc, returned.after.sp], [destination, 0x1fe]);
    assert.deepEqual([lesson.ram.read(0x1fe), lesson.ram.read(0x1ff)], [6, 0]);
    if (destination === 26) {
      // Select the outer RET early: the first message stops after H, the second prints normally.
      assert.equal(lesson.step().after.pc, 6);
      for (let i = 10; i < 65; i++) lesson.step();
      assert.deepEqual(lesson.terminalSnapshot(), { text: "HHELLO\n", retained: 7 });
      assert.equal(lesson.snapshot().halted, true);
    } else {
      assert.throws(() => lesson.step(), /only at instruction starts/);
      assert.deepEqual(lesson.terminalSnapshot(), { text: "H", retained: 1 });
    }
  }
});

test("nested-call guards cover all 30 bytes and 14 instruction starts without inventing stack depth", () => {
  const lesson = createTerminalLesson("nested-call");
  assert.equal(lesson.startAddress, 0);
  assert.equal(lesson.bytes.length, 30);
  assert.equal(lesson.inputSnapshot(), undefined);
  for (let address = 0; address < 30; address++) {
    const expected = lesson.ram.read(address);
    lesson.ram.write(address, expected ^ 0xff);
    const state = lesson.snapshot();
    assert.throws(() => lesson.step(), /from the reference card/);
    assert.deepEqual(lesson.snapshot(), state);
    lesson.ram.write(address, expected);
  }
  for (let address = 0; address <= 30; address++) {
    for (let bit = 0; bit < 16; bit++) {
      if ((lesson.panel.switches ^ address) & (1 << bit)) lesson.panel.toggleSwitch(bit);
    }
    lesson.panel.examine();
    if ([0, 3, 6, 9, 10, 13, 14, 16, 19, 22, 23, 26, 27, 29].includes(address)) assert.equal(lesson.stepProblem(), undefined);
    else assert.match(lesson.stepProblem()!, /only at instruction starts/);
  }
  // RET at 001D with uninitialized SP reads real program RAM at 0000, not a host call stack.
  lesson.panel.toggleSwitch(0); lesson.panel.toggleSwitch(1); lesson.panel.examine(); // 001E → 001D.
  const returned = lesson.step();
  assert.deepEqual([returned.after.pc, returned.after.sp], [0x31, 2]);
  assert.match(lesson.stepProblem()!, /only at instruction starts/);
  assert.equal(lesson.outputSnapshot()!.writes, 0);
});
