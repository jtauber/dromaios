import assert from "node:assert/strict";
import { test } from "node:test";
import { createTerminalLesson } from "../../site/interactive/terminal-lesson.js";
import { format8080Trace } from "../../site/interactive/instruction-trace.js";

const message = [72, 69, 76, 76, 79, 10];

function examine(lesson: ReturnType<typeof createTerminalLesson>, address: number): void {
  for (let bit = 0; bit < 16; bit++) {
    if ((lesson.panel.switches ^ address) & (1 << bit)) lesson.panel.toggleSwitch(bit);
  }
  lesson.panel.examine();
}

test("the message session follows HL through six bytes and retains the final HLT as an instruction", () => {
  const lesson = createTerminalLesson("message");
  assert.equal(lesson.startAddress, 0);
  assert.deepEqual(lesson.bytes, [0x21, 0, 1, 0x06, 6, 0x7e, 0xd3, 1, 0x23, 0x05, 0xc2, 5, 0, 0x76]);
  assert.deepEqual(message.map((_, i) => lesson.ram.read(0x100 + i)), message);
  assert.equal(lesson.inputSnapshot(), undefined);
  const pointer = lesson.step();
  assert.deepEqual([pointer.after.pc, pointer.after.hl, pointer.after.h, pointer.after.l, pointer.after.a], [3, 0x100, 1, 0, 0]);
  assert.match(format8080Trace(pointer, "LXI H,0100H"), /HL: 0000 → 0100/);
  const count = lesson.step();
  assert.deepEqual([count.after.pc, count.after.b], [5, 6]);
  assert.match(format8080Trace(count, "MVI B,06H"), /B: 0 → 6/);
  assert.deepEqual(lesson.terminalSnapshot(), { text: "", retained: 0 });
  for (const [index, value] of message.entries()) {
    const load = lesson.step();
    assert.equal(load.instruction.address, 5);
    assert.deepEqual(load.accesses, [{ kind: "read", address: 5, value: 0x7e }, { kind: "read", address: 0x100 + index, value }]);
    assert.deepEqual([load.after.a, load.after.hl, load.after.b], [value, 0x100 + index, 6 - index]);
    assert.equal(lesson.outputSnapshot()!.writes, index);
    const out = lesson.step();
    assert.deepEqual(out.accesses.at(-1), { kind: "output", port: 1, value });
    assert.equal(out.after.hl, 0x100 + index);
    assert.equal(out.after.b, 6 - index); // OUT does not decrement the counter.
    assert.deepEqual(lesson.terminalSnapshot(), { text: String.fromCharCode(...message.slice(0, index + 1)), retained: index + 1 });
    const advance = lesson.step();
    assert.deepEqual([advance.after.hl, advance.after.a, advance.after.b], [0x101 + index, value, 6 - index]);
    assert.deepEqual(advance.after.flags, advance.before.flags);
    const decrement = lesson.step();
    assert.deepEqual([decrement.after.b, decrement.after.flags.z], [5 - index, index === 5]);
    const branch = lesson.step();
    assert.equal(branch.after.pc, index === 5 ? 0x0d : 5);
    assert.equal(lesson.snapshot().halted, false);
  }
  const halt = lesson.step();
  assert.equal(halt.outcome, "halted");
  assert.deepEqual(halt.instruction, { address: 0x0d, bytes: [0x76] });
  assert.deepEqual(halt.accesses, [{ kind: "read", address: 0x0d, value: 0x76 }]);
  assert.deepEqual([halt.after.pc, halt.after.a, halt.after.b, halt.after.hl, halt.after.halted], [0x0e, 10, 0, 0x106, true]);
  assert.match(format8080Trace(halt, "HLT"), /000D: 76  HLT[\s\S]*PC: 000D → 000E[\s\S]*CPU: halted/);
  assert.deepEqual(lesson.outputSnapshot(), { lastByte: 10, writes: 6 });
  const state = lesson.snapshot();
  assert.match(lesson.stepProblem()!, /CPU is halted/);
  assert.throws(() => lesson.step(), /CPU is halted/);
  assert.deepEqual(lesson.snapshot(), state);
  examine(lesson, 0);
  assert.deepEqual(lesson.snapshot(), { ...state, pc: 0 });
  assert.match(lesson.stepProblem()!, /does not release HALT/);
  assert.deepEqual(lesson.terminalSnapshot(), { text: "HELLO\n", retained: 6 });
});

test("message edits after MOV change RAM without rewriting A, its captured read, or the following OUT", () => {
  const lesson = createTerminalLesson("message");
  lesson.step(); lesson.step();
  const load = lesson.step();
  const instruction = lesson.instructions.find(instruction => instruction.address === 5)!;
  const description = instruction.describe(load, 0);
  const trace = format8080Trace(load, "MOV A,M");
  examine(lesson, 0x100);
  for (let bit = 0; bit < 16; bit++) {
    if ((lesson.panel.switches ^ 0x4a) & (1 << bit)) lesson.panel.toggleSwitch(bit);
  }
  lesson.panel.deposit();
  assert.equal(lesson.ram.read(0x100), 74);
  assert.equal(lesson.snapshot().a, 72);
  assert.equal(lesson.snapshot().hl, 0x100);
  assert.match(lesson.stepProblem()!, /EXAMINE 0000/);
  examine(lesson, 6);
  assert.deepEqual(lesson.terminalSnapshot(), { text: "", retained: 0 });
  lesson.step();
  assert.equal(lesson.terminalSnapshot().text, "H");
  assert.equal(instruction.describe(load, 0), description);
  assert.equal(format8080Trace(load, "MOV A,M"), trace);
  assert.match(description, /Read 72 from RAM at 0100/);
  const fresh = createTerminalLesson("message");
  assert.equal(fresh.ram.read(0x100), 72);
  assert.deepEqual([fresh.snapshot().pc, fresh.snapshot().hl, fresh.snapshot().b, fresh.snapshot().halted], [0, 0, 0, false]);
  assert.deepEqual(fresh.terminalSnapshot(), { text: "", retained: 0 });
});

test("the counter still sends six edited bytes including zero, early LF, and non-ASCII values", () => {
  for (const values of [[74, 69, 76, 76, 79, 10], [0, 10, 128, 255, 60, 38]]) {
    const lesson = createTerminalLesson("message");
    values.forEach((value, i) => { lesson.ram.write(0x100 + i, value); });
    const sent: number[] = [];
    for (let step = 0; step < 33; step++) {
      for (const access of lesson.step().accesses) {
        if (access.kind === "output") sent.push(access.value);
        assert.notEqual(access.kind, "write");
      }
    }
    assert.deepEqual(sent, values);
    assert.deepEqual(lesson.terminalSnapshot(), {
      text: values[0] === 74 ? "JELLO\n" : "⟨NUL⟩\n⟨80 hex⟩⟨FF hex⟩<&", retained: 6,
    });
    assert.deepEqual([lesson.snapshot().b, lesson.snapshot().hl, lesson.snapshot().halted], [0, 0x106, true]);
  }
});

test("message guards check program bytes at 0000 while allowing message edits at 0100", () => {
  const lesson = createTerminalLesson("message");
  for (let address = 0; address < 14; address++) {
    const expected = lesson.ram.read(address);
    lesson.ram.write(address, expected ^ 0xff);
    const state = lesson.snapshot();
    assert.throws(() => lesson.step(), /from the reference card/);
    assert.deepEqual(lesson.snapshot(), state);
    lesson.ram.write(address, expected);
  }
  lesson.ram.write(0x100, 74);
  assert.equal(lesson.stepProblem(), undefined);
  for (let address = 0; address <= 14; address++) {
    examine(lesson, address);
    if ([0, 3, 5, 6, 8, 9, 10, 13].includes(address)) assert.equal(lesson.stepProblem(), undefined);
    else assert.match(lesson.stepProblem()!, /EXAMINE 0000.*only at instruction starts/);
  }
  assert.deepEqual(lesson.terminalSnapshot(), { text: "", retained: 0 });
});
