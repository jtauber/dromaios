import assert from "node:assert/strict";
import { test } from "node:test";
import type { Cpu8080Access, Cpu8080Snapshot, Cpu8080StepRecord } from "../../../src/components/cpus/generated/8080-cpu.js";
import { create8080AltairTerminatedMessageLesson } from "../../../src/machines/generated/8080/altair-terminated-message-lesson.js";

const initial: Cpu8080Snapshot = {
  a: 0, b: 0, c: 0, d: 0, e: 0, h: 0, l: 0, pc: 0, sp: 0, bc: 0, de: 0, hl: 0,
  flags: { s: false, z: false, ac: false, p: false, cy: false },
  interruptEnabled: false, interruptDeferred: false, halted: false,
};
// Independent transcription: LXI; MOV; CPI; JZ HLT; OUT; INX; JMP MOV; HLT.
const program = [0x21, 0, 1, 0x7e, 0xfe, 0, 0xca, 0x0f, 0, 0xd3, 1, 0x23, 0xc3, 3, 0, 0x76];
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
  step([0x21, 0, 1], 3, { h: 1, hl: 0x100 });
  // Literal CPI 0 parity results for H, E, L, L, O, LF, NUL. A is preserved.
  const parity = [true, false, false, false, false, true, true];
  for (const [index, value] of message.entries()) {
    step([0x7e], 4, { a: value }, [{ kind: "read", address: 0x100 + index, value }]);
    step([0xfe, 0], 6, { flags: { s: false, z: value === 0, ac: true, p: parity[index]!, cy: false } });
    step([0xca, 0x0f, 0], value === 0 ? 0x0f : 9);
    if (value === 0) break;
    step([0xd3, 1], 0x0b, {}, [{ kind: "output", port: 1, value }]);
    step([0x23], 0x0c, { l: index + 1, hl: 0x101 + index });
    step([0xc3, 3, 0], 3);
  }
  step([0x76], 0x10, { halted: true });
  return records;
}

test("the terminated-message factory has its complete image, zero initial state, and independent components", () => {
  const sent: number[] = [];
  const machine = create8080AltairTerminatedMessageLesson({ output: value => { sent.push(value); } });
  assert.deepEqual(machine.cpu.snapshot(), initial);
  assert.deepEqual(machine.output.snapshot(), { lastByte: null });
  assert.deepEqual(sent, []);
  assert.equal("endAddress" in machine, false);
  assert.equal("input" in machine, false);
  const image = new Uint8Array(0x10000);
  image.set(program); image.set(message, 0x100);
  assert.equal(machine.ram.size, image.length);
  for (const [address, value] of image.entries()) assert.equal(machine.ram.read(address), value, `RAM ${address}`);
  machine.ram.write(0x100, 0);
  machine.ports.writePort(1, 65);
  const fresh = create8080AltairTerminatedMessageLesson({ output: () => assert.fail("Unexpected output") });
  assert.equal(fresh.ram.read(0x100), 72);
  assert.deepEqual(fresh.cpu.snapshot(), initial);
  assert.deepEqual(fresh.output.snapshot(), { lastByte: null });
});

test("the terminated message records all 41 instructions and reads but never outputs NUL", () => {
  const sent: number[] = [];
  const machine = create8080AltairTerminatedMessageLesson({ output: value => { sent.push(value); } });
  const expected = expectedRecords();
  assert.equal(expected.length, 41);
  for (const record of expected) assert.deepEqual(machine.cpu.step(), record);
  assert.deepEqual(sent, [72, 69, 76, 76, 79, 10]);
  assert.deepEqual(machine.output.snapshot(), { lastByte: 10 });
  assert.deepEqual(program.map((_, i) => machine.ram.read(i)), program);
  assert.deepEqual(message.map((_, i) => machine.ram.read(0x100 + i)), message);
  const state = expected.at(-1)!.after;
  assert.deepEqual(machine.cpu.step(), { before: state, after: state, instruction: null, accesses: [], outcome: "halted" });
  assert.equal(sent.length, 6);
});

test("only zero terminates: every other byte, including LF and the character 0, is output once", () => {
  for (let value = 0; value <= 255; value++) {
    const sent: number[] = [];
    const machine = create8080AltairTerminatedMessageLesson({ output: byte => { sent.push(byte); } });
    machine.ram.write(0x100, value);
    machine.ram.write(0x101, 0);
    const path = value === 0 ? [0, 3, 4, 6, 15] : [0, 3, 4, 6, 9, 11, 12, 3, 4, 6, 15];
    const reads: number[] = [];
    for (const pc of path) {
      assert.equal(machine.cpu.snapshot().pc, pc);
      const record = machine.cpu.step();
      for (const access of record.accesses) {
        assert.notEqual(access.kind, "write");
        if (access.kind === "read" && access.address >= 0x100) reads.push(access.address);
      }
    }
    assert.deepEqual(sent, value === 0 ? [] : [value]);
    assert.deepEqual(reads, value === 0 ? [0x100] : [0x100, 0x101]);
    const state = machine.cpu.snapshot();
    assert.deepEqual([state.a, state.b, state.hl, state.pc, state.flags.z, state.halted], [0, 0, value === 0 ? 0x100 : 0x101, 0x10, true, true]);
  }
});

test("machine reset releases HALT and clears the output latch while preserving data, flags, and RAM", () => {
  const sent: number[] = [];
  const machine = create8080AltairTerminatedMessageLesson({ output: value => { sent.push(value); } });
  for (let i = 0; i < 41; i++) machine.cpu.step();
  const state = machine.cpu.snapshot();
  machine.ram.write(0x102, 0);
  machine.reset();
  assert.deepEqual(machine.cpu.snapshot(), { ...state, pc: 0, halted: false });
  assert.deepEqual(machine.output.snapshot(), { lastByte: null });
  assert.deepEqual(sent, [72, 69, 76, 76, 79, 10]);
  assert.equal(machine.ram.read(0x102), 0);
});
