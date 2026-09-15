import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu68000 } from "../../../src/components/cpus/68000.js";
import type { Cpu68000Snapshot, Cpu68000StepRecord, Cpu68000MemoryAccess } from "../../../src/components/cpus/68000.js";
import type { Ram } from "../../../src/components/memory/ram.js";
import { create68000ExtendedExample, create68000ExtendedExampleMemory } from "../../../src/machines/generated/68000/extended-example.js";
import { runCpu } from "../../../src/runtime/run-cpu.js";

function initialState(supervisor = false): Cpu68000Snapshot {
  return { d0: 0x11223344, d1: 0x55667788, d2: 0x99aabbcc, d3: 0xddeeff00,
    d4: 0x01234567, d5: 0x89abcdef, d6: 0xfedcba98, d7: 0x76543210,
    a0: 0x10000000, a1: 0x20000000, a2: 0x30000000, a3: 0x40000000,
    a4: 0x50000000, a5: 0x60000000, a6: 0x70000000, usp: 0x34008000, ssp: 0x56009000,
    pc: 0xab002000, a7: supervisor ? 0x56009000 : 0x34008000, physicalPc: 0x2000, halted: false, interruptMask: supervisor ? 7 : 2,
    flags: { x: true, n: false, z: true, v: true, c: true, t: false, s: supervisor } };
}
const read = (address: number, ...bytes: number[]): Cpu68000MemoryAccess[] =>
  bytes.map((value, offset) => ({ kind: "read", address: address + offset, value }));
const write = (address: number, ...bytes: number[]): Cpu68000MemoryAccess[] =>
  bytes.map((value, offset) => ({ kind: "write", address: address + offset, value }));
const long = (value: number): number[] => [Math.floor(value / 0x1000000), Math.floor(value / 0x10000) % 256, Math.floor(value / 256) % 256, value % 256];
const program = [0x41, 0xf9, 0xab, 0, 0x30, 8, 0x43, 0xf9, 0xcd, 0, 0x40, 8, 0x90, 0x80,
  0xd3, 0x88, 0xd3, 0x88, 0x59, 0xc4, 0x24, 0x19, 0x26, 0x19, 0x41, 0xf9, 0xab, 0, 0x30, 8,
  0x90, 0x80, 0x93, 0x88, 0x93, 0x88, 0x70, 1, 0x72, 0, 0x9a, 0x85, 0x97, 0x80, 0x95, 0x81,
  0x9a, 0x85, 0xd7, 0x80, 0xd5, 0x81, 0x45, 0xf9, 0xef, 0, 0x50, 0, 0x47, 0xf9, 0x56, 0, 0x60, 0,
  0x7e, 1, 0xb3, 0x8a, 0x57, 0xdb, 0x51, 0xcf, 0xff, 0xfa];

function expectedRecords(supervisor = false): Cpu68000StepRecord[] {
  let before = initialState(supervisor);
  const records: Cpu68000StepRecord[] = [];
  function step(bytes: number[], nextPc: number, changes: Partial<Cpu68000Snapshot> = {}, condition?: string,
    data: Cpu68000MemoryAccess[] = []): void {
    const flags = condition === undefined ? { ...before.flags } : { ...before.flags,
      x: condition[0] === "1", n: condition[1] === "1", z: condition[2] === "1", v: condition[3] === "1", c: condition[4] === "1" };
    const after = { ...before, ...changes, flags, pc: 0xab000000 + nextPc, physicalPc: nextPc };
    records.push({ before, after, outcome: "executed", instruction: { address: before.pc, bytes },
      accesses: [...read(before.physicalPc, ...bytes), ...data] });
    before = after;
  }
  step([0x41, 0xf9, 0xab, 0, 0x30, 8], 0x2006, { a0: 0xab003008 });
  step([0x43, 0xf9, 0xcd, 0, 0x40, 8], 0x200c, { a1: 0xcd004008 });
  step([0x90, 0x80], 0x200e, { d0: 0 }, "00100");
  step([0xd3, 0x88], 0x2010, { a0: 0xab003004, a1: 0xcd004004 }, "10101",
    [...read(0x3004, ...long(1)), ...read(0x4004, ...long(0xffffffff)), ...write(0x4004, ...long(0))]);
  step([0xd3, 0x88], 0x2012, { a0: 0xab003000, a1: 0xcd004000 }, "01010",
    [...read(0x3000, ...long(0)), ...read(0x4000, ...long(0x7fffffff)), ...write(0x4000, ...long(0x80000000))]);
  step([0x59, 0xc4], 0x2014, { d4: 0x012345ff });
  step([0x24, 0x19], 0x2016, { d2: 0x80000000, a1: 0xcd004004 }, "01000", read(0x4000, ...long(0x80000000)));
  step([0x26, 0x19], 0x2018, { d3: 0, a1: 0xcd004008 }, "00100", read(0x4004, ...long(0)));
  step([0x41, 0xf9, 0xab, 0, 0x30, 8], 0x201e, { a0: 0xab003008 });
  step([0x90, 0x80], 0x2020, { d0: 0 }, "00100");
  step([0x93, 0x88], 0x2022, { a0: 0xab003004, a1: 0xcd004004 }, "11001",
    [...read(0x3004, ...long(1)), ...read(0x4004, ...long(0)), ...write(0x4004, ...long(0xffffffff))]);
  step([0x93, 0x88], 0x2024, { a0: 0xab003000, a1: 0xcd004000 }, "00010",
    [...read(0x3000, ...long(0)), ...read(0x4000, ...long(0x80000000)), ...write(0x4000, ...long(0x7fffffff))]);
  step([0x70, 1], 0x2026, { d0: 1 }, "00000");
  step([0x72, 0], 0x2028, { d1: 0 }, "00100");
  step([0x9a, 0x85], 0x202a, { d5: 0 }, "00100");
  step([0x97, 0x80], 0x202c, { d3: 0xffffffff }, "11001");
  step([0x95, 0x81], 0x202e, { d2: 0x7fffffff }, "00010");
  step([0x9a, 0x85], 0x2030, {}, "00100");
  step([0xd7, 0x80], 0x2032, { d3: 0 }, "10101");
  step([0xd5, 0x81], 0x2034, { d2: 0x80000000 }, "01010");
  step([0x45, 0xf9, 0xef, 0, 0x50, 0], 0x203a, { a2: 0xef005000 });
  step([0x47, 0xf9, 0x56, 0, 0x60, 0], 0x2040, { a3: 0x56006000 });
  step([0x7e, 1], 0x2042, { d7: 1 }, "00000");
  for (const [index, value] of [0x7fffffff, 0xffffffff].entries()) {
    step([0xb3, 0x8a], 0x2044, { a2: 0xef005004 + index * 4, a1: 0xcd004004 + index * 4 }, "00100",
      [...read(0x5000 + index * 4, ...long(value)), ...read(0x4000 + index * 4, ...long(value))]);
    step([0x57, 0xdb], 0x2046, { a3: 0x56006001 + index }, undefined,
      [...read(0x6000 + index, 0xcc), ...write(0x6000 + index, 0xff)]);
    step([0x51, 0xcf, 0xff, 0xfa], index === 0 ? 0x2042 : 0x204a, { d7: index === 0 ? 0 : 0xffff });
  }
  return records;
}

function checkMemory(ram: Ram, finished = false): void {
  const expected = new Uint8Array(0x1000000);
  expected.set([0x56, 0, 0x90, 0, 0xab, 0, 0x20, 0]);
  expected.set(program, 0x2000);
  expected.set([0xde, 0xad, ...long(0), ...long(1), 0xbe, 0xef], 0x2ffe);
  for (const address of [0x3ffe, 0x4ffe]) expected.set([0xde, 0xad, ...long(0x7fffffff), ...long(0xffffffff), 0xbe, 0xef], address);
  expected.set([0xde, 0xad, ...(finished ? [255, 255] : [0xcc, 0xcc]), 0xbe, 0xef], 0x5ffe);
  for (const [address, value] of expected.entries()) assert.equal(ram.read(address), value, `memory at ${address}`);
}

test("68000 extended factories own their state and RAM and expose the full logical endpoint", () => {
  const first = create68000ExtendedExample();
  const second = create68000ExtendedExample();
  const memory = create68000ExtendedExampleMemory();
  assert.deepEqual(first.cpu.snapshot(), initialState());
  assert.equal(first.endAddress, 0xab00204a);
  checkMemory(first.ram);
  checkMemory(memory);
  first.cpu.step();
  first.ram.write(0x3007, 2);
  memory.write(0x4000, 0);
  assert.deepEqual(second.cpu.snapshot(), initialState());
  assert.equal(second.ram.read(0x3007), 1);
  assert.equal(second.ram.read(0x4000), 0x7f);
});

test("68000 extended example adds, restores, and compares 64-bit values in 29 exact records in both modes", t => {
  for (const supervisor of [false, true]) {
    const { cpu, ram, endAddress } = create68000ExtendedExample();
    if (supervisor) assert.deepEqual(cpu.reset(), { before: initialState(), after: initialState(true),
      accesses: read(0, 0x56, 0, 0x90, 0, 0xab, 0, 0x20, 0) });
    const reads = t.mock.method(ram, "read");
    const writes = t.mock.method(ram, "write");
    const records = expectedRecords(supervisor);
    assert.equal(records.length, 29);
    assert.deepEqual(runCpu(cpu, { maxSteps: 29, endAddress }), { stopReason: "completed", records });
    const accesses = records.flatMap(record => record.accesses);
    assert.deepEqual(reads.mock.calls.map(call => call.arguments), accesses.filter(a => a.kind === "read").map(a => [a.address]));
    assert.deepEqual(writes.mock.calls.map(call => call.arguments), accesses.filter(a => a.kind === "write").map(a => [a.address, a.value]));
    assert.deepEqual(cpu.snapshot(), records[28]!.after);
    assert.equal(runCpu(cpu, { maxSteps: 0, endAddress }).stopReason, "completed");
    assert.equal(runCpu(cpu, { maxSteps: 0, endAddress: 0x204a }).stopReason, "step-limit");
    t.mock.restoreAll();
    checkMemory(ram, true);
  }
});

test("68000 extended example resumes between low and high longs using saved X and cumulative Z", () => {
  for (const budget of [4, 11, 16, 19]) {
    const { cpu, ram, endAddress } = create68000ExtendedExample();
    const records = expectedRecords();
    const first = runCpu(cpu, { maxSteps: budget, endAddress });
    const saved = structuredClone(first);
    assert.deepEqual(first, { stopReason: "step-limit", records: records.slice(0, budget) });
    assert.equal(cpu.snapshot().flags.x, true);
    assert.equal(cpu.snapshot().flags.z, budget === 4 || budget === 19);
    const restoredRam = create68000ExtendedExampleMemory();
    for (const access of first.records.flatMap(record => record.accesses)) {
      if (access.kind === "write") restoredRam.write(access.address, access.value);
    }
    const restored = new Cpu68000(restoredRam, cpu.snapshot());
    for (const running of [cpu, restored]) {
      assert.deepEqual(runCpu(running, { maxSteps: 29 - budget, endAddress }), { stopReason: "completed", records: records.slice(budget) });
    }
    checkMemory(ram, true);
    checkMemory(restoredRam, true);
    cpu.reset();
    assert.deepEqual(first, saved);
  }
});

test("68000 extended example consumes live addends and comparison data and preserves results on reset", () => {
  const { cpu, ram, endAddress } = create68000ExtendedExample();
  ram.write(0x3007, 2); // Sum is now 80000000:00000001.
  ram.write(0x5007, 0xfe); // Restored low long no longer matches the reference.
  assert.equal(runCpu(cpu, { maxSteps: 29, endAddress }).stopReason, "completed");
  assert.equal(cpu.snapshot().d2, 0x80000000);
  assert.equal(cpu.snapshot().d3, 1);
  assert.equal(cpu.snapshot().d4, 0x012345ff);
  assert.deepEqual(Array.from({ length: 8 }, (_, offset) => ram.read(0x4000 + offset)), [...long(0x7fffffff), ...long(0xffffffff)]);
  assert.equal(ram.read(0x6000), 0xff);
  assert.equal(ram.read(0x6001), 0);
  assert.equal(cpu.snapshot().flags.z, false);
  cpu.reset();
  assert.equal(cpu.snapshot().pc, 0xab002000);
  assert.equal(cpu.snapshot().d3, 1);
  assert.equal(ram.read(0x6001), 0);
});
