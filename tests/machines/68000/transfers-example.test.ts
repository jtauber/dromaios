import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu68000 } from "../../../src/components/cpus/68000.js";
import type { Cpu68000Snapshot, Cpu68000StepRecord, Cpu68000MemoryAccess } from "../../../src/components/cpus/68000.js";
import type { Ram } from "../../../src/components/memory/ram.js";
import { create68000TransfersExample, create68000TransfersExampleMemory } from "../../../src/machines/generated/68000/transfers-example.js";
import { runCpu } from "../../../src/runtime/run-cpu.js";

function initialState(): Cpu68000Snapshot {
  return { d0: 0x11223344, d1: 0x55667788, d2: 0x99aabbcc, d3: 0xddeeff00,
    d4: 0x01234567, d5: 0x89abcdef, d6: 0xfedcba98, d7: 0x76543210,
    a0: 0x10000000, a1: 0x20000000, a2: 0x30000000, a3: 0x40000000,
    a4: 0x50000000, a5: 0x60000000, a6: 0x70000000, usp: 0x34ffe000, ssp: 0x56ffd000,
    pc: 0xab002000, interruptMask: 2, a7: 0x34ffe000, physicalPc: 0x2000,
    flags: { x: true, n: false, z: true, v: true, c: true, t: false, s: false } };
}

function checkMemory(ram: Ram, finished = false): void {
  const expected = new Uint8Array(0x1000000);
  expected.set([0x12, 0xff, 0xf0, 0, 0xab, 0, 0x20, 0]);
  expected.set([0x7e, 0xff, 0x24, 7, 6, 0x82, 0, 0, 0, 1, 0x2a, 0x3c, 0x7f, 0xff, 0xff, 0xff,
    6, 0x85, 0, 0, 0, 1, 0x22, 5, 0x23, 0xc1, 0xcd, 2, 0, 0x82, 0x23, 0xc2, 0xcd, 2, 0, 0x86], 0x2000);
  expected.set([0xde, 0xad, 0x11, 0x22, 0x33, 0x44, 0xaa, 0xbb, 0xcc, 0xdd, 0xbe, 0xef], 0x20080);
  if (finished) expected.set([0x80, 0, 0, 0, 0, 0, 0, 0], 0x20082);
  assert.equal(ram.size, expected.length);
  for (const [address, value] of expected.entries()) assert.equal(ram.read(address), value, `memory at ${address}`);
}

function expectedRecords(): readonly Cpu68000StepRecord[] {
  let before = initialState();
  const quick = { ...before, d7: 0xffffffff, pc: 0xab002002, physicalPc: 0x2002,
    flags: { x: true, n: true, z: false, v: false, c: false, t: false, s: false } };
  const copyNegative = { ...quick, d2: 0xffffffff, pc: 0xab002004, physicalPc: 0x2004 };
  const carry = { ...copyNegative, d2: 0, pc: 0xab00200a, physicalPc: 0x200a,
    flags: { x: true, n: false, z: true, v: false, c: true, t: false, s: false } };
  const load = { ...carry, d5: 0x7fffffff, pc: 0xab002010, physicalPc: 0x2010,
    flags: { x: true, n: false, z: false, v: false, c: false, t: false, s: false } };
  const overflow = { ...load, d5: 0x80000000, pc: 0xab002016, physicalPc: 0x2016,
    flags: { x: false, n: true, z: false, v: true, c: false, t: false, s: false } };
  const copyResult = { ...overflow, d1: 0x80000000, pc: 0xab002018, physicalPc: 0x2018,
    flags: { x: false, n: true, z: false, v: false, c: false, t: false, s: false } };
  const storeNegative = { ...copyResult, pc: 0xab00201e, physicalPc: 0x201e };
  const storeZero = { ...storeNegative, pc: 0xab002024, physicalPc: 0x2024,
    flags: { x: false, n: false, z: true, v: false, c: false, t: false, s: false } };
  const steps: readonly (readonly [number, readonly number[], Cpu68000Snapshot, readonly Cpu68000MemoryAccess[]])[] = [
    [0x2000, [0x7e, 0xff], quick, []],
    [0x2002, [0x24, 7], copyNegative, []],
    [0x2004, [6, 0x82, 0, 0, 0, 1], carry, []],
    [0x200a, [0x2a, 0x3c, 0x7f, 0xff, 0xff, 0xff], load, []],
    [0x2010, [6, 0x85, 0, 0, 0, 1], overflow, []],
    [0x2016, [0x22, 5], copyResult, []],
    [0x2018, [0x23, 0xc1, 0xcd, 2, 0, 0x82], storeNegative,
      [{ kind: "write", address: 0x20082, value: 0x80 }, { kind: "write", address: 0x20083, value: 0 },
        { kind: "write", address: 0x20084, value: 0 }, { kind: "write", address: 0x20085, value: 0 }]],
    [0x201e, [0x23, 0xc2, 0xcd, 2, 0, 0x86], storeZero,
      [{ kind: "write", address: 0x20086, value: 0 }, { kind: "write", address: 0x20087, value: 0 },
        { kind: "write", address: 0x20088, value: 0 }, { kind: "write", address: 0x20089, value: 0 }]],
  ];
  return steps.map(([physical, bytes, after, writes]) => {
    const record: Cpu68000StepRecord = { before, after, outcome: "executed", instruction: { address: before.pc, bytes },
      accesses: [...bytes.map((value, offset) => ({ kind: "read" as const, address: physical + offset, value })), ...writes] };
    before = after;
    return record;
  });
}

test("68000 transfer factories own full independent images, initial state, and a logical completion address", () => {
  const memory = create68000TransfersExampleMemory();
  const first = create68000TransfersExample();
  const second = create68000TransfersExample();
  checkMemory(memory);
  checkMemory(first.ram);
  assert.deepEqual(first.cpu.snapshot(), initialState());
  assert.equal(first.endAddress, 0xab002024);
  memory.write(0x2000, 0);
  first.ram.write(0x20086, 0);
  first.cpu.step();
  assert.notStrictEqual(first.cpu, second.cpu);
  assert.notStrictEqual(first.ram, second.ram);
  assert.deepEqual(second.cpu.snapshot(), initialState());
  checkMemory(second.ram);
});

test("68000 transfers distinguish carry and overflow through all five families with exact records and RAM calls", t => {
  const { cpu, ram, endAddress } = create68000TransfersExample();
  const read = t.mock.method(ram, "read");
  const write = t.mock.method(ram, "write");
  const records = expectedRecords();
  assert.deepEqual(runCpu(cpu, { maxSteps: 8, endAddress }), { records, stopReason: "completed" });
  assert.deepEqual(cpu.snapshot(), records[7]!.after);
  assert.deepEqual(read.mock.calls.map(call => call.arguments), Array.from({ length: 36 }, (_, offset) => [0x2000 + offset]));
  assert.deepEqual(write.mock.calls.map(call => call.arguments),
    [[0x20082, 0x80], [0x20083, 0], [0x20084, 0], [0x20085, 0], [0x20086, 0], [0x20087, 0], [0x20088, 0], [0x20089, 0]]);
  assert.deepEqual(runCpu(cpu, { maxSteps: 0, endAddress }), { records: [], stopReason: "completed" });
  assert.deepEqual(runCpu(cpu, { maxSteps: 0, endAddress: 0x2024 }), { records: [], stopReason: "step-limit" });
  assert.equal(read.mock.callCount(), 36);
  t.mock.restoreAll();
  checkMemory(ram, true);
  assert.equal(runCpu(cpu, { maxSteps: 1 }).stopReason, "unsupported");
});

test("68000 transfers pause, restore a snapshot, reset and rerun, and retain detached earlier records", () => {
  const { cpu, ram, endAddress } = create68000TransfersExample();
  const expected = expectedRecords();
  const first = runCpu(cpu, { maxSteps: 5, endAddress });
  const saved = structuredClone(first);
  assert.deepEqual(first, { records: expected.slice(0, 5), stopReason: "step-limit" });
  const restored = new Cpu68000(ram, cpu.snapshot());
  assert.deepEqual(runCpu(cpu, { maxSteps: 3, endAddress }), { records: expected.slice(5), stopReason: "completed" });
  assert.deepEqual(runCpu(restored, { maxSteps: 3, endAddress }), { records: expected.slice(5), stopReason: "completed" });
  assert.deepEqual(first, saved);
  const final = expected[7]!.after;
  const reset = cpu.reset();
  const after = { ...final, ssp: 0x12fff000, a7: 0x12fff000, pc: 0xab002000, physicalPc: 0x2000,
    interruptMask: 7, flags: { ...final.flags, s: true, t: false } };
  assert.deepEqual(reset, { before: final, after, accesses: [
    { kind: "read", address: 0, value: 0x12 }, { kind: "read", address: 1, value: 0xff },
    { kind: "read", address: 2, value: 0xf0 }, { kind: "read", address: 3, value: 0 },
    { kind: "read", address: 4, value: 0xab }, { kind: "read", address: 5, value: 0 },
    { kind: "read", address: 6, value: 0x20 }, { kind: "read", address: 7, value: 0 }], });
  checkMemory(ram, true);
  assert.equal(runCpu(cpu, { maxSteps: 8, endAddress }).stopReason, "completed");
  assert.deepEqual(cpu.snapshot(), { ...final, ssp: 0x12fff000, a7: 0x12fff000, interruptMask: 7, flags: { ...final.flags, s: true } });
  assert.deepEqual(reset.after, after);
  assert.deepEqual(first, saved);
  const live = cpu.snapshot();
  Reflect.set(first.records[0]!.after, "d7", 0);
  Reflect.set(first.records[0]!.after.flags, "s", true);
  assert.deepEqual(first.records[1]!.before, saved.records[1]!.before);
  assert.deepEqual(cpu.snapshot(), live);
  const fresh = create68000TransfersExample();
  assert.deepEqual(fresh.cpu.snapshot(), initialState());
  checkMemory(fresh.ram);
});
