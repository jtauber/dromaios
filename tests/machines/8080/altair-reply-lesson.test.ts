import assert from "node:assert/strict";
import { test } from "node:test";
import { create8080AltairReplyLesson } from "../../../src/machines/generated/8080/altair-reply-lesson.js";

const initial = {
  a: 0, b: 0, c: 0, d: 0, e: 0, h: 0, l: 0, pc: 0x100, sp: 0,
  bc: 0, de: 0, hl: 0,
  flags: { s: false, z: false, ac: false, p: false, cy: false },
  interruptEnabled: false, interruptDeferred: false, halted: false,
};
// Independent transcription: poll; receive; CPI 61; JNZ 0110; MVI A,41; OUT 1; JMP 0100.
const program = [0xdb, 0, 0xfe, 0, 0xca, 0, 1, 0xdb, 1, 0xfe, 0x61, 0xc2, 0x10, 1, 0x3e, 0x41, 0xd3, 1, 0xc3, 0, 1];
const readyFlags = { s: false, z: false, ac: true, p: false, cy: false };
const equalFlags = { s: false, z: true, ac: true, p: true, cy: false };
type Machine = ReturnType<typeof create8080AltairReplyLesson>;

function expectStep(machine: Machine, before: typeof initial, after: typeof initial, bytes: number[],
  transfer?: { kind: "input" | "output"; port: number; value: number }): void {
  assert.deepEqual(machine.cpu.step(), {
    before, after, outcome: "executed", instruction: { address: before.pc, bytes },
    accesses: [
      ...bytes.map((value, offset) => ({ kind: "read", address: before.pc + offset, value })),
      ...(transfer ? [transfer] : []),
    ],
  });
}

test("the reply machine starts with its complete fixed image and polls empty input without output", () => {
  const writes: number[] = [];
  const machine = create8080AltairReplyLesson({ output: value => { writes.push(value); } });
  assert.deepEqual(machine.cpu.snapshot(), initial);
  assert.equal("endAddress" in machine, false);
  assert.equal(machine.ram.size, 0x10000);
  for (let address = 0; address < machine.ram.size; address++) {
    assert.equal(machine.ram.read(address), program[address - 0x100] ?? 0, `address ${address}`);
  }
  const sampled = { ...initial, pc: 0x102 };
  const compared = { ...sampled, pc: 0x104, flags: equalFlags };
  expectStep(machine, initial, sampled, [0xdb, 0], { kind: "input", port: 0, value: 0 });
  expectStep(machine, sampled, compared, [0xfe, 0]);
  expectStep(machine, compared, { ...compared, pc: 0x100 }, [0xca, 0, 1]);
  assert.deepEqual(machine.input.snapshot(), { pendingByte: null });
  assert.deepEqual(machine.output.snapshot(), { lastByte: null });
  assert.deepEqual(writes, []);
});

test("the two reply paths preserve exact fetches, comparison flags, and separate pending input", () => {
  for (const value of [97, 98]) {
    const writes: number[] = [];
    const machine = create8080AltairReplyLesson({ output: value => { writes.push(value); } });
    machine.input.offer(value);
    const sampled = { ...initial, a: 1, pc: 0x102 };
    const ready = { ...sampled, pc: 0x104, flags: readyFlags };
    const continued = { ...ready, pc: 0x107 };
    const received = { ...continued, a: value, pc: 0x109 };
    const compared = { ...received, pc: 0x10b, flags: value === 97 ? equalFlags : readyFlags };
    expectStep(machine, initial, sampled, [0xdb, 0], { kind: "input", port: 0, value: 1 });
    assert.deepEqual(machine.input.snapshot(), { pendingByte: value });
    expectStep(machine, sampled, ready, [0xfe, 0]);
    expectStep(machine, ready, continued, [0xca, 0, 1]);
    expectStep(machine, continued, received, [0xdb, 1], { kind: "input", port: 1, value });
    assert.deepEqual(machine.input.snapshot(), { pendingByte: null });
    machine.input.offer(122); // A later arrival must not affect the comparison or reply.
    expectStep(machine, received, compared, [0xfe, 0x61]);
    const branched = { ...compared, pc: value === 97 ? 0x10e : 0x110 };
    expectStep(machine, compared, branched, [0xc2, 0x10, 1]);
    const sending = { ...branched, a: value === 97 ? 65 : value, pc: 0x110 };
    if (value === 97) expectStep(machine, branched, sending, [0x3e, 0x41]);
    assert.deepEqual(writes, []);
    assert.deepEqual(machine.output.snapshot(), { lastByte: null });
    const sent = { ...sending, pc: 0x112 };
    expectStep(machine, sending, sent, [0xd3, 1], { kind: "output", port: 1, value: sending.a });
    expectStep(machine, sent, { ...sent, pc: 0x100 }, [0xc3, 0, 1]);
    assert.deepEqual(machine.input.snapshot(), { pendingByte: 122 });
    assert.deepEqual(machine.output.snapshot(), { lastByte: sending.a });
    assert.deepEqual(writes, [sending.a]);
  }
});

test("every input byte is preserved except lowercase a, with no replacement fetch on the other path", () => {
  const writes: number[] = [];
  const machine = create8080AltairReplyLesson({ output: value => { writes.push(value); } });
  for (let value = 0; value <= 255; value++) {
    machine.input.offer(value);
    const path = value === 97
      ? [0x100, 0x102, 0x104, 0x107, 0x109, 0x10b, 0x10e, 0x110, 0x112]
      : [0x100, 0x102, 0x104, 0x107, 0x109, 0x10b, 0x110, 0x112];
    for (const pc of path) {
      assert.equal(machine.cpu.snapshot().pc, pc);
      const record = machine.cpu.step();
      assert.equal(record.outcome, "executed");
      if (pc === 0x109) {
        assert.equal(record.after.a, value);
        assert.equal(record.after.flags.z, value === 97);
      }
      if (pc !== 0x110) assert.ok(record.accesses.every(access => access.kind !== "output"));
      assert.ok(record.accesses.every(access => access.kind !== "write"));
    }
    assert.equal(machine.cpu.snapshot().pc, 0x100);
    assert.equal(writes.length, value + 1);
    assert.equal(writes.at(-1), value === 97 ? 65 : value);
  }
  assert.deepEqual(program.map((_, i) => machine.ram.read(0x100 + i)), program);
});

test("machine reset clears both devices without sending output or reloading RAM", () => {
  const writes: number[] = [];
  const machine = create8080AltairReplyLesson({ output: value => { writes.push(value); } });
  machine.input.offer(97);
  for (let i = 0; i < 8; i++) machine.cpu.step();
  machine.input.offer(98);
  machine.ram.write(1, 42);
  machine.reset();
  assert.deepEqual(machine.cpu.snapshot(), { ...initial, a: 65, flags: equalFlags, pc: 0 });
  assert.deepEqual(machine.input.snapshot(), { pendingByte: null });
  assert.deepEqual(machine.output.snapshot(), { lastByte: null });
  assert.deepEqual(writes, [65]);
  assert.equal(machine.ram.read(1), 42);
});
