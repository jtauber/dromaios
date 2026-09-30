import assert from "node:assert/strict";
import { test } from "node:test";
import { createTerminalLesson, terminalOutputLimit } from "../../site/interactive/terminal-lesson.js";
import { format8080Trace } from "../../site/interactive/instruction-trace.js";

type Lesson = ReturnType<typeof createTerminalLesson>;
function until(lesson: Lesson, ready: () => boolean): void {
  for (let count = 0; !ready(); count++) {
    assert.ok(count < 2000, "The next lesson boundary should be reachable");
    lesson.step();
  }
}
function send(lesson: Lesson, value: number): void {
  assert.equal(lesson.offerInput(value), true);
  until(lesson, () => lesson.inputSnapshot()!.pendingByte === null && lesson.snapshot().pc === 0x5b);
}
function start(): Lesson {
  const lesson = createTerminalLesson("command-prompt");
  until(lesson, () => lesson.snapshot().pc === 0x5b);
  return lesson;
}

test("the prompt's receive, store, and echo are separate steps with immutable captured explanations", () => {
  const lesson = start();
  const before = lesson.snapshot();
  assert.deepEqual(lesson.terminalSnapshot(), { text: "> ", retained: 2 });
  assert.equal(lesson.offerInput(72), true);
  assert.equal(lesson.offerInput(63), false);
  assert.deepEqual(lesson.snapshot(), before);
  until(lesson, () => lesson.snapshot().pc === 0x16);
  assert.equal(lesson.snapshot().a, 72);
  assert.equal(lesson.ram.read(0x100), 0);
  assert.equal(lesson.terminalSnapshot().text, "> ");
  lesson.offerInput(10);
  const record = lesson.step();
  assert.deepEqual([record.after.a, record.after.b, record.after.hl], [72, 8, 0x100]);
  const instruction = lesson.instructions.find(instruction => instruction.address === 0x16)!;
  const description = instruction.describe(record, 0);
  const trace = format8080Trace(record, "MOV M,A");
  assert.match(description, /Wrote 72 from A to RAM at 0100/);
  assert.match(trace, /Write 0100: 48/);
  assert.equal(lesson.terminalSnapshot().text, "> ");
  lesson.ram.write(0x100, 63);
  const echo = lesson.step();
  assert.deepEqual(echo.accesses.at(-1), { kind: "output", port: 1, value: 72 });
  assert.equal(lesson.terminalSnapshot().text, "> H");
  until(lesson, () => lesson.snapshot().pc === 0x3b);
  lesson.step(); // Dispatch reads the edited ? from RAM, not the offered or echoed H.
  assert.equal(lesson.snapshot().a, 63);
  until(lesson, () => lesson.snapshot().pc === 0x5b);
  assert.equal(lesson.terminalSnapshot().text, "> H\nH=HELLO ?=HELP\n> ");
  assert.equal(instruction.describe(record, 0), description);
  assert.equal(format8080Trace(record, "MOV M,A"), trace);
});

test("edits after a command read do not replace A, while the selected reply still reads live message RAM", () => {
  const lesson = start();
  send(lesson, 72);
  lesson.offerInput(10);
  until(lesson, () => lesson.snapshot().pc === 0x3b);
  const read = lesson.step();
  const instruction = lesson.instructions.find(instruction => instruction.address === 0x3b)!;
  const description = instruction.describe(read, 0);
  assert.equal(read.after.a, 72);
  lesson.ram.write(0x100, 63);
  lesson.ram.write(0x130, 74);
  until(lesson, () => lesson.snapshot().pc === 0x5b);
  assert.equal(lesson.terminalSnapshot().text, "> H\nJELLO\n> ");
  assert.equal(instruction.describe(read, 0), description);
  assert.match(description, /Read 72 from RAM at 0100/);
  assert.equal(lesson.snapshot().sp, 0x1fe);
});

test("successive commands retain only actual output bytes and keep bounded display history", () => {
  const lesson = start();
  const count = 40;
  for (let index = 0; index < count; index++) { send(lesson, 72); send(lesson, 10); }
  const text = "> " + "H\nHELLO\n> ".repeat(count);
  assert.deepEqual(lesson.terminalSnapshot(), { text: text.slice(-terminalOutputLimit), retained: terminalOutputLimit });
  assert.equal(lesson.outputSnapshot()!.writes, text.length);
  assert.deepEqual(lesson.inputSnapshot(), { pendingByte: null });
  assert.equal(lesson.snapshot().halted, false);
  assert.equal(lesson.stepProblem(), undefined);
});

test("the command prompt guards all 116 program bytes and 52 starts while allowing data edits", () => {
  const lesson = createTerminalLesson("command-prompt");
  assert.equal(lesson.startAddress, 0);
  assert.equal(lesson.bytes.length, 116);
  assert.equal(lesson.instructions.length, 52);
  for (let address = 0; address < 116; address++) {
    const expected = lesson.ram.read(address);
    lesson.ram.write(address, expected ^ 0xff);
    const state = lesson.snapshot();
    assert.throws(() => lesson.step(), /from the reference card/);
    assert.deepEqual(lesson.snapshot(), state);
    lesson.ram.write(address, expected);
  }
  for (const address of [0x100, 0x108, 0x120, 0x130, 0x140, 0x160, 0x1fc, 0x1ff]) lesson.ram.write(address, 42);
  const starts = [0, 3, 6, 9, 12, 14, 17, 19, 22, 23, 25, 26, 27, 30, 33, 35, 38, 40, 41, 43, 45, 46,
    48, 51, 53, 56, 59, 60, 62, 65, 67, 70, 73, 76, 79, 82, 85, 88, 91, 93, 95, 98, 100, 101, 102, 103, 105, 108, 110, 111, 114, 115];
  for (let address = 0; address <= 116; address++) {
    for (let bit = 0; bit < 16; bit++) if ((lesson.panel.switches ^ address) & (1 << bit)) lesson.panel.toggleSwitch(bit);
    lesson.panel.examine();
    if (starts.includes(address)) assert.equal(lesson.stepProblem(), undefined);
    else assert.match(lesson.stepProblem()!, /only at instruction starts/);
  }
  assert.equal(lesson.outputSnapshot()!.writes, 0);
});
