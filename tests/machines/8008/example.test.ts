import assert from "node:assert/strict";
import { test } from "node:test";
import type { Cpu8008Snapshot, Cpu8008StepRecord } from "../../../src/components/cpus/generated/8008-cpu.js";
import type { Ram } from "../../../src/components/memory/ram.js";
import { create8008Example, create8008ExampleMemory } from "../../../src/machines/generated/8008/example.js";
import { runCpu } from "../../../src/runtime/run-cpu.js";

function expectedInitialState(): Cpu8008Snapshot {
  return { a: 0, b: 0, c: 0, d: 0, e: 0, h: 0, l: 0, hl: 0, pc: 0,
    flags: { s: false, z: false, p: false, c: false },
    addressStack: [0, 0, 0, 0, 0, 0, 0, 0], stackIndex: 0, halted: false };
}

function checkMemory(ram: Ram, result: number): void {
  const expected = new Uint8Array(16_384);
  expected.set([0x2e, 0, 0x36, 0x80, 0x06, 2, 0x04, 3, 0xf8, 0]);
  expected[0x80] = result;
  assert.equal(ram.size, expected.length);
  for (const [address, value] of expected.entries()) assert.equal(ram.read(address), value, `memory at ${address}`);
}

function expectedRecords(): readonly Cpu8008StepRecord[] {
  const initial = expectedInitialState();
  const high: Cpu8008Snapshot = { ...initial, pc: 2, addressStack: [2, 0, 0, 0, 0, 0, 0, 0] };
  const low: Cpu8008Snapshot = { ...high, l: 0x80, hl: 0x80, pc: 4, addressStack: [4, 0, 0, 0, 0, 0, 0, 0] };
  const load: Cpu8008Snapshot = { ...low, a: 2, pc: 6, addressStack: [6, 0, 0, 0, 0, 0, 0, 0] };
  const add: Cpu8008Snapshot = { ...load, a: 5, pc: 8, addressStack: [8, 0, 0, 0, 0, 0, 0, 0],
    flags: { s: false, z: false, p: true, c: false } };
  const store: Cpu8008Snapshot = { ...add, pc: 9, addressStack: [9, 0, 0, 0, 0, 0, 0, 0] };
  const halt: Cpu8008Snapshot = { ...store, pc: 10, addressStack: [10, 0, 0, 0, 0, 0, 0, 0], halted: true };
  return [
    { before: initial, after: high, instruction: { address: 0, bytes: [0x2e, 0] }, outcome: "executed",
      accesses: [{ kind: "read", address: 0, value: 0x2e }, { kind: "read", address: 1, value: 0 }] },
    { before: high, after: low, instruction: { address: 2, bytes: [0x36, 0x80] }, outcome: "executed",
      accesses: [{ kind: "read", address: 2, value: 0x36 }, { kind: "read", address: 3, value: 0x80 }] },
    { before: low, after: load, instruction: { address: 4, bytes: [0x06, 2] }, outcome: "executed",
      accesses: [{ kind: "read", address: 4, value: 0x06 }, { kind: "read", address: 5, value: 2 }] },
    { before: load, after: add, instruction: { address: 6, bytes: [0x04, 3] }, outcome: "executed",
      accesses: [{ kind: "read", address: 6, value: 0x04 }, { kind: "read", address: 7, value: 3 }] },
    { before: add, after: store, instruction: { address: 8, bytes: [0xf8] }, outcome: "executed",
      accesses: [{ kind: "read", address: 8, value: 0xf8 }, { kind: "write", address: 0x80, value: 5 }] },
    { before: store, after: halt, instruction: { address: 9, bytes: [0] }, outcome: "halted",
      accesses: [{ kind: "read", address: 9, value: 0 }] },
  ];
}

test("8008 factories supply independent CPUs, 16 KiB images, explicit address stacks, and no completion address", () => {
  const memory = create8008ExampleMemory();
  const first = create8008Example();
  const second = create8008Example();
  for (const ram of [memory, first.ram, second.ram]) checkMemory(ram, 0);
  assert.deepEqual(first.cpu.snapshot(), expectedInitialState());
  assert.deepEqual(second.cpu.snapshot(), expectedInitialState());
  assert.equal(Object.hasOwn(first, "endAddress"), false);
  assert.notStrictEqual(first.ram, second.ram);
  assert.notStrictEqual(first.cpu, second.cpu);
  memory.write(0, 0);
  first.ram.write(0x80, 9);
  first.cpu.step();
  assert.equal(first.cpu.snapshot().pc, 2);
  assert.deepEqual(second.cpu.snapshot(), expectedInitialState());
  checkMemory(second.ram, 0);
});

test("8008 arithmetic produces six complete records and actual RAM calls, stores five, and halts", t => {
  const { cpu, ram } = create8008Example();
  const read = t.mock.method(ram, "read");
  const write = t.mock.method(ram, "write");
  const expected = expectedRecords();
  const result = runCpu(cpu, { maxSteps: 6 });
  assert.deepEqual(result, { records: expected, stopReason: "halted" });
  assert.deepEqual(read.mock.calls.map(call => call.arguments), [[0], [1], [2], [3], [4], [5], [6], [7], [8], [9]]);
  assert.deepEqual(write.mock.calls.map(call => call.arguments), [[0x80, 5]]);
  const final = expected[5]!.after;
  assert.deepEqual(cpu.snapshot(), final);
  assert.deepEqual(cpu.step(), { before: final, after: final, instruction: null, accesses: [], outcome: "halted" });
  assert.equal(read.mock.callCount(), 10);
  assert.equal(write.mock.callCount(), 1);
  read.mock.restore();
  write.mock.restore();
  checkMemory(ram, 5);
});

test("8008 runner pauses and resumes using the derived PC, with caller completion before HLT", () => {
  const { cpu } = create8008Example();
  const expected = expectedRecords();
  const first = runCpu(cpu, { maxSteps: 3 });
  const saved = structuredClone(first);
  assert.deepEqual(first, { records: expected.slice(0, 3), stopReason: "step-limit" });
  const second = runCpu(cpu, { maxSteps: 2, endAddress: 9 });
  assert.deepEqual(second, { records: expected.slice(3, 5), stopReason: "completed" });
  assert.deepEqual(runCpu(cpu, { maxSteps: 10, endAddress: 9 }), { records: [], stopReason: "completed" });
  const last = runCpu(cpu, { maxSteps: 1, endAddress: 10 });
  assert.deepEqual(last, { records: expected.slice(5), stopReason: "halted" });
  assert.deepEqual([...first.records, ...second.records, ...last.records], expected);
  assert.deepEqual(first, saved);
});

test("8008 reset leaves the CPU stopped and RAM intact; a fresh factory restarts the lesson", () => {
  const { cpu, ram } = create8008Example();
  const result = runCpu(cpu, { maxSteps: 6 });
  const saved = structuredClone(result);
  ram.write(0, 0xff);
  const reset = cpu.reset();
  const expected = { ...expectedInitialState(), halted: true, flags: { s: false, z: false, p: true, c: false } };
  assert.deepEqual(reset, { before: result.records[5]!.after, after: expected, accesses: [] });
  assert.deepEqual(runCpu(cpu, { maxSteps: 6 }), { stopReason: "halted",
    records: [{ before: expected, after: expected, instruction: null, accesses: [], outcome: "halted" }] });
  assert.equal(ram.read(0), 0xff);
  assert.equal(ram.read(0x80), 5);
  const fresh = create8008Example();
  checkMemory(fresh.ram, 0);
  assert.deepEqual(fresh.cpu.snapshot(), expectedInitialState());
  assert.deepEqual(runCpu(fresh.cpu, { maxSteps: 6 }).records, expectedRecords());
  assert.deepEqual(result, saved);
});
