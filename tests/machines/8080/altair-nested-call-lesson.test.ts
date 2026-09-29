import assert from "node:assert/strict";
import { test } from "node:test";
import type { Cpu8080Access, Cpu8080Snapshot, Cpu8080StepRecord } from "../../../src/components/cpus/generated/8080-cpu.js";
import { create8080AltairNestedCallLesson } from "../../../src/machines/generated/8080/altair-nested-call-lesson.js";

const initial: Cpu8080Snapshot = {
  a: 0, b: 0, c: 0, d: 0, e: 0, h: 0, l: 0, pc: 0, sp: 0, bc: 0, de: 0, hl: 0,
  flags: { s: false, z: false, ac: false, p: false, cy: false },
  interruptEnabled: false, interruptDeferred: false, halted: false,
};
// Independent transcription: initialize SP, call twice, halt; a printing routine calling a character routine.
const program = [0x31, 0, 2, 0xcd, 10, 0, 0xcd, 10, 0, 0x76,
  0x21, 0, 1, 0x7e, 0xfe, 0, 0xca, 26, 0, 0xcd, 27, 0, 0x23, 0xc3, 13, 0, 0xc9, 0xd3, 1, 0xc9];
const message = [72, 69, 76, 76, 79, 10, 0];

function expectedRecords(): Cpu8080StepRecord[] {
  let before = initial;
  const records: Cpu8080StepRecord[] = [];
  function step(bytes: number[], pc: number, changes: Partial<Cpu8080Snapshot> = {}, data: Cpu8080Access[] = []): void {
    const after = { ...before, pc, ...changes };
    records.push({ before, after, instruction: { address: before.pc, bytes },
      accesses: [...bytes.map((value, offset): Cpu8080Access => ({ kind: "read", address: before.pc + offset, value })), ...data],
      outcome: after.halted ? "halted" : "executed" });
    before = after;
  }
  step([0x31, 0, 2], 3, { sp: 0x200 });
  for (const continuation of [6, 9]) {
    step([0xcd, 10, 0], 10, { sp: 0x1fe }, [
      { kind: "write", address: 0x1ff, value: 0 },
      { kind: "write", address: 0x1fe, value: continuation },
    ]);
    step([0x21, 0, 1], 13, { h: 1, l: 0, hl: 0x100 });
    const parity = [true, false, false, false, false, true, true];
    for (const [index, value] of message.entries()) {
      step([0x7e], 14, { a: value }, [{ kind: "read", address: 0x100 + index, value }]);
      step([0xfe, 0], 16, { flags: { s: false, z: value === 0, ac: true, p: parity[index]!, cy: false } });
      step([0xca, 26, 0], value === 0 ? 26 : 19);
      if (value === 0) break;
      step([0xcd, 27, 0], 27, { sp: 0x1fc }, [
        { kind: "write", address: 0x1fd, value: 0 }, { kind: "write", address: 0x1fc, value: 22 },
      ]);
      step([0xd3, 1], 29, {}, [{ kind: "output", port: 1, value }]);
      step([0xc9], 22, { sp: 0x1fe }, [
        { kind: "read", address: 0x1fc, value: 22 }, { kind: "read", address: 0x1fd, value: 0 },
      ]);
      step([0x23], 23, { l: index + 1, hl: 0x101 + index });
      step([0xc3, 13, 0], 13);
    }
    step([0xc9], continuation, { sp: 0x200 }, [
      { kind: "read", address: 0x1fe, value: continuation },
      { kind: "read", address: 0x1ff, value: 0 },
    ]);
  }
  step([0x76], 10, { halted: true });
  return records;
}

test("the nested-call factory loads both routines and message with zeroed stack RAM and independent state", () => {
  const machine = create8080AltairNestedCallLesson({ output: () => assert.fail("Unexpected output") });
  assert.deepEqual(machine.cpu.snapshot(), initial);
  assert.deepEqual(machine.output.snapshot(), { lastByte: null });
  assert.equal("endAddress" in machine, false);
  assert.equal("input" in machine, false);
  const image = new Uint8Array(0x10000);
  image.set(program); image.set(message, 0x100);
  assert.equal(machine.ram.size, image.length);
  for (const [address, value] of image.entries()) assert.equal(machine.ram.read(address), value, `RAM ${address}`);
  machine.ram.write(0x1fe, 90); machine.ram.write(0x100, 0);
  const fresh = create8080AltairNestedCallLesson({ output: () => assert.fail("Unexpected output") });
  assert.equal(fresh.ram.read(0x1fe), 0);
  assert.equal(fresh.ram.read(0x100), 72);
  assert.deepEqual(fresh.cpu.snapshot(), initial);
});

test("both levels of calls independently match all 110 instruction records, stack accesses, and output transfers", () => {
  const sent: number[] = [];
  const machine = create8080AltairNestedCallLesson({ output: value => { sent.push(value); } });
  const records = expectedRecords();
  assert.equal(records.length, 110);
  const expectedOutput: number[] = [];
  for (const record of records) {
    assert.deepEqual(machine.cpu.step(), record);
    for (const access of record.accesses) if (access.kind === "output") expectedOutput.push(access.value);
    assert.deepEqual(sent, expectedOutput); // Only OUT changes the host's display history.
  }
  assert.deepEqual(sent, [72, 69, 76, 76, 79, 10, 72, 69, 76, 76, 79, 10]);
  assert.deepEqual(program.map((_, i) => machine.ram.read(i)), program);
  assert.deepEqual(message.map((_, i) => machine.ram.read(0x100 + i)), message);
  assert.deepEqual([0x1fc, 0x1fd, 0x1fe, 0x1ff].map(address => machine.ram.read(address)), [22, 0, 9, 0]);
  const state = records.at(-1)!.after;
  assert.deepEqual(machine.cpu.step(), { before: state, after: state, instruction: null, accesses: [], outcome: "halted" });
  assert.equal(sent.length, 12);
});

test("short messages reuse the inner pair, and an empty message never calls the character routine", () => {
  for (let ending = 0; ending <= 6; ending++) {
    const sent: number[] = [];
    const machine = create8080AltairNestedCallLesson({ output: value => { sent.push(value); } });
    machine.ram.write(0x100 + ending, 0);
    for (let address = 0x1fb; address <= 0x200; address++) machine.ram.write(address, 0xa5);
    const records = Array.from({ length: 14 + 16 * ending }, () => machine.cpu.step());
    assert.deepEqual(sent, [...message.slice(0, ending), ...message.slice(0, ending)]);
    const expectedWrites = [6, 9].flatMap(continuation => [
      { kind: "write", address: 0x1ff, value: 0 }, { kind: "write", address: 0x1fe, value: continuation },
      ...Array.from({ length: ending }, () => [
        { kind: "write", address: 0x1fd, value: 0 }, { kind: "write", address: 0x1fc, value: 22 },
      ]).flat(),
    ]);
    assert.deepEqual(records.flatMap(record => record.accesses).filter(access => access.kind === "write"), expectedWrites);
    assert.deepEqual([machine.ram.read(0x1fc), machine.ram.read(0x1fd)], ending ? [22, 0] : [0xa5, 0xa5]);
    assert.deepEqual([machine.ram.read(0x1fb), machine.ram.read(0x200)], [0xa5, 0xa5]);
    const { a, hl, sp, pc, halted } = machine.cpu.snapshot();
    assert.deepEqual([a, hl, sp, pc, halted], [0, 0x100 + ending, 0x200, 10, true]);
  }
});

test("machine reset releases HALT but preserves SP, saved bytes, the message, and host output", () => {
  const sent: number[] = [];
  const machine = create8080AltairNestedCallLesson({ output: value => { sent.push(value); } });
  for (let i = 0; i < 110; i++) machine.cpu.step();
  const state = machine.cpu.snapshot();
  machine.reset();
  assert.deepEqual(machine.cpu.snapshot(), { ...state, pc: 0, halted: false });
  assert.deepEqual(machine.output.snapshot(), { lastByte: null });
  assert.deepEqual([0x1fc, 0x1fd, 0x1fe, 0x1ff].map(address => machine.ram.read(address)), [22, 0, 9, 0]);
  assert.equal(machine.ram.read(0x100), 72);
  assert.equal(sent.length, 12);
});
