import assert from "node:assert/strict";
import { test } from "node:test";
import type { Cpu8080Access, Cpu8080Snapshot, Cpu8080StepRecord } from "../../../src/components/cpus/generated/8080-cpu.js";
import { create8080AltairBufferLesson } from "../../../src/machines/generated/8080/altair-buffer-lesson.js";

const initial: Cpu8080Snapshot = {
  a: 0, b: 0, c: 0, d: 0, e: 0, h: 0, l: 0, pc: 0, sp: 0, bc: 0, de: 0, hl: 0,
  flags: { s: false, z: false, ac: false, p: false, cy: false },
  interruptEnabled: false, interruptDeferred: false, halted: false,
};
// Independent transcription: collect with a capacity check; append NUL; rewind; print.
const program = [0x21, 0, 1, 0x06, 8, 0xdb, 0, 0xfe, 0, 0xca, 5, 0, 0xdb, 1, 0xfe, 10, 0xca, 0x19, 0,
  0x77, 0x23, 0x05, 0xc2, 5, 0, 0x3e, 0, 0x77, 0x21, 0, 1,
  0x7e, 0xfe, 0, 0xca, 0x2b, 0, 0xd3, 1, 0x23, 0xc3, 0x1f, 0, 0x76];
const readyFlags = { s: false, z: false, ac: true, p: false, cy: false };
const equalFlags = { s: false, z: true, ac: true, p: true, cy: false };
type Machine = ReturnType<typeof create8080AltairBufferLesson>;

function steps(machine: Machine, count: number): Cpu8080StepRecord[] {
  return Array.from({ length: count }, () => machine.cpu.step());
}

function expectedLetterAndLf(): Cpu8080StepRecord[] {
  let before = initial;
  const records: Cpu8080StepRecord[] = [];
  function step(bytes: number[], pc: number, changes: Partial<Cpu8080Snapshot> = {}, data: Cpu8080Access[] = []): void {
    const after = { ...before, pc, ...changes };
    records.push({ before, after, instruction: { address: before.pc, bytes },
      accesses: [...bytes.map((value, offset): Cpu8080Access => ({ kind: "read", address: before.pc + offset, value })), ...data],
      outcome: after.halted ? "halted" : "executed" });
    before = after;
  }
  function receive(value: number): void {
    step([0xdb, 0], 7, { a: 1 }, [{ kind: "input", port: 0, value: 1 }]);
    step([0xfe, 0], 9, { flags: readyFlags });
    step([0xca, 5, 0], 0x0c);
    step([0xdb, 1], 0x0e, { a: value }, [{ kind: "input", port: 1, value }]);
  }
  step([0x21, 0, 1], 3, { h: 1, hl: 0x100 });
  step([0x06, 8], 5, { b: 8, bc: 0x800 });
  receive(72);
  // H - LF is 3E: nonzero, positive, odd parity, auxiliary borrow, no full borrow.
  step([0xfe, 10], 0x10, { flags: { s: false, z: false, ac: false, p: false, cy: false } });
  step([0xca, 0x19, 0], 0x13);
  step([0x77], 0x14, {}, [{ kind: "write", address: 0x100, value: 72 }]);
  step([0x23], 0x15, { l: 1, hl: 0x101 });
  step([0x05], 0x16, { b: 7, bc: 0x700, flags: readyFlags });
  step([0xc2, 5, 0], 5);
  receive(10);
  step([0xfe, 10], 0x10, { flags: equalFlags });
  step([0xca, 0x19, 0], 0x19);
  step([0x3e, 0], 0x1b, { a: 0 });
  step([0x77], 0x1c, {}, [{ kind: "write", address: 0x101, value: 0 }]);
  step([0x21, 0, 1], 0x1f, { l: 0, hl: 0x100 });
  step([0x7e], 0x20, { a: 72 }, [{ kind: "read", address: 0x100, value: 72 }]);
  step([0xfe, 0], 0x22, { flags: { ...readyFlags, p: true } });
  step([0xca, 0x2b, 0], 0x25);
  step([0xd3, 1], 0x27, {}, [{ kind: "output", port: 1, value: 72 }]);
  step([0x23], 0x28, { l: 1, hl: 0x101 });
  step([0xc3, 0x1f, 0], 0x1f);
  step([0x7e], 0x20, { a: 0 }, [{ kind: "read", address: 0x101, value: 0 }]);
  step([0xfe, 0], 0x22, { flags: equalFlags });
  step([0xca, 0x2b, 0], 0x2b);
  step([0x76], 0x2c, { halted: true });
  return records;
}

test("the buffer factory has a complete fixed image, empty devices, and independent zeroed RAM", () => {
  const machine = create8080AltairBufferLesson({ output: () => assert.fail("Unexpected output") });
  assert.deepEqual(machine.cpu.snapshot(), initial);
  assert.deepEqual(machine.input.snapshot(), { pendingByte: null });
  assert.deepEqual(machine.output.snapshot(), { lastByte: null });
  assert.equal("endAddress" in machine, false);
  assert.equal(machine.ram.size, 0x10000);
  for (let address = 0; address < machine.ram.size; address++) assert.equal(machine.ram.read(address), program[address] ?? 0);
  machine.input.offer(65); machine.ram.write(0x100, 90);
  const fresh = create8080AltairBufferLesson({ output: () => assert.fail("Unexpected output") });
  assert.equal(fresh.ram.read(0x100), 0);
  assert.deepEqual(fresh.input.snapshot(), { pendingByte: null });
  assert.deepEqual(fresh.cpu.snapshot(), initial);
});

test("empty polling consumes no data or buffer slots and produces no writes", () => {
  const machine = create8080AltairBufferLesson({ output: () => assert.fail("Unexpected output") });
  steps(machine, 2);
  for (let trip = 0; trip < 3; trip++) {
    const records = steps(machine, 3);
    assert.deepEqual(records.map(record => record.before.pc), [5, 7, 9]);
    assert.deepEqual(records.flatMap(record => record.accesses).filter(access => access.kind !== "read"), [{ kind: "input", port: 0, value: 0 }]);
    assert.deepEqual([machine.cpu.snapshot().pc, machine.cpu.snapshot().hl, machine.cpu.snapshot().b], [5, 0x100, 8]);
    assert.deepEqual(machine.input.snapshot(), { pendingByte: null });
  }
});

test("H followed by LF records all 31 instructions, separate stores, pointer rewind, and playback", () => {
  const sent: number[] = [];
  const machine = create8080AltairBufferLesson({ output: value => { sent.push(value); } });
  machine.input.offer(72);
  const expected = expectedLetterAndLf();
  assert.equal(expected.length, 31);
  for (const [index, record] of expected.entries()) {
    if (index === 12) machine.input.offer(10);
    assert.deepEqual(machine.cpu.step(), record);
    assert.deepEqual(sent, index < 24 ? [] : [72]);
  }
  assert.deepEqual([machine.ram.read(0x100), machine.ram.read(0x101)], [72, 0]);
  assert.deepEqual(machine.input.snapshot(), { pendingByte: null });
  assert.deepEqual(machine.output.snapshot(), { lastByte: 72 });
  const state = expected.at(-1)!.after;
  assert.deepEqual(machine.cpu.step(), { before: state, after: state, instruction: null, accesses: [], outcome: "halted" });
});

test("every buffer length keeps the terminator in bounds and leaves later input pending during playback", () => {
  for (let length = 0; length <= 8; length++) {
    const sent: number[] = [];
    const machine = create8080AltairBufferLesson({ output: value => { sent.push(value); } });
    // Nonzero sentinels prove the terminator is actually stored, including at capacity.
    for (let address = 0xff; address <= 0x109; address++) machine.ram.write(address, 0xa5);
    const records = steps(machine, 2);
    for (let i = 0; i < length; i++) {
      assert.equal(machine.cpu.snapshot().pc, 5);
      machine.input.offer(65 + i);
      records.push(...steps(machine, 10));
    }
    if (length < 8) {
      machine.input.offer(10);
      records.push(...steps(machine, 6));
    }
    assert.equal(machine.cpu.snapshot().pc, 0x19);
    assert.deepEqual(sent, []);
    assert.equal(machine.cpu.snapshot().b, 8 - length);
    machine.input.offer(90); // A later byte must not become a ninth character or overwrite NUL.
    records.push(...steps(machine, 3 + 6 * length + 4));
    const characters = Array.from({ length }, (_, i) => 65 + i);
    assert.deepEqual(sent, characters);
    assert.equal(records.length, length === 8 ? 137 : 15 + 16 * length);
    assert.deepEqual(records.flatMap(record => record.accesses).filter(access => access.kind === "write"),
      [...characters, 0].map((value, i) => ({ kind: "write", address: 0x100 + i, value })));
    assert.equal(machine.ram.read(0xff), 0xa5);
    assert.equal(machine.ram.read(0x109), 0xa5);
    for (let i = length + 1; i < 9; i++) assert.equal(machine.ram.read(0x100 + i), 0xa5);
    assert.deepEqual(machine.input.snapshot(), { pendingByte: 90 });
    const state = machine.cpu.snapshot();
    assert.deepEqual([state.a, state.b, state.hl, state.pc, state.halted, state.flags.z], [0, 8 - length, 0x100 + length, 0x2c, true, true]);
  }
});

test("raw input treats only LF as the collection delimiter; a stored NUL ends readback early", () => {
  for (let value = 0; value <= 255; value++) {
    const sent: number[] = [];
    const machine = create8080AltairBufferLesson({ output: byte => { sent.push(byte); } });
    machine.input.offer(value); steps(machine, 2);
    if (value === 10) steps(machine, 6);
    else { steps(machine, 10); machine.input.offer(10); steps(machine, 6); }
    steps(machine, value === 0 || value === 10 ? 7 : 13);
    assert.deepEqual(sent, value === 0 || value === 10 ? [] : [value]);
    assert.equal(machine.cpu.snapshot().b, value === 10 ? 8 : 7);
    assert.equal(machine.ram.read(0x100), value === 10 ? 0 : value);
    assert.equal(machine.cpu.snapshot().halted, true);
  }
});

test("machine reset clears both devices and HALT without clearing the buffer, flags, or host output", () => {
  const sent: number[] = [];
  const machine = create8080AltairBufferLesson({ output: value => { sent.push(value); } });
  machine.input.offer(72); steps(machine, 12);
  machine.input.offer(10); steps(machine, 19);
  machine.input.offer(90);
  const state = machine.cpu.snapshot();
  machine.reset();
  assert.deepEqual(machine.cpu.snapshot(), { ...state, pc: 0, halted: false });
  assert.deepEqual(machine.input.snapshot(), { pendingByte: null });
  assert.deepEqual(machine.output.snapshot(), { lastByte: null });
  assert.deepEqual(sent, [72]);
  assert.equal(machine.ram.read(0x100), 72);
});
