import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu8008 } from "../../../src/components/cpus/generated/8008-cpu.js";
import type { Cpu8008MemoryAccess, Cpu8008Snapshot, Cpu8008StepRecord } from "../../../src/components/cpus/generated/8008-cpu.js";
import type { Ram } from "../../../src/components/memory/ram.js";
import { create8008CarryExample, create8008CarryExampleMemory } from "../../../src/machines/generated/8008/carry-example.js";
import { runCpu } from "../../../src/runtime/run-cpu.js";

function initialState(): Cpu8008Snapshot {
  return { a: 0x11, b: 0x22, c: 0x33, d: 0x44, e: 0x55, h: 0xc0, l: 0xff, hl: 0xc0ff, pc: 0x0200,
    flags: { s: true, z: false, p: true, c: true },
    addressStack: [0x1111, 0x1222, 0x1333, 0x1444, 0x1555, 0x1666, 0x1777, 0x0200], stackIndex: 7, halted: false };
}

function checkMemory(ram: Ram, completed = false): void {
  const expected = new Uint8Array(0x4000);
  expected.set(completed ? [0xcc, 0x03, 0x81, 0xcc] : [0xcc, 0x81, 0x40, 0xcc], 0xfe);
  expected.set([0xc7, 0x12, 0xf8, 0x30, 0x0b, 0x28, 0x07], 8);
  expected.set([0x16, 2, 0x0d, 0x11, 0x48, 2, 2, 0xff], 0x200);
  assert.equal(ram.size, expected.length);
  for (const [address, byte] of expected.entries()) assert.equal(ram.read(address), byte, `memory at ${address}`);
}

function expectedRecords(): readonly Cpu8008StepRecord[] {
  // Literal state transitions, including the inactive caller and callee slots.
  const steps: readonly {
    bytes: readonly number[]; pc: number; slot: 0 | 7; slots: readonly [number, number];
    changes?: Partial<Cpu8008Snapshot>; data?: readonly Cpu8008MemoryAccess[];
  }[] = [
    { bytes: [0x16, 2], pc: 0x202, slot: 7, slots: [0x1111, 0x202], changes: { c: 2 } },
    { bytes: [0x0d], pc: 8, slot: 0, slots: [8, 0x203] },
    { bytes: [0xc7], pc: 9, slot: 0, slots: [9, 0x203], changes: { a: 0x81 },
      data: [{ kind: "read", address: 0xff, value: 0x81 }] },
    { bytes: [0x12], pc: 0x0a, slot: 0, slots: [0x0a, 0x203], changes: { a: 3 } },
    { bytes: [0xf8], pc: 0x0b, slot: 0, slots: [0x0b, 0x203], data: [{ kind: "write", address: 0xff, value: 3 }] },
    { bytes: [0x30], pc: 0x0c, slot: 0, slots: [0x0c, 0x203],
      changes: { l: 0, hl: 0xc000, flags: { s: false, z: true, p: true, c: true } } },
    { bytes: [0x0b], pc: 0x0d, slot: 0, slots: [0x0d, 0x203] },
    { bytes: [0x28], pc: 0x0e, slot: 0, slots: [0x0e, 0x203],
      changes: { h: 0xc1, hl: 0xc100, flags: { s: true, z: false, p: false, c: true } } },
    { bytes: [0x07], pc: 0x203, slot: 7, slots: [0x0f, 0x203] },
    { bytes: [0x11], pc: 0x204, slot: 7, slots: [0x0f, 0x204],
      changes: { c: 1, flags: { s: false, z: false, p: false, c: true } } },
    { bytes: [0x48, 2, 2], pc: 0x202, slot: 7, slots: [0x0f, 0x202] },
    { bytes: [0x0d], pc: 8, slot: 0, slots: [8, 0x203] },
    { bytes: [0xc7], pc: 9, slot: 0, slots: [9, 0x203], changes: { a: 0x40 },
      data: [{ kind: "read", address: 0x100, value: 0x40 }] },
    { bytes: [0x12], pc: 0x0a, slot: 0, slots: [0x0a, 0x203],
      changes: { a: 0x81, flags: { s: false, z: false, p: false, c: false } } },
    { bytes: [0xf8], pc: 0x0b, slot: 0, slots: [0x0b, 0x203], data: [{ kind: "write", address: 0x100, value: 0x81 }] },
    { bytes: [0x30], pc: 0x0c, slot: 0, slots: [0x0c, 0x203], changes: { l: 1, hl: 0xc101 } },
    { bytes: [0x0b], pc: 0x203, slot: 7, slots: [0x0d, 0x203] },
    { bytes: [0x11], pc: 0x204, slot: 7, slots: [0x0d, 0x204],
      changes: { c: 0, flags: { s: false, z: true, p: true, c: false } } },
    { bytes: [0x48, 2, 2], pc: 0x207, slot: 7, slots: [0x0d, 0x207] },
    { bytes: [0xff], pc: 0x208, slot: 7, slots: [0x0d, 0x208], changes: { halted: true } },
  ];
  let state = initialState();
  return steps.map(({ bytes, pc, slot, slots, changes = {}, data = [] }) => {
    const before = state;
    state = { ...before, ...changes, pc, stackIndex: slot,
      addressStack: [slots[0], 0x1222, 0x1333, 0x1444, 0x1555, 0x1666, 0x1777, slots[1]] };
    return { before, after: state, instruction: { address: before.pc, bytes },
      accesses: [...bytes.map((value, offset): Cpu8008MemoryAccess => ({ kind: "read", address: before.pc + offset, value })), ...data],
      outcome: state.halted ? "halted" : "executed" };
  });
}

test("8008 carry factories provide fresh state and RAM without executing", () => {
  const { cpu, ram } = create8008CarryExample();
  const memory = create8008CarryExampleMemory();
  assert.deepEqual(cpu.snapshot(), initialState());
  assert.notStrictEqual(ram, memory);
  checkMemory(ram);
  checkMemory(memory);
  ram.write(0xff, 0);
  assert.equal(memory.read(0xff), 0x81);
});

test("8008 carry example propagates carry across a page boundary and RST returns in 20 steps", t => {
  const { cpu, ram } = create8008CarryExample();
  const read = t.mock.method(ram, "read");
  const write = t.mock.method(ram, "write");
  const records = expectedRecords();
  assert.deepEqual(runCpu(cpu, { maxSteps: 20 }), { records, stopReason: "halted" });
  const reads = records.flatMap(record => record.accesses).flatMap(access => access.kind === "read" ? [[access.address]] : []);
  assert.deepEqual(read.mock.calls.map(call => call.arguments), reads);
  assert.deepEqual(write.mock.calls.map(call => call.arguments), [[0xff, 3], [0x100, 0x81]]);
  const final = records.at(-1)!.after;
  assert.deepEqual(cpu.snapshot(), final);
  assert.deepEqual(cpu.step(), { before: final, after: final, instruction: null, accesses: [], outcome: "halted" });
  assert.equal(read.mock.callCount(), 27);
  t.mock.restoreAll();
  checkMemory(ram, true);
});

test("8008 carry example resumes between bytes with a pending carry, and supports caller completion before HLT", () => {
  const { cpu, ram } = create8008CarryExample();
  const expected = expectedRecords();
  const first = runCpu(cpu, { maxSteps: 10 });
  const saved = structuredClone(first);
  assert.deepEqual(first, { records: expected.slice(0, 10), stopReason: "step-limit" });
  assert.equal(ram.read(0xff), 3);
  assert.equal(ram.read(0x100), 0x40);
  const paused = cpu.snapshot();
  assert.equal(paused.flags.c, true);
  const resumed = new Cpu8008(ram, paused);
  Reflect.set(paused.flags, "c", false);
  Reflect.set(paused.addressStack, 7, 0);
  assert.deepEqual(runCpu(resumed, { maxSteps: 9, endAddress: 0x207 }),
    { records: expected.slice(10, 19), stopReason: "completed" });
  assert.deepEqual(runCpu(resumed, { maxSteps: 1 }), { records: expected.slice(19), stopReason: "halted" });
  const before = resumed.snapshot();
  const after: Cpu8008Snapshot = { a: 0, b: 0, c: 0, d: 0, e: 0, h: 0, l: 0, hl: 0, pc: 0,
    flags: { s: false, z: true, p: true, c: false },
    addressStack: [0, 0, 0, 0, 0, 0, 0, 0], stackIndex: 0, halted: true };
  assert.deepEqual(resumed.reset(), { before, after, accesses: [] });
  assert.deepEqual(resumed.step(), { before: after, after, instruction: null, accesses: [], outcome: "halted" });
  checkMemory(ram, true);
  assert.deepEqual(first, saved);
  const fresh = create8008CarryExample();
  assert.notStrictEqual(fresh.cpu, cpu);
  assert.notStrictEqual(fresh.ram, ram);
  assert.deepEqual(fresh.cpu.snapshot(), initialState());
  checkMemory(fresh.ram);
});
