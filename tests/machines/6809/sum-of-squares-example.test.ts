import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu6809 } from "../../../src/components/cpus/generated/6809-cpu.js";
import type { Cpu6809Snapshot, Cpu6809MemoryAccess, Cpu6809StepRecord } from "../../../src/components/cpus/generated/6809-cpu.js";
import type { Ram } from "../../../src/components/memory/ram.js";
import { create6809SumOfSquaresExample, create6809SumOfSquaresExampleMemory } from "../../../src/machines/generated/6809/sum-of-squares-example.js";
import { runCpu } from "../../../src/runtime/run-cpu.js";

const main = [0x10, 0xce, 8, 0, 0x10, 0x8e, 0x30, 0xff, 0xce, 0, 0,
  0xa6, 0xa0, 0x1f, 0x89, 0xbd, 3, 0, 0x10, 0x8c, 0x31, 2, 0x10, 0x26, 0xff, 0xf1,
  0xdd, 0x22, 0x10, 0x9f, 0x24, 0x10, 0xdf, 0x26];
const routine = [0x32, 0x7e, 0x3d, 0x1e, 3, 0xed, 0xe4, 0x1f, 0x30, 0xe3, 0xe4, 0x1f, 3, 0x32, 0x62, 0x39];
const flags = (cc: number) => ({ e: Boolean(cc & 128), f: Boolean(cc & 64), h: Boolean(cc & 32), i: Boolean(cc & 16),
  n: Boolean(cc & 8), z: Boolean(cc & 4), v: Boolean(cc & 2), c: Boolean(cc & 1) });
function initialState(): Cpu6809Snapshot {
  return { waitMode: "none" as const, nmiArmed: false, a: 0x11, b: 0x34, d: 0x1134, dp: 0x20, x: 0x2345, y: 0x4567, s: 0x8888, u: 0x5555, pc: 0x200, flags: flags(0xab) };
}
function checkMemory(ram: Ram, completed = false): void {
  const expected = new Uint8Array(65536);
  expected.set(main, 0x200); expected.set(routine, 0x300);
  expected.set([0xcc, 3, 4, 5, 0xcc], 0x30fe);
  expected.set(completed ? [0xcc, 0, 0x32, 0x31, 2, 8, 0, 0xcc] : [0xcc, 0, 0, 0, 0, 0, 0, 0xcc], 0x2021);
  expected.set(completed ? [0xcc, 0, 0x19, 2, 0x12, 0xcc] : [0xcc, 0, 0, 0, 0, 0xcc], 0x7fb);
  expected.set([2, 0], 0xfffe);
  assert.equal(ram.size, expected.length);
  for (const [address, byte] of expected.entries()) assert.equal(ram.read(address), byte, `RAM at ${address}`);
}
function expectedRecords(): Cpu6809StepRecord[] {
  const records: Cpu6809StepRecord[] = [];
  let state = initialState();
  const read = (address: number, value: number): Cpu6809MemoryAccess => ({ kind: "read", address, value });
  const write = (address: number, value: number): Cpu6809MemoryAccess => ({ kind: "write", address, value });
  const step = (bytes: number[], changes: Partial<Cpu6809Snapshot>, data: Cpu6809MemoryAccess[] = []) => {
    const before = state;
    const next = { ...before, pc: before.pc + bytes.length, ...changes };
    state = { ...next, d: next.a * 256 + next.b };
    records.push({ before, after: state, instruction: { address: before.pc, bytes }, outcome: "executed",
      accesses: [...bytes.map((value, offset) => read(before.pc + offset, value)), ...data] });
  };
  step([0x10, 0xce, 8, 0], { s: 0x800, nmiArmed: true, flags: flags(0xa1) });
  step([0x10, 0x8e, 0x30, 0xff], { y: 0x30ff });
  step([0xce, 0, 0], { u: 0, flags: flags(0xa5) });
  for (const [inputAddress, value, square, previous, total, last] of [
    [0x30ff, 3, 9, 0, 9, false], [0x3100, 4, 16, 9, 25, false], [0x3101, 5, 25, 25, 50, true],
  ] as const) {
    step([0xa6, 0xa0], { a: value, y: inputAddress + 1, flags: flags(0xa1) }, [read(inputAddress, value)]);
    step([0x1f, 0x89], { b: value });
    step([0xbd, 3, 0], { pc: 0x300, s: 0x7fe }, [write(0x7ff, 0x12), write(0x7fe, 2)]);
    step([0x32, 0x7e], { s: 0x7fc });
    step([0x3d], { a: 0, b: square, flags: flags(0xa0) });
    step([0x1e, 3], { b: previous, u: square });
    step([0xed, 0xe4], { flags: flags(previous === 0 ? 0xa4 : 0xa0) }, [write(0x7fc, 0), write(0x7fd, previous)]);
    step([0x1f, 0x30], { b: square });
    step([0xe3, 0xe4], { b: total, flags: flags(0xa0) }, [read(0x7fc, 0), read(0x7fd, previous)]);
    step([0x1f, 3], { u: total });
    step([0x32, 0x62], { s: 0x7fe });
    step([0x39], { pc: 0x212, s: 0x800 }, [read(0x7fe, 2), read(0x7ff, 0x12)]);
    step([0x10, 0x8c, 0x31, 2], { flags: flags(last ? 0xa4 : 0xa9) });
    step([0x10, 0x26, 0xff, 0xf1], { pc: last ? 0x21a : 0x20b });
  }
  step([0xdd, 0x22], { flags: flags(0xa0) }, [write(0x2022, 0), write(0x2023, 0x32)]);
  step([0x10, 0x9f, 0x24], {}, [write(0x2024, 0x31), write(0x2025, 2)]);
  step([0x10, 0xdf, 0x26], {}, [write(0x2026, 8), write(0x2027, 0)]);
  return records;
}

test("6809 sum-of-squares factories provide detached components and the complete initial image", () => {
  const { cpu, ram, endAddress } = create6809SumOfSquaresExample();
  assert.deepEqual(cpu.snapshot(), initialState());
  assert.equal(endAddress, 0x222);
  checkMemory(ram);
  const memory = create6809SumOfSquaresExampleMemory();
  assert.notStrictEqual(memory, ram);
  ram.write(0x2022, 0xff);
  checkMemory(memory);
});

test("6809 sum of squares completes with 48 exact records, stack locals, real accesses, and decimal 50", t => {
  const { cpu, ram, endAddress } = create6809SumOfSquaresExample();
  const read = t.mock.method(ram, "read"), write = t.mock.method(ram, "write");
  const records = expectedRecords();
  assert.equal(records.length, 48);
  assert.deepEqual(runCpu(cpu, { maxSteps: 48, endAddress }), { records, stopReason: "completed" });
  assert.deepEqual(cpu.snapshot(), records.at(-1)!.after);
  const accesses = records.flatMap(record => record.accesses);
  assert.deepEqual(read.mock.calls.map(call => call.arguments), accesses.filter(a => a.kind === "read").map(a => [a.address]));
  assert.deepEqual(write.mock.calls.map(call => call.arguments), accesses.filter(a => a.kind === "write").map(a => [a.address, a.value]));
  assert.equal(read.mock.callCount(), 127);
  assert.equal(write.mock.callCount(), 18);
  assert.deepEqual(runCpu(cpu, { maxSteps: 0, endAddress }), { records: [], stopReason: "completed" });
  t.mock.restoreAll();
  checkMemory(ram, true);
});

test("6809 sum of squares resumes inside its stack frame, resets without clearing RAM, and restarts fresh", () => {
  const { cpu, ram, endAddress } = create6809SumOfSquaresExample();
  const records = expectedRecords();
  const first = runCpu(cpu, { maxSteps: 8, endAddress }), saved = structuredClone(first);
  assert.deepEqual(first, { records: records.slice(0, 8), stopReason: "step-limit" });
  const snapshot = cpu.snapshot(), resumed = new Cpu6809(ram, snapshot);
  Reflect.set(snapshot, "s", 0);
  Reflect.set(snapshot.flags, "c", true);
  assert.deepEqual(runCpu(resumed, { maxSteps: 40, endAddress }), { records: records.slice(8), stopReason: "completed" });
  checkMemory(ram, true);
  const before = resumed.snapshot();
  assert.deepEqual(resumed.reset(), { before, after: { ...before, dp: 0, pc: 0x200, nmiArmed: false, flags: { ...before.flags, f: true, i: true } },
    accesses: [{ kind: "read", address: 0xfffe, value: 2 }, { kind: "read", address: 0xffff, value: 0 }] });
  checkMemory(ram, true);
  assert.deepEqual(first, saved);
  const fresh = create6809SumOfSquaresExample();
  assert.notStrictEqual(fresh.cpu, cpu); assert.notStrictEqual(fresh.ram, ram);
  assert.deepEqual(fresh.cpu.snapshot(), initialState());
  checkMemory(fresh.ram);
});

test("6809 sum of squares bounds a changed long-branch loop and rejects a reserved prefixed indexed operand", () => {
  const loop = create6809SumOfSquaresExample();
  loop.ram.write(0x218, 0xff); loop.ram.write(0x219, 0xfc); // LBNE to itself.
  const result = runCpu(loop.cpu, { maxSteps: 20, endAddress: loop.endAddress });
  assert.equal(result.stopReason, "step-limit");
  assert.equal(loop.cpu.snapshot().pc, 0x216);
  assert.equal(loop.cpu.snapshot().u, 9);
  const broken = create6809SumOfSquaresExample();
  broken.ram.write(0x205, 0xae); broken.ram.write(0x206, 0x90); // LDY [,X+] is undefined.
  const rejected = runCpu(broken.cpu, { maxSteps: 48, endAddress: broken.endAddress });
  assert.equal(rejected.stopReason, "unsupported");
  assert.equal(broken.cpu.snapshot().pc, 0x204);
  assert.deepEqual(rejected.records.at(-1)?.instruction?.bytes, [0x10, 0xae, 0x90]);
  assert.deepEqual(rejected.records.at(-1)?.before, rejected.records.at(-1)?.after);
});
