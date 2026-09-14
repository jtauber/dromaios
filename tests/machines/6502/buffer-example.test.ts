import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu6502 } from "../../../src/components/cpus/6502.js";
import type { Cpu6502Flags, Cpu6502MemoryAccess, Cpu6502Snapshot, Cpu6502StepRecord } from "../../../src/components/cpus/6502.js";
import type { Ram } from "../../../src/components/memory/ram.js";
import { create6502BufferExample, create6502BufferExampleMemory } from "../../../src/machines/generated/6502/buffer-example.js";
import { runCpu } from "../../../src/runtime/run-cpu.js";

function expectedInitialState(): Cpu6502Snapshot {
  return { a: 0x11, x: 0x22, y: 0x33, pc: 0x0200, sp: 1,
    flags: { n: false, v: true, d: false, i: false, z: true, c: true } };
}

function checkMemory(ram: Ram, finished: boolean): void {
  // Independently transcribed program and result image; no bytes imported from the factory.
  const expected = new Uint8Array(0x10000);
  expected.set([
    0xa2, 0, 0xa0, 0, 0xb1, 0xff, 0x20, 0x40, 2, 0x9d, 0xfe, 0x40,
    0xc9, 0xa4, 0x90, 3, 0x8e, 0x80, 0, 0xe8, 0xc8, 0x98, 0xc9, 4,
    0xd0, 0xea, 0x8c, 0x81, 0, 0xae, 0x80, 0, 0xac, 0x81, 0, 0xbd, 0xfe, 0x40, 0x4c, 0x50, 2,
  ], 0x0200);
  expected.set([0x29, 0x0f, 0x49, 3, 0x09, 0xa0, 0x18, 0x69, 1, 0x60], 0x0240);
  expected.set([0xaa, 1, 0x82, 3, 0x84, 0x55], 0x30fd);
  expected.set(finished ? [0xaa, 0xa3, 0xa2, 0xa1, 0xa8, 0x55] : [0xaa, 0xcc, 0xcc, 0xcc, 0xcc, 0x55], 0x40fd);
  expected.set([0xaa, finished ? 3 : 0xee, finished ? 4 : 0xcc, 0x55], 0x7f);
  expected[0] = 0x30;
  expected[0xff] = 0xfe;
  expected[0x1ff] = 0x5a;
  expected.set([0, 2], 0xfffc);
  if (finished) expected.set([8, 2], 0x100);
  assert.equal(ram.size, expected.length);
  for (const [address, byte] of expected.entries()) assert.equal(ram.read(address), byte, `memory at ${address}`);
}

function expectedRecords(): readonly Cpu6502StepRecord[] {
  const read = (address: number, value: number): Cpu6502MemoryAccess => ({ kind: "read", address, value });
  const write = (address: number, value: number): Cpu6502MemoryAccess => ({ kind: "write", address, value });
  const records: Cpu6502StepRecord[] = [];
  let state = expectedInitialState();
  const append = (bytes: readonly number[], pc: number,
    changes: Partial<Omit<Cpu6502Snapshot, "flags">> & { flags?: Partial<Cpu6502Flags> } = {},
    data: readonly Cpu6502MemoryAccess[] = [], accesses?: readonly Cpu6502MemoryAccess[]) => {
    const before = state;
    state = { ...before, ...changes, pc, flags: { ...before.flags, ...changes.flags } };
    records.push({ instruction: { address: before.pc, bytes }, before, after: state, outcome: "executed",
      accesses: accesses ?? [...bytes.map((value, offset) => read(before.pc + offset, value)), ...data] });
  };
  append([0xa2, 0], 0x0202, { x: 0, flags: { n: false, z: true } });
  append([0xa0, 0], 0x0204, { y: 0, flags: { n: false, z: true } });
  // Per-iteration values calculated in the specification, not by running a second decoder.
  const iterations = [
    { index: 0, source: 0x30fe, target: 0x40fe, input: 1, masked: 1, toggled: 2, tagged: 0xa2, output: 0xa3 },
    { index: 1, source: 0x30ff, target: 0x40ff, input: 0x82, masked: 2, toggled: 1, tagged: 0xa1, output: 0xa2 },
    { index: 2, source: 0x3100, target: 0x4100, input: 3, masked: 3, toggled: 0, tagged: 0xa0, output: 0xa1 },
    { index: 3, source: 0x3101, target: 0x4101, input: 0x84, masked: 4, toggled: 7, tagged: 0xa7, output: 0xa8 },
  ];
  for (const row of iterations) {
    const last = row.index === 3;
    append([0xb1, 0xff], 0x0206, { a: row.input, flags: { n: row.input >= 128, z: false } },
      [read(0xff, 0xfe), read(0, 0x30), read(row.source, row.input)]);
    append([0x20, 0x40, 2], 0x0240, { sp: 0xff }, [],
      [read(0x0206, 0x20), read(0x0207, 0x40), write(0x0101, 2), write(0x0100, 8), read(0x0208, 2)]);
    append([0x29, 0x0f], 0x0242, { a: row.masked, flags: { n: false, z: false } });
    append([0x49, 3], 0x0244, { a: row.toggled, flags: { n: false, z: row.index === 2 } });
    append([0x09, 0xa0], 0x0246, { a: row.tagged, flags: { n: true, z: false } });
    append([0x18], 0x0247, { flags: { c: false } });
    append([0x69, 1], 0x0249, { a: row.output, flags: { n: true, v: false, z: false, c: false } });
    append([0x60], 0x0209, { sp: 1 }, [read(0x0100, 8), read(0x0101, 2)]);
    append([0x9d, 0xfe, 0x40], 0x020c, {}, [write(row.target, row.output)]);
    append([0xc9, 0xa4], 0x020e, { flags: { n: !last, z: false, c: last } });
    append([0x90, 3], last ? 0x0210 : 0x0213);
    if (last) append([0x8e, 0x80, 0], 0x0213, {}, [write(0x80, 3)]);
    append([0xe8], 0x0214, { x: row.index + 1, flags: { n: false, z: false } });
    append([0xc8], 0x0215, { y: row.index + 1, flags: { n: false, z: false } });
    append([0x98], 0x0216, { a: row.index + 1, flags: { n: false, z: false } });
    append([0xc9, 4], 0x0218, { flags: { n: !last, z: last, c: last } });
    append([0xd0, 0xea], last ? 0x021a : 0x0204);
  }
  append([0x8c, 0x81, 0], 0x021d, {}, [write(0x81, 4)]);
  append([0xae, 0x80, 0], 0x0220, { x: 3, flags: { n: false, z: false } }, [read(0x80, 3)]);
  append([0xac, 0x81, 0], 0x0223, { y: 4, flags: { n: false, z: false } }, [read(0x81, 4)]);
  append([0xbd, 0xfe, 0x40], 0x0226, { a: 0xa8, flags: { n: true, z: false } }, [read(0x4101, 0xa8)]);
  append([0x4c, 0x50, 2], 0x0250);
  return records;
}

test("6502 buffer factories provide fresh state, independent RAM, and the complete image", () => {
  const first = create6502BufferExample();
  assert.deepEqual(first.cpu.snapshot(), expectedInitialState());
  assert.equal(first.endAddress, 0x0250);
  checkMemory(first.ram, false);
  runCpu(first.cpu, { maxSteps: 72, endAddress: first.endAddress });
  const fresh = create6502BufferExample();
  assert.notStrictEqual(fresh.cpu, first.cpu);
  assert.notStrictEqual(fresh.ram, first.ram);
  assert.deepEqual(fresh.cpu.snapshot(), expectedInitialState());
  checkMemory(fresh.ram, false);
  const memory = create6502BufferExampleMemory();
  memory.write(0, 0xff);
  checkMemory(create6502BufferExampleMemory(), false);
});

test("6502 transforms a buffer across pages, compares results, calls and returns, and reads back A8", t => {
  const { cpu, ram, endAddress } = create6502BufferExample();
  const actual: Cpu6502MemoryAccess[] = [];
  const read = ram.read.bind(ram), write = ram.write.bind(ram);
  t.mock.method(ram, "read", (address: number) => {
    const value = read(address);
    actual.push({ kind: "read", address, value });
    return value;
  });
  t.mock.method(ram, "write", (address: number, value: number) => {
    write(address, value);
    actual.push({ kind: "write", address, value });
  });
  const result = runCpu(cpu, { maxSteps: 72, endAddress });
  const expected = expectedRecords();
  assert.equal(expected.length, 72);
  assert.deepEqual(result, { records: expected, stopReason: "completed" });
  assert.deepEqual(actual, expected.flatMap(record => record.accesses));
  t.mock.restoreAll();
  checkMemory(ram, true);
  const final = { a: 0xa8, x: 3, y: 4, sp: 1, pc: 0x0250,
    flags: { n: true, v: false, d: false, i: false, z: false, c: true } };
  assert.deepEqual(cpu.snapshot(), final);
  assert.deepEqual(runCpu(cpu, { maxSteps: 0, endAddress }), { records: [], stopReason: "completed" });
  assert.deepEqual(cpu.step(), { before: final, after: final, instruction: { address: 0x0250, bytes: [0] },
    accesses: [{ kind: "read", address: 0x0250, value: 0 }], outcome: "unsupported", reason: "opcode" });
});

test("6502 buffer processing resumes inside the subroutine and loop without changing earlier records", () => {
  for (const pauseAfter of [3, 4, 6, 18, 37, 60, 69]) {
    const { cpu, ram, endAddress } = create6502BufferExample();
    const first = runCpu(cpu, { maxSteps: pauseAfter, endAddress });
    const saved = structuredClone(first);
    assert.equal(first.stopReason, "step-limit");
    const resumed = new Cpu6502(ram, cpu.snapshot());
    const rest = runCpu(resumed, { maxSteps: 72 - pauseAfter, endAddress });
    assert.equal(rest.stopReason, "completed");
    assert.deepEqual([...first.records, ...rest.records], expectedRecords());
    checkMemory(ram, true);
    resumed.reset();
    ram.write(0, 0xff);
    assert.deepEqual(first, saved);
  }
});

test("6502 buffer reset preserves RAM and occupied stack; restart rebuilds the original image", () => {
  const { cpu, ram, endAddress } = create6502BufferExample();
  const first = runCpu(cpu, { maxSteps: 4, endAddress });
  const saved = structuredClone(first);
  const before = cpu.snapshot();
  assert.equal(before.pc, 0x0240);
  assert.equal(before.sp, 0xff);
  const memory = Array.from({ length: ram.size }, (_, address) => ram.read(address));
  const after = { ...before, pc: 0x0200, sp: 0xfc, flags: { ...before.flags, i: true } };
  assert.deepEqual(cpu.reset(), { before, after,
    accesses: [{ kind: "read", address: 0xfffc, value: 0 }, { kind: "read", address: 0xfffd, value: 2 }] });
  memory.forEach((value, address) => assert.equal(ram.read(address), value));
  assert.equal(runCpu(cpu, { maxSteps: 72, endAddress }).stopReason, "completed");
  assert.deepEqual(cpu.snapshot(), { ...after, a: 0xa8, x: 3, y: 4, pc: 0x0250,
    flags: { n: true, v: false, d: false, i: true, z: false, c: true } });
  assert.deepEqual(first, saved);
  checkMemory(create6502BufferExampleMemory(), false);
});

test("an edited 6502 buffer branch remains bounded by the runner", () => {
  const { cpu, ram, endAddress } = create6502BufferExample();
  runCpu(cpu, { maxSteps: 17, endAddress });
  assert.equal(cpu.snapshot().pc, 0x0218);
  ram.write(0x0219, 0xfe); // BNE to itself while Z is clear.
  const before = cpu.snapshot();
  const step: Cpu6502StepRecord = { before, after: before, outcome: "executed",
    instruction: { address: 0x0218, bytes: [0xd0, 0xfe] },
    accesses: [{ kind: "read", address: 0x0218, value: 0xd0 }, { kind: "read", address: 0x0219, value: 0xfe }] };
  assert.deepEqual(runCpu(cpu, { maxSteps: 3, endAddress }), { records: [step, step, step], stopReason: "step-limit" });
});
