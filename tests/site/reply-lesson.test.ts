import assert from "node:assert/strict";
import { test } from "node:test";
import { createTerminalLesson } from "../../site/interactive/terminal-lesson.js";

test("the reply session describes the CPU's choice without turning input or replacement into output", () => {
  const lesson = createTerminalLesson("reply");
  function step() {
    const instruction = lesson.instructions.find(instruction => instruction.address === lesson.snapshot().pc)!;
    const record = lesson.step();
    assert.equal(record.outcome, "executed");
    return { record, description: instruction.describe(record, 0) };
  }
  lesson.offerInput(97);
  for (let i = 0; i < 4; i++) step();
  assert.deepEqual(lesson.terminalSnapshot(), { text: "", retained: 0 });
  assert.equal(lesson.snapshot().a, 97);
  lesson.offerInput(98);
  const compared = step();
  assert.match(compared.description, /Compared A \(97\) with 97.*Z is 1.*A still holds 97/);
  assert.match(step().description, /Jump not taken: continued from 010B to 010E/);
  const replaced = step();
  assert.match(replaced.description, /Copied 65 from the instruction into A, replacing 97/);
  assert.deepEqual(lesson.terminalSnapshot(), { text: "", retained: 0 });
  assert.deepEqual(lesson.inputSnapshot(), { pendingByte: 98 });
  step();
  assert.deepEqual(lesson.terminalSnapshot(), { text: "A", retained: 1 });
  step(); // Return to readiness, then receive the pending b.
  for (let i = 0; i < 5; i++) step();
  assert.match(step().description, /Z was 0.*Jump taken: jumped from 010B to 0110/);
  step();
  assert.deepEqual(lesson.terminalSnapshot(), { text: "Ab", retained: 2 });
  assert.deepEqual(lesson.outputSnapshot(), { lastByte: 98, writes: 2 });
  // Completed explanations retain the fetched immediate even after a panel edit.
  lesson.ram.write(0x10f, 66);
  const replacement = lesson.instructions.find(instruction => instruction.address === 0x10e)!;
  assert.equal(replacement.describe(replaced.record, 0), replaced.description);
  assert.equal(compared.record.after.a, 97);
});

test("reply output preserves repeated letters, spaces, and line feeds across both paths and idle polling", () => {
  const lesson = createTerminalLesson("reply");
  for (const character of "a cat aa\nAz0! ") {
    const value = character.charCodeAt(0);
    assert.equal(lesson.offerInput(value), true);
    for (let i = 0; i < (value === 97 ? 9 : 8); i++) lesson.step();
  }
  const output = lesson.terminalSnapshot();
  assert.deepEqual(output, { text: "A cAt AA\nAz0! ", retained: 14 });
  for (let i = 0; i < 12; i++) lesson.step();
  assert.deepEqual(lesson.terminalSnapshot(), output);
  const fresh = createTerminalLesson("reply");
  assert.deepEqual(fresh.terminalSnapshot(), { text: "", retained: 0 });
  assert.deepEqual(fresh.inputSnapshot(), { pendingByte: null });
  assert.equal(fresh.snapshot().pc, 0x100);
});

test("the reply guard protects every program byte and permits only instruction starts", () => {
  const lesson = createTerminalLesson("reply");
  for (let offset = 0; offset < 21; offset++) {
    const address = 0x100 + offset;
    const expected = lesson.ram.read(address);
    lesson.ram.write(address, expected ^ 0xff);
    const before = lesson.snapshot();
    assert.match(lesson.stepProblem()!, /from the reference card/);
    assert.throws(() => lesson.step(), /from the reference card/);
    assert.deepEqual(lesson.snapshot(), before);
    lesson.ram.write(address, expected);
  }
  for (let address = 0x100; address <= 0x115; address++) {
    for (let bit = 0; bit < 16; bit++) {
      if ((lesson.panel.switches ^ address) & (1 << bit)) lesson.panel.toggleSwitch(bit);
    }
    lesson.panel.examine();
    if ([0x100, 0x102, 0x104, 0x107, 0x109, 0x10b, 0x10e, 0x110, 0x112].includes(address)) {
      assert.equal(lesson.stepProblem(), undefined);
    } else assert.match(lesson.stepProblem()!, /only at instruction starts/);
  }
  assert.deepEqual(lesson.terminalSnapshot(), { text: "", retained: 0 });
});
