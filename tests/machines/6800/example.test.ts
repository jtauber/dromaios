import assert from "node:assert/strict";
import { test } from "node:test";
import type { Cpu6800Snapshot, Cpu6800StepRecord } from "../../../src/components/cpus/generated/6800-cpu.js";
import type { Ram } from "../../../src/components/memory/ram.js";
import { create6800Example, create6800ExampleMemory } from "../../../src/machines/generated/6800/example.js";
import { runCpu } from "../../../src/runtime/run-cpu.js";

function expectedInitialState(): Cpu6800Snapshot {
  return { waiting: false, a: 0x11, b: 0x22, x: 0x3456, sp: 0x7fff, pc: 0x0200,
    flags: { h: true, i: false, n: true, z: true, v: true, c: true } };
}

function checkMemory(ram: Ram, result = 0): void {
  const expected = new Uint8Array(65_536);
  expected.set([0x86, 2, 0x8b, 3, 0xb7, 0, 0x80], 0x0200);
  expected.set([2, 0], 0xfffe);
  expected[0x80] = result;
  assert.equal(ram.size, expected.length);
  for (const [address, value] of expected.entries()) assert.equal(ram.read(address), value, `memory at ${address}`);
}

function expectedRecords(): readonly Cpu6800StepRecord[] {
  const initial = expectedInitialState();
  const load = { ...initial, a: 2, pc: 0x0202,
    flags: { h: true, i: false, n: false, z: false, v: false, c: true } };
  const add = { ...load, a: 5, pc: 0x0204,
    flags: { h: false, i: false, n: false, z: false, v: false, c: false } };
  const store = { ...add, pc: 0x0207 };
  return [
    { before: initial, after: load, instruction: { address: 0x0200, bytes: [0x86, 2] }, outcome: "executed",
      accesses: [{ kind: "read", address: 0x0200, value: 0x86 }, { kind: "read", address: 0x0201, value: 2 }] },
    { before: load, after: add, instruction: { address: 0x0202, bytes: [0x8b, 3] }, outcome: "executed",
      accesses: [{ kind: "read", address: 0x0202, value: 0x8b }, { kind: "read", address: 0x0203, value: 3 }] },
    { before: add, after: store, instruction: { address: 0x0204, bytes: [0xb7, 0, 0x80] }, outcome: "executed",
      accesses: [{ kind: "read", address: 0x0204, value: 0xb7 }, { kind: "read", address: 0x0205, value: 0 },
        { kind: "read", address: 0x0206, value: 0x80 }, { kind: "write", address: 0x80, value: 5 }] },
  ];
}

test("6800 factories provide explicit state, a reset vector, a completion address, and independent full memory images", () => {
  const memory = create6800ExampleMemory();
  const first = create6800Example();
  const second = create6800Example();
  for (const ram of [memory, first.ram, second.ram]) checkMemory(ram);
  for (const machine of [first, second]) {
    assert.deepEqual(machine.cpu.snapshot(), expectedInitialState());
    assert.equal(machine.endAddress, 0x0207);
  }
  assert.notStrictEqual(first.cpu, second.cpu);
  assert.notStrictEqual(first.ram, second.ram);
  memory.write(0x0200, 0);
  first.ram.write(0x80, 0xff);
  first.cpu.step();
  assert.deepEqual(second.cpu.snapshot(), expectedInitialState());
  checkMemory(second.ram);
});

test("6800 arithmetic produces three complete records, stores five, and completes before fetching the endpoint", t => {
  const { cpu, ram, endAddress } = create6800Example();
  const read = t.mock.method(ram, "read");
  const write = t.mock.method(ram, "write");
  const expected = expectedRecords();
  assert.deepEqual(runCpu(cpu, { maxSteps: 3, endAddress }), { records: expected, stopReason: "completed" });
  assert.deepEqual(read.mock.calls.map(call => call.arguments), [[0x0200], [0x0201], [0x0202], [0x0203], [0x0204], [0x0205], [0x0206]]);
  assert.deepEqual(write.mock.calls.map(call => call.arguments), [[0x80, 5]]);
  assert.deepEqual(cpu.snapshot(), expected[2]!.after);
  assert.deepEqual(runCpu(cpu, { maxSteps: 3, endAddress }), { records: [], stopReason: "completed" });
  assert.equal(read.mock.callCount(), 7);
  t.mock.restoreAll();
  checkMemory(ram, 5);
  // Completion is caller policy; another CPU step attempts the byte at 0207.
  const final = expected[2]!.after;
  assert.deepEqual(cpu.step(), { before: final, after: final, instruction: { address: 0x0207, bytes: [0] },
    outcome: "unsupported", reason: "opcode", accesses: [{ kind: "read", address: 0x0207, value: 0 }] });
});

test("6800 bounded running pauses and resumes while preserving concrete records", () => {
  const { cpu, endAddress } = create6800Example();
  const expected = expectedRecords();
  const first = runCpu(cpu, { maxSteps: 1, endAddress });
  const saved = structuredClone(first);
  assert.deepEqual(first, { records: expected.slice(0, 1), stopReason: "step-limit" });
  assert.deepEqual(runCpu(cpu, { maxSteps: 2, endAddress }), { records: expected.slice(1), stopReason: "completed" });
  assert.deepEqual(first, saved);
  const unboundedEndpoint = create6800Example();
  assert.deepEqual(runCpu(unboundedEndpoint.cpu, { maxSteps: 3 }), { records: expected, stopReason: "step-limit" });
  assert.equal(runCpu(unboundedEndpoint.cpu, { maxSteps: 1 }).stopReason, "unsupported");
});

test("6800 reset reads the current vector and preserves data, flags except I, and RAM; fresh creation restarts the example", t => {
  const { cpu, ram, endAddress } = create6800Example();
  const records = runCpu(cpu, { maxSteps: 3, endAddress }).records;
  const saved = structuredClone(records);
  const before = expectedRecords()[2]!.after;
  const after = { ...before, pc: 0x0200, flags: { ...before.flags, i: true } };
  const read = t.mock.method(ram, "read");
  const write = t.mock.method(ram, "write");
  const reset = cpu.reset();
  const savedReset = structuredClone(reset);
  assert.deepEqual(reset, { before, after,
    accesses: [{ kind: "read", address: 0xfffe, value: 2 }, { kind: "read", address: 0xffff, value: 0 }] });
  assert.deepEqual(read.mock.calls.map(call => call.arguments), [[0xfffe], [0xffff]]);
  assert.equal(write.mock.callCount(), 0);
  t.mock.restoreAll();
  checkMemory(ram, 5);
  const rerun = runCpu(cpu, { maxSteps: 3, endAddress });
  assert.equal(rerun.stopReason, "completed");
  assert.ok(rerun.records.every(record => record.before.flags.i && record.after.flags.i));
  assert.deepEqual(cpu.snapshot(), { ...before, flags: { ...before.flags, i: true } });
  ram.write(0x0201, 0xff);
  ram.write(0xffff, 0x04);
  assert.equal(cpu.reset().after.pc, 0x0204);
  const restarted = create6800Example();
  assert.deepEqual(restarted.cpu.snapshot(), expectedInitialState());
  checkMemory(restarted.ram);
  assert.deepEqual(records, saved);
  assert.deepEqual(reset, savedReset);
  Reflect.set(records[0]!.after.flags, "c", false);
  assert.equal(records[1]!.before.flags.c, true);
});
