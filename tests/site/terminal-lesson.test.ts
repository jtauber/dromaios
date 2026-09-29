import assert from "node:assert/strict";
import { test } from "node:test";
import { createTerminalLesson, describeCharacterByte, terminalOutputLimit } from "../../site/interactive/terminal-lesson.js";

function echo(lesson: ReturnType<typeof createTerminalLesson>, value: number): void {
  assert.equal(lesson.snapshot().pc, 0x100);
  assert.equal(lesson.offerInput(value), true);
  for (let i = 0; i < 6; i++) assert.equal(lesson.step().outcome, "executed");
}

test("the terminal uses the unchanged polling program and appends only actual OUT transfers", () => {
  const lesson = createTerminalLesson();
  assert.deepEqual(lesson.bytes, [0xdb, 0, 0xfe, 0, 0xca, 0, 1, 0xdb, 1, 0xd3, 1, 0xc3, 0, 1]);
  assert.deepEqual(lesson.terminalSnapshot(), { text: "", retained: 0 });
  assert.equal(lesson.offerInput(65), true);
  assert.equal(lesson.offerInput(66), false);
  for (let i = 0; i < 3; i++) lesson.step();
  assert.equal(lesson.snapshot().a, 1);
  assert.deepEqual(lesson.inputSnapshot(), { pendingByte: 65 });
  lesson.step(); // IN data consumes A, but the display is still empty.
  assert.deepEqual(lesson.terminalSnapshot(), { text: "", retained: 0 });
  assert.deepEqual(lesson.outputSnapshot(), { lastByte: null, writes: 0 });
  assert.equal(lesson.snapshot().a, 65);
  lesson.offerInput(66);
  const output = lesson.step();
  assert.deepEqual(output.accesses.at(-1), { kind: "output", port: 1, value: 65 });
  assert.deepEqual(lesson.terminalSnapshot(), { text: "A", retained: 1 });
  assert.deepEqual(lesson.inputSnapshot(), { pendingByte: 66 });
  lesson.step(); // JMP, then receive and echo B.
  for (let i = 0; i < 6; i++) lesson.step();
  const captured = lesson.terminalSnapshot();
  echo(lesson, 66); // Equal consecutive output bytes must not be collapsed.
  assert.deepEqual(lesson.terminalSnapshot(), { text: "ABB", retained: 3 });
  assert.deepEqual(captured, { text: "AB", retained: 2 });
  for (let i = 0; i < 15; i++) {
    lesson.terminalSnapshot(); lesson.stepProblem(); lesson.step();
  }
  assert.deepEqual(lesson.terminalSnapshot(), { text: "ABB", retained: 3 });
  assert.deepEqual(lesson.outputSnapshot(), { lastByte: 66, writes: 3 });
  assert.equal(lesson.ram.read(1), 0);
});

test("spaces, line feeds, and repeated characters are retained in order without interpreting text as markup", () => {
  const lesson = createTerminalLesson();
  for (const value of [72, 105, 32, 65, 65, 10, 60, 38, 62, 10]) echo(lesson, value);
  assert.deepEqual(lesson.terminalSnapshot(), { text: "Hi AA\n<&>\n", retained: 10 });
  assert.deepEqual(lesson.outputSnapshot(), { lastByte: 10, writes: 10 });
  assert.equal(describeCharacterByte(32), "Space · 32 decimal · 20 hex");
  assert.equal(describeCharacterByte(10), "LF · 10 decimal · 0A hex");
});

test("other controls and non-ASCII bytes become visible labels instead of actions or guessed characters", () => {
  const lesson = createTerminalLesson();
  for (const value of [0, 7, 8, 12, 13, 27, 127, 128, 255]) echo(lesson, value);
  assert.deepEqual(lesson.terminalSnapshot(), { text: "⟨NUL⟩⟨BEL⟩⟨BS⟩⟨FF⟩⟨CR⟩⟨ESC⟩⟨DEL⟩⟨80 hex⟩⟨FF hex⟩", retained: 9 });
  assert.equal(describeCharacterByte(0), "NUL · 0 decimal · 00 hex");
  assert.equal(describeCharacterByte(48), "“0” · 48 decimal · 30 hex");
  assert.equal(describeCharacterByte(128), "Outside ASCII · 128 decimal · 80 hex");
});

test("the display retains only the last 256 output bytes while keeping the lifetime write count", () => {
  const lesson = createTerminalLesson();
  const sent: number[] = [];
  assert.equal(terminalOutputLimit, 256);
  for (let i = 0; i < 280; i++) {
    const value = 32 + i % 95;
    sent.push(value);
    echo(lesson, value);
  }
  assert.deepEqual(lesson.terminalSnapshot(), { text: String.fromCharCode(...sent.slice(-256)), retained: 256 });
  assert.equal(lesson.outputSnapshot()!.writes, 280);
  const fresh = createTerminalLesson();
  assert.deepEqual(fresh.terminalSnapshot(), { text: "", retained: 0 });
  assert.deepEqual(fresh.inputSnapshot(), { pendingByte: null });
  assert.deepEqual(fresh.outputSnapshot(), { lastByte: null, writes: 0 });
  assert.equal(lesson.terminalSnapshot().retained, 256);
});
