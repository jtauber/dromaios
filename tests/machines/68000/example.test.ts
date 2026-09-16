import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu68000 } from "../../../src/components/cpus/68000.js";
import type { Cpu68000Snapshot, Cpu68000StepRecord } from "../../../src/components/cpus/68000.js";
import type { Ram } from "../../../src/components/memory/ram.js";
import { create68000Example, create68000ExampleMemory } from "../../../src/machines/generated/68000/example.js";
import { runCpu } from "../../../src/runtime/run-cpu.js";

function initialState(): Cpu68000Snapshot {
  return { d0: 0x11223344, d1: 0x55667788, d2: 0x99aabbcc, d3: 0xddeeff00,
    d4: 0x01234567, d5: 0x89abcdef, d6: 0xfedcba98, d7: 0x76543210,
    a0: 0x10000000, a1: 0x20000000, a2: 0x30000000, a3: 0x40000000,
    a4: 0x50000000, a5: 0x60000000, a6: 0x70000000, usp: 0x34ffe000, ssp: 0x56ffd000,
    pc: 0xab001000, ir: 0, faulted: false, halted: false, tracePending: false, interruptMask: 2, a7: 0x34ffe000, physicalPc: 0x1000,
    flags: { x: true, n: false, z: true, v: true, c: true, t: false, s: false } };
}

function checkMemory(ram: Ram, finished = false): void {
  const expected = new Uint8Array(0x1000000);
  expected.set([0x12, 0xff, 0xf0, 0, 0xab, 0, 0x10, 0]);
  expected.set([0x20, 0x3c, 0x7f, 0xff, 0xff, 0xff, 6, 0x80, 0, 0, 0, 1, 0x23, 0xc0, 0xcd, 2, 0, 0x82], 0x1000);
  if (finished) expected.set([0x80, 0, 0, 0], 0x20082);
  assert.equal(ram.size, expected.length);
  for (const [address, value] of expected.entries()) assert.equal(ram.read(address), value, `memory at ${address}`);
}

function expectedRecords(): readonly Cpu68000StepRecord[] {
  const before = initialState();
  const load = { ...before, ir: 0x203c, d0: 0x7fffffff, pc: 0xab001006, physicalPc: 0x1006,
    flags: { x: true, n: false, z: false, v: false, c: false, t: false, s: false } };
  const add = { ...load, ir: 0x0680, d0: 0x80000000, pc: 0xab00100c, physicalPc: 0x100c,
    flags: { x: false, n: true, z: false, v: true, c: false, t: false, s: false } };
  const store = { ...add, ir: 0x23c0, pc: 0xab001012, physicalPc: 0x1012, flags: { ...add.flags, v: false } };
  return [
    { before, after: load, outcome: "executed", instruction: { address: 0xab001000, bytes: [0x20, 0x3c, 0x7f, 0xff, 0xff, 0xff] },
      accesses: [{ kind: "read", address: 0x1000, value: 0x20 }, { kind: "read", address: 0x1001, value: 0x3c },
        { kind: "read", address: 0x1002, value: 0x7f }, { kind: "read", address: 0x1003, value: 0xff },
        { kind: "read", address: 0x1004, value: 0xff }, { kind: "read", address: 0x1005, value: 0xff }] },
    { before: load, after: add, outcome: "executed", instruction: { address: 0xab001006, bytes: [6, 0x80, 0, 0, 0, 1] },
      accesses: [{ kind: "read", address: 0x1006, value: 6 }, { kind: "read", address: 0x1007, value: 0x80 },
        { kind: "read", address: 0x1008, value: 0 }, { kind: "read", address: 0x1009, value: 0 },
        { kind: "read", address: 0x100a, value: 0 }, { kind: "read", address: 0x100b, value: 1 }] },
    { before: add, after: store, outcome: "executed", instruction: { address: 0xab00100c, bytes: [0x23, 0xc0, 0xcd, 2, 0, 0x82] },
      accesses: [{ kind: "read", address: 0x100c, value: 0x23 }, { kind: "read", address: 0x100d, value: 0xc0 },
        { kind: "read", address: 0x100e, value: 0xcd }, { kind: "read", address: 0x100f, value: 2 },
        { kind: "read", address: 0x1010, value: 0 }, { kind: "read", address: 0x1011, value: 0x82 },
        { kind: "write", address: 0x20082, value: 0x80 }, { kind: "write", address: 0x20083, value: 0 },
        { kind: "write", address: 0x20084, value: 0 }, { kind: "write", address: 0x20085, value: 0 }] },
  ];
}

test("68000 factories own separate full 16 MiB images and explicit state with derived A7 and physical PC", () => {
  const memory = create68000ExampleMemory();
  const first = create68000Example();
  const second = create68000Example();
  checkMemory(memory);
  checkMemory(first.ram);
  memory.write(0x1000, 0);
  first.cpu.step();
  first.ram.write(0x20082, 0xff);
  assert.notStrictEqual(first.cpu, second.cpu);
  assert.notStrictEqual(first.ram, second.ram);
  assert.deepEqual(second.cpu.snapshot(), initialState());
  assert.equal(second.endAddress, 0xab001012);
  checkMemory(second.ram);
});

test("68000 example records long arithmetic and physical accesses, completing at the full logical PC", t => {
  const { cpu, ram, endAddress } = create68000Example();
  const read = t.mock.method(ram, "read");
  const write = t.mock.method(ram, "write");
  const records = expectedRecords();
  assert.deepEqual(runCpu(cpu, { maxSteps: 3, endAddress }), { records, stopReason: "completed" });
  assert.deepEqual(read.mock.calls.map(call => call.arguments), Array.from({ length: 18 }, (_, offset) => [0x1000 + offset]));
  assert.deepEqual(write.mock.calls.map(call => call.arguments), [[0x20082, 0x80], [0x20083, 0], [0x20084, 0], [0x20085, 0]]);
  assert.deepEqual(runCpu(cpu, { maxSteps: 0, endAddress: 0x1012 }), { records: [], stopReason: "step-limit" });
  assert.deepEqual(runCpu(cpu, { maxSteps: 0, endAddress }), { records: [], stopReason: "completed" });
  assert.equal(read.mock.callCount(), 18);
  t.mock.restoreAll();
  checkMemory(ram, true);
  assert.deepEqual(cpu.snapshot(), records[2]!.after);
  // Zero-filled memory now executes ORI.B #0,D0; only the caller's end address marks completion.
  const continued = runCpu(cpu, { maxSteps: 1 });
  assert.equal(continued.stopReason, "step-limit");
  const before = records[2]!.after;
  assert.deepEqual(continued.records, [{ before,
    after: { ...before, ir: 0, pc: 0xab001016, physicalPc: 0x1016, flags: { ...before.flags, n: false, z: true } },
    outcome: "executed", instruction: { address: before.pc, bytes: [0, 0, 0, 0] },
    accesses: [0x1012, 0x1013, 0x1014, 0x1015].map(address => ({ kind: "read", address, value: 0 })) }]);
});

test("68000 example pauses and resumes, resets from vectors, and restarts with independent initial state", () => {
  const { cpu, ram, endAddress } = create68000Example();
  const expected = expectedRecords();
  const first = runCpu(cpu, { maxSteps: 1, endAddress });
  const saved = structuredClone(first);
  assert.deepEqual(first, { records: expected.slice(0, 1), stopReason: "step-limit" });
  assert.deepEqual(runCpu(cpu, { maxSteps: 2, endAddress }), { records: expected.slice(1), stopReason: "completed" });
  const before = expected[2]!.after;
  const after = { ...before, ssp: 0x12fff000, a7: 0x12fff000, pc: 0xab001000, physicalPc: 0x1000,
    interruptMask: 7, flags: { ...before.flags, s: true, t: false } };
  assert.deepEqual(cpu.reset(), { before, after, accesses: [
    { kind: "read", address: 0, value: 0x12 }, { kind: "read", address: 1, value: 0xff },
    { kind: "read", address: 2, value: 0xf0 }, { kind: "read", address: 3, value: 0 },
    { kind: "read", address: 4, value: 0xab }, { kind: "read", address: 5, value: 0 },
    { kind: "read", address: 6, value: 0x10 }, { kind: "read", address: 7, value: 0 },
  ] });
  checkMemory(ram, true);
  assert.equal(runCpu(cpu, { maxSteps: 3, endAddress }).stopReason, "completed");
  assert.equal(cpu.snapshot().a7, 0x12fff000);
  assert.deepEqual(first, saved);
  const fresh = create68000Example();
  assert.deepEqual(fresh.cpu.snapshot(), initialState());
  assert.deepEqual(runCpu(fresh.cpu, { maxSteps: 3 }), { records: expected, stopReason: "step-limit" });
});

test("68000 runner follows vector 3 and software removes the extended frame before RTE", () => {
  const { cpu, ram, endAddress } = create68000Example();
  ram.write(0x1011, 0x83);
  [0, 0, 0x30, 0].forEach((b, i) => ram.write(12 + i, b));
  // The saved PC already points past the failed store. Discard SSW/address/IR, then RTE.
  [0x50, 0x8f, 0x4e, 0x73].forEach((b, i) => ram.write(0x3000 + i, b)); // ADDQ.L #8,A7; RTE
  const result = runCpu(cpu, { maxSteps: 5, endAddress });
  assert.equal(result.stopReason, "completed");
  assert.equal(result.records.length, 5);
  const fault = result.records[2]!;
  assert.equal(fault.exception?.source, "address-error");
  if (fault.exception?.source !== "address-error") assert.fail();
  assert.equal(fault.exception.fault.address, 0xcd020083);
  assert.equal(fault.exception.fault.operation, "write");
  assert.deepEqual(fault.before, expectedRecords()[1]!.after);
  assert.equal(fault.after.ssp, fault.before.ssp - 14);
  assert.equal(fault.after.pc, 0x3000);
  assert.equal(ram.read(0x20083), 0);
  assert.equal(cpu.snapshot().ssp, initialState().ssp);
  assert.equal(cpu.snapshot().a7, initialState().usp);
  assert.equal(cpu.snapshot().ir, 0x4e73);
  assert.deepEqual(cpu.snapshot().flags, fault.before.flags);
  const saved = structuredClone(result);
  const replay = create68000Example();
  replay.ram.write(0x1011, 0x83);
  [0, 0, 0x30, 0].forEach((b, i) => replay.ram.write(12 + i, b));
  [0x50, 0x8f, 0x4e, 0x73].forEach((b, i) => replay.ram.write(0x3000 + i, b));
  let restored = replay.cpu;
  for (const expected of result.records) {
    assert.deepEqual(restored.step(), expected);
    restored = new Cpu68000(replay.ram, restored.snapshot());
  }
  cpu.reset();
  assert.deepEqual(result, saved);
});
