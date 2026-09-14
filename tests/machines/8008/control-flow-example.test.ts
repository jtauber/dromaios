import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu8008 } from "../../../src/components/cpus/8008.js";
import type { Cpu8008MemoryAccess, Cpu8008Snapshot, Cpu8008StepRecord } from "../../../src/components/cpus/8008.js";
import type { Ram } from "../../../src/components/memory/ram.js";
import { create8008ControlFlowExample, create8008ControlFlowExampleMemory } from "../../../src/machines/generated/8008/control-flow-example.js";
import { runCpu } from "../../../src/runtime/run-cpu.js";

function expectedInitialState(): Cpu8008Snapshot {
  return { a: 0x11, b: 0x22, c: 0x33, d: 0x44, e: 0x55, h: 0xc0, l: 0x80, hl: 0xc080, pc: 0x0200,
    flags: { s: true, z: false, p: true, c: true },
    addressStack: [0x1111, 0x1222, 0x1333, 0x1444, 0x1555, 0x1666, 0x1777, 0x0200], stackIndex: 7, halted: false };
}

function checkMemory(ram: Ram, result = 0): void {
  // Literal images from the specification, independent of the generated factory.
  const expected = new Uint8Array(0x4000);
  expected.set([0xcc, result, 0xcc], 0x7f);
  expected.set([0x16, 0x03, 0x0e, 0x00, 0xc2, 0x3c, 0x00, 0x4a, 0x00, 0x83,
    0x48, 0x04, 0xc2, 0x4a, 0x00, 0x83, 0xc1, 0x24, 0x0f, 0x3c, 0x06,
    0x68, 0x1b, 0xc2, 0x06, 0xff, 0x00, 0xf8, 0xff], 0x0200);
  expected.set([0x2b, 0xc1, 0x82, 0xc8, 0xc2, 0x14, 0x01, 0xd0, 0x0b, 0x2b, 0x22], 0x0300);
  assert.equal(ram.size, expected.length);
  for (const [address, byte] of expected.entries()) assert.equal(ram.read(address), byte, `memory at ${address}`);
}

function expectedRecords(): readonly Cpu8008StepRecord[] {
  // Each row specifies the next PC, selector, and contents of physical slots 0 and 7.
  // Other slots never change. Results and flags are literal, not computed by an ALU oracle.
  const steps: readonly {
    bytes: readonly number[]; pc: number; slot: 0 | 7; slots: readonly [number, number];
    changes?: Partial<Cpu8008Snapshot>; data?: readonly Cpu8008MemoryAccess[];
  }[] = [
    { bytes: [0x16, 3], pc: 0x0202, slot: 7, slots: [0x1111, 0x0202], changes: { c: 3 } },
    { bytes: [0x0e, 0], pc: 0x0204, slot: 7, slots: [0x1111, 0x0204], changes: { b: 0 } },
    // First iteration: sum 3, remaining count 2; RFZ returns and JFZ repeats.
    { bytes: [0xc2], pc: 0x0205, slot: 7, slots: [0x1111, 0x0205], changes: { a: 3 } },
    { bytes: [0x3c, 0], pc: 0x0207, slot: 7, slots: [0x1111, 0x0207],
      changes: { flags: { s: false, z: false, p: true, c: false } } },
    { bytes: [0x4a, 0, 0x83], pc: 0x0300, slot: 0, slots: [0x0300, 0x020a] },
    { bytes: [0x2b], pc: 0x0301, slot: 0, slots: [0x0301, 0x020a] },
    { bytes: [0xc1], pc: 0x0302, slot: 0, slots: [0x0302, 0x020a], changes: { a: 0 } },
    { bytes: [0x82], pc: 0x0303, slot: 0, slots: [0x0303, 0x020a],
      changes: { a: 3, flags: { s: false, z: false, p: true, c: false } } },
    { bytes: [0xc8], pc: 0x0304, slot: 0, slots: [0x0304, 0x020a], changes: { b: 3 } },
    { bytes: [0xc2], pc: 0x0305, slot: 0, slots: [0x0305, 0x020a], changes: { a: 3 } },
    { bytes: [0x14, 1], pc: 0x0307, slot: 0, slots: [0x0307, 0x020a],
      changes: { a: 2, flags: { s: false, z: false, p: false, c: false } } },
    { bytes: [0xd0], pc: 0x0308, slot: 0, slots: [0x0308, 0x020a], changes: { c: 2 } },
    { bytes: [0x0b], pc: 0x020a, slot: 7, slots: [0x0309, 0x020a] },
    { bytes: [0x48, 4, 0xc2], pc: 0x0204, slot: 7, slots: [0x0309, 0x0204] },
    // Second iteration: sum 5, remaining count 1; the same paths are taken.
    { bytes: [0xc2], pc: 0x0205, slot: 7, slots: [0x0309, 0x0205], changes: { a: 2 } },
    { bytes: [0x3c, 0], pc: 0x0207, slot: 7, slots: [0x0309, 0x0207],
      changes: { flags: { s: false, z: false, p: false, c: false } } },
    { bytes: [0x4a, 0, 0x83], pc: 0x0300, slot: 0, slots: [0x0300, 0x020a] },
    { bytes: [0x2b], pc: 0x0301, slot: 0, slots: [0x0301, 0x020a] },
    { bytes: [0xc1], pc: 0x0302, slot: 0, slots: [0x0302, 0x020a], changes: { a: 3 } },
    { bytes: [0x82], pc: 0x0303, slot: 0, slots: [0x0303, 0x020a],
      changes: { a: 5, flags: { s: false, z: false, p: true, c: false } } },
    { bytes: [0xc8], pc: 0x0304, slot: 0, slots: [0x0304, 0x020a], changes: { b: 5 } },
    { bytes: [0xc2], pc: 0x0305, slot: 0, slots: [0x0305, 0x020a], changes: { a: 2 } },
    { bytes: [0x14, 1], pc: 0x0307, slot: 0, slots: [0x0307, 0x020a],
      changes: { a: 1, flags: { s: false, z: false, p: false, c: false } } },
    { bytes: [0xd0], pc: 0x0308, slot: 0, slots: [0x0308, 0x020a], changes: { c: 1 } },
    { bytes: [0x0b], pc: 0x020a, slot: 7, slots: [0x0309, 0x020a] },
    { bytes: [0x48, 4, 0xc2], pc: 0x0204, slot: 7, slots: [0x0309, 0x0204] },
    // Third iteration: sum 6, remaining count 0; RFZ falls through to RTZ.
    { bytes: [0xc2], pc: 0x0205, slot: 7, slots: [0x0309, 0x0205], changes: { a: 1 } },
    { bytes: [0x3c, 0], pc: 0x0207, slot: 7, slots: [0x0309, 0x0207],
      changes: { flags: { s: false, z: false, p: false, c: false } } },
    { bytes: [0x4a, 0, 0x83], pc: 0x0300, slot: 0, slots: [0x0300, 0x020a] },
    { bytes: [0x2b], pc: 0x0301, slot: 0, slots: [0x0301, 0x020a] },
    { bytes: [0xc1], pc: 0x0302, slot: 0, slots: [0x0302, 0x020a], changes: { a: 5 } },
    { bytes: [0x82], pc: 0x0303, slot: 0, slots: [0x0303, 0x020a],
      changes: { a: 6, flags: { s: false, z: false, p: true, c: false } } },
    { bytes: [0xc8], pc: 0x0304, slot: 0, slots: [0x0304, 0x020a], changes: { b: 6 } },
    { bytes: [0xc2], pc: 0x0305, slot: 0, slots: [0x0305, 0x020a], changes: { a: 1 } },
    { bytes: [0x14, 1], pc: 0x0307, slot: 0, slots: [0x0307, 0x020a],
      changes: { a: 0, flags: { s: false, z: true, p: true, c: false } } },
    { bytes: [0xd0], pc: 0x0308, slot: 0, slots: [0x0308, 0x020a], changes: { c: 0 } },
    { bytes: [0x0b], pc: 0x0309, slot: 0, slots: [0x0309, 0x020a] },
    { bytes: [0x2b], pc: 0x020a, slot: 7, slots: [0x030a, 0x020a] },
    { bytes: [0x48, 4, 0xc2], pc: 0x020d, slot: 7, slots: [0x030a, 0x020d] },
    // No further call; mask, compare, and skip the failure path before storing.
    { bytes: [0x4a, 0, 0x83], pc: 0x0210, slot: 7, slots: [0x030a, 0x0210] },
    { bytes: [0xc1], pc: 0x0211, slot: 7, slots: [0x030a, 0x0211], changes: { a: 6 } },
    { bytes: [0x24, 0x0f], pc: 0x0213, slot: 7, slots: [0x030a, 0x0213],
      changes: { flags: { s: false, z: false, p: true, c: false } } },
    { bytes: [0x3c, 6], pc: 0x0215, slot: 7, slots: [0x030a, 0x0215],
      changes: { flags: { s: false, z: true, p: true, c: false } } },
    { bytes: [0x68, 0x1b, 0xc2], pc: 0x021b, slot: 7, slots: [0x030a, 0x021b] },
    { bytes: [0xf8], pc: 0x021c, slot: 7, slots: [0x030a, 0x021c], data: [{ kind: "write", address: 0x80, value: 6 }] },
    { bytes: [0xff], pc: 0x021d, slot: 7, slots: [0x030a, 0x021d], changes: { halted: true } },
  ];
  let state = expectedInitialState();
  return steps.map(({ bytes, pc, slot, slots, changes = {}, data = [] }) => {
    const before = state;
    state = { ...before, ...changes, pc, stackIndex: slot,
      addressStack: [slots[0], 0x1222, 0x1333, 0x1444, 0x1555, 0x1666, 0x1777, slots[1]] };
    return { before, after: state, instruction: { address: before.pc, bytes },
      accesses: [...bytes.map((value, offset): Cpu8008MemoryAccess => ({ kind: "read", address: before.pc + offset, value })), ...data],
      outcome: state.halted ? "halted" : "executed" };
  });
}

test("8008 control-flow factories create independent components with the complete initial memory image", () => {
  const { cpu, ram } = create8008ControlFlowExample();
  const memory = create8008ControlFlowExampleMemory();
  assert.notStrictEqual(memory, ram);
  assert.deepEqual(cpu.snapshot(), expectedInitialState());
  checkMemory(ram);
  checkMemory(memory);
  ram.write(0x80, 0xff);
  assert.equal(memory.read(0x80), 0);
});

test("8008 conditional control flow sums three counts, takes both paths of each family, and stores 06 in 46 steps", t => {
  const { cpu, ram } = create8008ControlFlowExample();
  const read = t.mock.method(ram, "read");
  const write = t.mock.method(ram, "write");
  const expected = expectedRecords();
  assert.deepEqual(runCpu(cpu, { maxSteps: 46 }), { records: expected, stopReason: "halted" });
  const reads = expected.flatMap(record => record.accesses).filter(access => access.kind === "read");
  assert.deepEqual(read.mock.calls.map(call => call.arguments), reads.map(access => [access.address]));
  assert.deepEqual(write.mock.calls.map(call => call.arguments), [[0x80, 6]]);
  const final = expected.at(-1)!.after;
  assert.deepEqual(cpu.snapshot(), final);
  assert.deepEqual(cpu.step(), { before: final, after: final, instruction: null, accesses: [], outcome: "halted" });
  assert.equal(read.mock.callCount(), 72);
  assert.equal(write.mock.callCount(), 1);
  t.mock.restoreAll();
  checkMemory(ram, 6);
});

test("8008 control flow resumes between untaken and taken returns with its internal stack intact", () => {
  const { cpu, ram } = create8008ControlFlowExample();
  const first = runCpu(cpu, { maxSteps: 37 });
  const saved = structuredClone(first);
  const expected = expectedRecords();
  assert.deepEqual(first, { records: expected.slice(0, 37), stopReason: "step-limit" });
  checkMemory(ram);
  const paused = cpu.snapshot();
  assert.equal(paused.stackIndex, 0);
  assert.equal(paused.pc, 0x0309);
  const resumed = new Cpu8008(ram, paused);
  Reflect.set(paused.flags, "z", false);
  Reflect.set(paused.addressStack, 0, 0);
  assert.deepEqual(runCpu(resumed, { maxSteps: 9 }), { records: expected.slice(37), stopReason: "halted" });
  const before = resumed.snapshot();
  const after: Cpu8008Snapshot = { a: 0, b: 0, c: 0, d: 0, e: 0, h: 0, l: 0, hl: 0, pc: 0,
    flags: { s: false, z: true, p: true, c: false },
    addressStack: [0, 0, 0, 0, 0, 0, 0, 0], stackIndex: 0, halted: true };
  const reset = resumed.reset();
  assert.deepEqual(reset, { before, after, accesses: [] });
  assert.deepEqual(resumed.step(), { before: after, after, instruction: null, accesses: [], outcome: "halted" });
  checkMemory(ram, 6);
  Reflect.set(reset.before.flags, "z", false);
  ram.write(0x80, 0xff);
  assert.deepEqual(first, saved);
  const fresh = create8008ControlFlowExample();
  assert.notStrictEqual(fresh.cpu, cpu);
  assert.notStrictEqual(fresh.ram, ram);
  assert.deepEqual(fresh.cpu.snapshot(), expectedInitialState());
  checkMemory(fresh.ram);
});
