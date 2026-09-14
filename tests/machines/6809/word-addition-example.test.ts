import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu6809 } from "../../../src/components/cpus/6809.js";
import type { Cpu6809Flags, Cpu6809MemoryAccess, Cpu6809Snapshot, Cpu6809StepRecord } from "../../../src/components/cpus/6809.js";
import type { Ram } from "../../../src/components/memory/ram.js";
import { create6809WordAdditionExample, create6809WordAdditionExampleMemory } from "../../../src/machines/generated/6809/word-addition-example.js";
import { runCpu } from "../../../src/runtime/run-cpu.js";

const main = [0xd6, 0x11, 0x96, 0x10, 0xbd, 2, 0x20, 0x97, 0x14, 0xd7, 0x15,
  0x7f, 0x12, 0x16, 0x7d, 0x12, 0x14, 0x26, 3, 0x0c, 0x16, 0x12];
const addLow = [0xdb, 0x13, 0x8d, 0x0c, 0x39];
const addHigh = [0xb9, 0x12, 0x12, 0x39];

function flags(cc: number): Cpu6809Flags {
  const bits = cc.toString(2).padStart(8, "0");
  return { e: bits[0] === "1", f: bits[1] === "1", h: bits[2] === "1", i: bits[3] === "1",
    n: bits[4] === "1", z: bits[5] === "1", v: bits[6] === "1", c: bits[7] === "1" };
}

function initial(): Cpu6809Snapshot {
  return { a: 0x11, b: 0x34, d: 0x1134, dp: 0x12, x: 0x2345, y: 0x4567,
    s: 0x8000, u: 0x4000, pc: 0x200, flags: flags(0xaf) };
}

function checkMemory(ram: Ram, finished = false): void {
  const image = new Uint8Array(0x10000);
  image.set(main, 0x200);
  image.set(addLow, 0x220);
  image.set(addHigh, 0x230);
  image.set([0, 0xff, 0, 1, 0, 0, 0xa5], 0x1210);
  image.set([2, 0], 0xfffe);
  if (finished) {
    image.set([1, 0, 0], 0x1214);
    image.set([2, 0x24, 2, 7], 0x7ffc);
  }
  for (const [address, byte] of image.entries()) assert.equal(ram.read(address), byte, `RAM ${address.toString(16)}`);
}

function expectedRecords(): Cpu6809StepRecord[] {
  const read = (address: number, value: number): Cpu6809MemoryAccess => ({ kind: "read", address, value });
  const write = (address: number, value: number): Cpu6809MemoryAccess => ({ kind: "write", address, value });
  const steps = [
    { bytes: [0xd6, 0x11], pc: 0x202, a: 0x11, b: 0xff, s: 0x8000, cc: 0xa9, data: [read(0x1211, 0xff)] },
    { bytes: [0x96, 0x10], pc: 0x204, a: 0, b: 0xff, s: 0x8000, cc: 0xa5, data: [read(0x1210, 0)] },
    { bytes: [0xbd, 2, 0x20], pc: 0x220, a: 0, b: 0xff, s: 0x7ffe, cc: 0xa5, data: [write(0x7fff, 7), write(0x7ffe, 2)] },
    { bytes: [0xdb, 0x13], pc: 0x222, a: 0, b: 0, s: 0x7ffe, cc: 0xa5, data: [read(0x1213, 1)] },
    { bytes: [0x8d, 0x0c], pc: 0x230, a: 0, b: 0, s: 0x7ffc, cc: 0xa5, data: [write(0x7ffd, 0x24), write(0x7ffc, 2)] },
    { bytes: [0xb9, 0x12, 0x12], pc: 0x233, a: 1, b: 0, s: 0x7ffc, cc: 0x80, data: [read(0x1212, 0)] },
    { bytes: [0x39], pc: 0x224, a: 1, b: 0, s: 0x7ffe, cc: 0x80, data: [read(0x7ffc, 2), read(0x7ffd, 0x24)] },
    { bytes: [0x39], pc: 0x207, a: 1, b: 0, s: 0x8000, cc: 0x80, data: [read(0x7ffe, 2), read(0x7fff, 7)] },
    { bytes: [0x97, 0x14], pc: 0x209, a: 1, b: 0, s: 0x8000, cc: 0x80, data: [write(0x1214, 1)] },
    { bytes: [0xd7, 0x15], pc: 0x20b, a: 1, b: 0, s: 0x8000, cc: 0x84, data: [write(0x1215, 0)] },
    { bytes: [0x7f, 0x12, 0x16], pc: 0x20e, a: 1, b: 0, s: 0x8000, cc: 0x84, data: [read(0x1216, 0xa5), write(0x1216, 0)] },
    { bytes: [0x7d, 0x12, 0x14], pc: 0x211, a: 1, b: 0, s: 0x8000, cc: 0x80, data: [read(0x1214, 1)] },
    { bytes: [0x26, 3], pc: 0x216, a: 1, b: 0, s: 0x8000, cc: 0x80, data: [] },
  ];
  let state = initial();
  return steps.map(({ bytes, pc, a, b, s, cc, data }) => {
    const before = state;
    state = { ...state, a, b, d: a * 256 + b, pc, s, flags: flags(cc) };
    return { instruction: { address: before.pc, bytes }, before, after: state,
      accesses: [...bytes.map((value, offset) => read(before.pc + offset, value)), ...data], outcome: "executed" };
  });
}

test("6809 word addition has independent factories and adds 00FF + 0001 through nested calls with exact records", t => {
  const { cpu, ram, endAddress } = create6809WordAdditionExample();
  assert.equal(endAddress, 0x216);
  assert.deepEqual(cpu.snapshot(), initial());
  checkMemory(ram);
  const memory = create6809WordAdditionExampleMemory();
  checkMemory(memory);
  memory.write(0x1213, 0xff);
  assert.equal(ram.read(0x1213), 1);
  const read = t.mock.method(ram, "read");
  const write = t.mock.method(ram, "write");
  const result = runCpu(cpu, { maxSteps: 13, endAddress });
  const expected = expectedRecords();
  assert.equal(result.stopReason, "completed");
  assert.deepEqual(result.records, expected);
  assert.deepEqual(read.mock.calls.map(call => call.arguments), expected.flatMap(record => record.accesses)
    .filter(access => access.kind === "read").map(access => [access.address]));
  assert.deepEqual(write.mock.calls.map(call => call.arguments), [[0x7fff, 7], [0x7ffe, 2],
    [0x7ffd, 0x24], [0x7ffc, 2], [0x1214, 1], [0x1215, 0], [0x1216, 0]]);
  t.mock.restoreAll();
  assert.deepEqual(cpu.snapshot(), expected.at(-1)?.after);
  checkMemory(ram, true);
  assert.deepEqual(runCpu(cpu, { maxSteps: 0, endAddress }), { records: [], stopReason: "completed" });
});

test("6809 word addition resumes from a snapshot inside nested calls, preserves results on reset, and restarts fresh", () => {
  const { cpu, ram, endAddress } = create6809WordAdditionExample();
  const first = runCpu(cpu, { maxSteps: 5, endAddress });
  assert.equal(first.stopReason, "step-limit");
  assert.equal(cpu.snapshot().pc, 0x230);
  assert.equal(cpu.snapshot().s, 0x7ffc);
  const saved = structuredClone(first.records);
  const resumed = new Cpu6809(ram, cpu.snapshot());
  const rest = runCpu(resumed, { maxSteps: 8, endAddress });
  assert.equal(rest.stopReason, "completed");
  assert.deepEqual([...first.records, ...rest.records], expectedRecords());
  checkMemory(ram, true);
  const before = resumed.snapshot();
  assert.deepEqual(resumed.reset(), { before,
    after: { ...before, pc: 0x200, dp: 0, flags: { ...before.flags, f: true, i: true } },
    accesses: [{ kind: "read", address: 0xfffe, value: 2 }, { kind: "read", address: 0xffff, value: 0 }] });
  checkMemory(ram, true);
  const fresh = create6809WordAdditionExample();
  assert.notStrictEqual(fresh.ram, ram);
  assert.notStrictEqual(fresh.cpu, cpu);
  assert.deepEqual(fresh.cpu.snapshot(), initial());
  checkMemory(fresh.ram);
  ram.write(0x7ffc, 0xff);
  assert.deepEqual(first.records, saved);
});

test("6809 word addition takes its failure path without a carry and remains bounded with a changed branch", () => {
  const failed = create6809WordAdditionExample();
  failed.ram.write(0x1213, 0);
  const result = runCpu(failed.cpu, { maxSteps: 15, endAddress: failed.endAddress });
  assert.equal(result.stopReason, "completed");
  assert.equal(result.records.length, 15);
  assert.equal(failed.ram.read(0x1214), 0);
  assert.equal(failed.ram.read(0x1215), 0xff);
  assert.equal(failed.ram.read(0x1216), 1);
  const loop = create6809WordAdditionExample();
  loop.ram.write(0x212, 0xfe);
  assert.equal(runCpu(loop.cpu, { maxSteps: 20, endAddress: loop.endAddress }).stopReason, "step-limit");
  assert.equal(loop.cpu.snapshot().pc, 0x211);
});
