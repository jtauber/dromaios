import assert from "node:assert/strict";
import { test } from "node:test";
import { createTerminalLesson } from "../../site/interactive/terminal-lesson.js";
import { format8080Trace } from "../../site/interactive/instruction-trace.js";

test("CALL saves a continuation before the routine runs; RET reads it without erasing RAM", () => {
  const lesson = createTerminalLesson("subroutine");
  const setup = lesson.step();
  assert.match(format8080Trace(setup, "LXI SP,0200H"), /SP: 0000 → 0200/);
  assert.equal(lesson.ram.read(0x1fe), 0);
  const call = lesson.step();
  assert.deepEqual([call.after.pc, call.after.sp, call.after.hl, call.after.a], [10, 0x1fe, 0, 0]);
  assert.deepEqual(lesson.terminalSnapshot(), { text: "", retained: 0 });
  const instruction = lesson.instructions.find(instruction => instruction.address === 3)!;
  const description = instruction.describe(call, 0);
  const trace = format8080Trace(call, "CALL 000AH");
  assert.match(description, /Saved return address 0006.*01FF ← 00, then 01FE ← 06.*routine's first instruction is next/);
  assert.match(trace, /SP: 0200 → 01FE/);
  assert.match(trace, /Write 01FF: 00\nWrite 01FE: 06/);
  for (let i = 0; i < 40; i++) lesson.step();
  assert.equal(lesson.snapshot().pc, 25);
  const returned = lesson.step();
  assert.deepEqual([returned.after.pc, returned.after.sp], [6, 0x200]);
  assert.deepEqual([lesson.ram.read(0x1fe), lesson.ram.read(0x1ff)], [6, 0]);
  assert.deepEqual(lesson.terminalSnapshot(), { text: "HELLO\n", retained: 6 });
  const returnInstruction = lesson.instructions.find(instruction => instruction.address === 25)!;
  const returnDescription = returnInstruction.describe(returned, 0);
  const returnTrace = format8080Trace(returned, "RET");
  assert.match(returnDescription, /Read return address 0006.*Reading did not erase the bytes/);
  assert.match(returnTrace, /Read  0019: C9\nRead  01FE: 06\nRead  01FF: 00/);
  const secondCall = lesson.step();
  assert.deepEqual([secondCall.after.pc, secondCall.after.sp], [10, 0x1fe]);
  assert.equal(lesson.ram.read(0x1fe), 9);
  assert.equal(instruction.describe(call, 0), description);
  assert.equal(format8080Trace(call, "CALL 000AH"), trace);
  assert.equal(returnInstruction.describe(returned, 0), returnDescription);
  assert.equal(format8080Trace(returned, "RET"), returnTrace);
  for (let i = 0; i < 42; i++) lesson.step();
  assert.deepEqual(lesson.terminalSnapshot(), { text: "HELLO\nHELLO\n", retained: 12 });
  assert.deepEqual([lesson.snapshot().pc, lesson.snapshot().sp, lesson.snapshot().hl], [10, 0x200, 0x106]);
  // HLT leaves PC at a valid routine entry, but that must not release HALT.
  assert.match(lesson.stepProblem()!, /CPU is halted/);
});

test("editing the saved return address changes RET, while its captured CALL stays unchanged", () => {
  for (const destination of [9, 0x106]) {
    const lesson = createTerminalLesson("subroutine");
    lesson.step();
    const call = lesson.step();
    const instruction = lesson.instructions.find(instruction => instruction.address === 3)!;
    const description = instruction.describe(call, 0);
    lesson.ram.write(0x1fe, destination & 0xff);
    lesson.ram.write(0x1ff, destination >> 8);
    assert.equal(instruction.describe(call, 0), description);
    for (let i = 0; i < 40; i++) lesson.step();
    const returned = lesson.step();
    assert.equal(returned.after.pc, destination);
    assert.equal(returned.after.sp, 0x200);
    assert.equal(instruction.describe(call, 0), description);
    assert.deepEqual(lesson.terminalSnapshot(), { text: "HELLO\n", retained: 6 });
    if (destination === 9) assert.equal(lesson.step().outcome, "halted");
    else assert.throws(() => lesson.step(), /only at instruction starts/);
  }
});

test("the second call reads the current message again instead of replaying host text", () => {
  const lesson = createTerminalLesson("subroutine");
  for (let i = 0; i < 43; i++) lesson.step();
  lesson.ram.write(0x100, 74);
  for (let i = 0; i < 43; i++) lesson.step();
  assert.deepEqual(lesson.terminalSnapshot(), { text: "HELLO\nJELLO\n", retained: 12 });
});

test("subroutine guards protect all 26 program bytes but allow stack edits and do not invent a call stack", () => {
  const lesson = createTerminalLesson("subroutine");
  assert.equal(lesson.startAddress, 0);
  assert.equal(lesson.bytes.length, 26);
  assert.equal(lesson.inputSnapshot(), undefined);
  for (let address = 0; address < 26; address++) {
    const expected = lesson.ram.read(address);
    lesson.ram.write(address, expected ^ 0xff);
    const state = lesson.snapshot();
    assert.throws(() => lesson.step(), /from the reference card/);
    assert.deepEqual(lesson.snapshot(), state);
    lesson.ram.write(address, expected);
  }
  lesson.ram.write(0x1fe, 9);
  for (let address = 0; address <= 26; address++) {
    for (let bit = 0; bit < 16; bit++) {
      if ((lesson.panel.switches ^ address) & (1 << bit)) lesson.panel.toggleSwitch(bit);
    }
    lesson.panel.examine();
    if ([0, 3, 6, 9, 10, 13, 14, 16, 19, 21, 22, 25].includes(address)) assert.equal(lesson.stepProblem(), undefined);
    else assert.match(lesson.stepProblem()!, /only at instruction starts/);
  }
  // Select RET without initializing SP or calling: it still reads actual RAM at SP = 0.
  lesson.panel.toggleSwitch(0); lesson.panel.toggleSwitch(1); lesson.panel.examine(); // 001A → 0019.
  assert.deepEqual([lesson.snapshot().pc, lesson.snapshot().sp], [25, 0]);
  const returned = lesson.step();
  assert.deepEqual([returned.after.pc, returned.after.sp], [0x31, 2]);
  assert.match(lesson.stepProblem()!, /only at instruction starts/);
  assert.equal(lesson.outputSnapshot()!.writes, 0);
});
