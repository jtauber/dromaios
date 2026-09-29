import assert from "node:assert/strict";
import { test } from "node:test";
import { createTerminalLesson } from "../../site/interactive/terminal-lesson.js";
import { format8080Trace } from "../../site/interactive/instruction-trace.js";

test("the terminated-message session explains the sampled zero and skips OUT before halting", () => {
  const lesson = createTerminalLesson("terminated-message");
  for (let i = 0; i < 37; i++) lesson.step();
  assert.deepEqual([lesson.snapshot().pc, lesson.snapshot().a, lesson.snapshot().hl, lesson.snapshot().flags.z], [3, 10, 0x106, false]);
  assert.deepEqual(lesson.terminalSnapshot(), { text: "HELLO\n", retained: 6 });
  const load = lesson.step();
  assert.deepEqual([load.after.a, load.after.flags.z], [0, false]);
  assert.match(format8080Trace(load, "MOV A,M"), /Read  0106: 00/);
  const compared = lesson.step();
  assert.deepEqual([compared.after.a, compared.after.flags.z], [0, true]);
  const comparison = lesson.instructions.find(instruction => instruction.address === 4)!;
  assert.match(comparison.describe(compared, 0), /Compared A \(0\) with 0.*values match/);
  const branch = lesson.step();
  assert.equal(branch.after.pc, 15);
  assert.match(lesson.instructions.find(instruction => instruction.address === 6)!.describe(branch, 0), /Jump taken: jumped from 0006 to 000F/);
  assert.equal(lesson.snapshot().halted, false);
  assert.equal(lesson.step().outcome, "halted");
  assert.equal(lesson.snapshot().pc, 16);
  assert.match(lesson.stepProblem()!, /CPU is halted/);
  assert.deepEqual(lesson.outputSnapshot(), { lastByte: 10, writes: 6 });
  assert.deepEqual(lesson.terminalSnapshot(), { text: "HELLO\n", retained: 6 });
});

test("moving zero changes the ending without changing the program or reading beyond it", () => {
  for (let ending = 0; ending <= 6; ending++) {
    const lesson = createTerminalLesson("terminated-message");
    lesson.ram.write(0x100 + ending, 0);
    const reads: number[] = [];
    for (let step = 0; step < 6 * ending + 5; step++) {
      for (const access of lesson.step().accesses) {
        if (access.kind === "read" && access.address >= 0x100) reads.push(access.address);
      }
    }
    assert.deepEqual(reads, Array.from({ length: ending + 1 }, (_, i) => 0x100 + i));
    assert.deepEqual(lesson.terminalSnapshot(), { text: "HELLO\n".slice(0, ending), retained: ending });
    assert.deepEqual([lesson.snapshot().hl, lesson.snapshot().a, lesson.snapshot().halted], [0x100 + ending, 0, true]);
    assert.equal(lesson.ram.read(0x103), ending === 3 ? 0 : 76);
  }
});

test("nonzero characters and controls remain ordinary output, and the RAM window does not impose an ending", () => {
  const lesson = createTerminalLesson("terminated-message");
  [48, 10, 128, 255, 60, 38, 33].forEach((value, i) => { lesson.ram.write(0x100 + i, value); });
  for (let i = 0; i < 47; i++) lesson.step();
  assert.deepEqual(lesson.terminalSnapshot(), { text: "0\n⟨80 hex⟩⟨FF hex⟩<&!", retained: 7 });
  assert.deepEqual([lesson.snapshot().hl, lesson.snapshot().a, lesson.snapshot().halted], [0x107, 0, true]);
  assert.equal(lesson.outputSnapshot()!.writes, 7);
});

test("RAM edits after MOV or CPI preserve the loaded byte, branch choice, and captured explanations", () => {
  for (const value of [0, 72]) for (const afterCompare of [false, true]) {
    const lesson = createTerminalLesson("terminated-message");
    lesson.ram.write(0x100, value);
    lesson.step();
    const load = lesson.step();
    const instruction = lesson.instructions.find(instruction => instruction.address === 3)!;
    const description = instruction.describe(load, 0);
    const trace = format8080Trace(load, "MOV A,M");
    if (afterCompare) lesson.step();
    const state = lesson.snapshot();
    lesson.ram.write(0x100, value === 0 ? 72 : 0);
    assert.deepEqual(lesson.snapshot(), state);
    assert.equal(instruction.describe(load, 0), description);
    assert.equal(format8080Trace(load, "MOV A,M"), trace);
    if (!afterCompare) lesson.step();
    const branch = lesson.step();
    assert.equal(branch.after.pc, value === 0 ? 15 : 9);
    lesson.step(); // HLT or OUT follows the already loaded and compared byte.
    assert.deepEqual(lesson.terminalSnapshot(), { text: value === 0 ? "" : "H", retained: value === 0 ? 0 : 1 });
  }
});

test("the terminated-message guard protects all program bytes but permits data edits and only instruction starts", () => {
  const lesson = createTerminalLesson("terminated-message");
  assert.equal(lesson.startAddress, 0);
  assert.equal(lesson.inputSnapshot(), undefined);
  for (let address = 0; address < 16; address++) {
    const expected = lesson.ram.read(address);
    lesson.ram.write(address, expected ^ 0xff);
    const state = lesson.snapshot();
    assert.throws(() => lesson.step(), /from the reference card/);
    assert.deepEqual(lesson.snapshot(), state);
    lesson.ram.write(address, expected);
  }
  lesson.ram.write(0x100, 0);
  for (let address = 0; address <= 16; address++) {
    for (let bit = 0; bit < 16; bit++) {
      if ((lesson.panel.switches ^ address) & (1 << bit)) lesson.panel.toggleSwitch(bit);
    }
    lesson.panel.examine();
    if ([0, 3, 4, 6, 9, 11, 12, 15].includes(address)) assert.equal(lesson.stepProblem(), undefined);
    else assert.match(lesson.stepProblem()!, /EXAMINE 0000.*only at instruction starts/);
  }
  assert.equal(lesson.outputSnapshot()!.writes, 0);
});
