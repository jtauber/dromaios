import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu68000 } from "../../../src/components/cpus/68000.js";
import type { Cpu68000Snapshot, Cpu68000StepRecord, Cpu68000MemoryAccess } from "../../../src/components/cpus/68000.js";
import type { Ram } from "../../../src/components/memory/ram.js";
import { create68000WordSumExample, create68000WordSumExampleMemory } from "../../../src/machines/generated/68000/word-sum-example.js";
import { runCpu } from "../../../src/runtime/run-cpu.js";

function initialState(supervisor = false): Cpu68000Snapshot {
  return { d0: 0x11223344, d1: 0x55667788, d2: 0x99aabbcc, d3: 0xddeeff00,
    d4: 0x01234567, d5: 0x89abcdef, d6: 0xfedcba98, d7: 0x76543210,
    a0: 0x10000000, a1: 0x20000000, a2: 0x30000000, a3: 0x40000000,
    a4: 0x50000000, a5: 0x60000000, a6: 0x70000000, usp: 0x34008000, ssp: 0x56009000,
    pc: 0xab002000, a7: supervisor ? 0x56009000 : 0x34008000, physicalPc: 0x2000, ir: 0, faulted: false, entry: { kind: supervisor ? "reset" : "none", vector: 0 }, halted: false, tracePending: false, interruptMask: supervisor ? 7 : 2,
    flags: { x: true, n: false, z: true, v: true, c: true, t: false, s: supervisor } };
}

const read = (address: number, ...bytes: number[]): Cpu68000MemoryAccess[] =>
  bytes.map((value, offset) => ({ kind: "read", address: address + offset, value }));
const write = (address: number, ...bytes: number[]): Cpu68000MemoryAccess[] =>
  bytes.map((value, offset) => ({ kind: "write", address: address + offset, value }));
const word = (value: number): number[] => [Math.floor(value / 256), value % 256];
const program = [0x20, 0x7c, 0xab, 0, 0x30, 0, 0x22, 0x48, 0xd2, 0xfc, 0, 8,
  0x24, 0x7c, 0xcd, 0, 0x40, 0, 0x70, 0, 0x34, 0x80, 0x32, 0x18, 0xd0, 0x41,
  0xd3, 0x52, 0xb1, 0xc9, 0x65, 0xf6, 0x74, 1, 0x90, 0x42, 0x95, 0x52, 0xb0, 0x52,
  0x90, 0xfc, 0, 8, 0xd2, 0xfc, 0xff, 0xfe];

function expectedRecords(supervisor = false): Cpu68000StepRecord[] {
  let before = initialState(supervisor);
  const records: Cpu68000StepRecord[] = [];
  function step(bytes: number[], nextPc: number, changes: Partial<Cpu68000Snapshot> = {}, condition?: string,
    data: Cpu68000MemoryAccess[] = []): void {
    const flags = condition === undefined ? { ...before.flags } : { ...before.flags,
      x: condition[0] === "1", n: condition[1] === "1", z: condition[2] === "1", v: condition[3] === "1", c: condition[4] === "1" };
    const after = { ...before, entry: { kind: "none", vector: 0 } as const, ir: bytes[0]! * 256 + bytes[1]!, ...changes, flags, pc: 0xab000000 + nextPc, physicalPc: nextPc };
    records.push({ before, after, outcome: "executed", instruction: { address: before.pc, bytes },
      accesses: [...read(before.physicalPc, ...bytes), ...data] });
    before = after;
  }
  step([0x20, 0x7c, 0xab, 0, 0x30, 0], 0x2006, { a0: 0xab003000 });
  step([0x22, 0x48], 0x2008, { a1: 0xab003000 });
  step([0xd2, 0xfc, 0, 8], 0x200c, { a1: 0xab003008 });
  step([0x24, 0x7c, 0xcd, 0, 0x40, 0], 0x2012, { a2: 0xcd004000 });
  step([0x70, 0], 0x2014, { d0: 0 }, "10100");
  step([0x34, 0x80], 0x2016, {}, "10100", write(0x4000, 0, 0));
  // Literal input, old sum, new sum, load flags, arithmetic flags, and pointer comparison flags.
  const cases = [
    [0x7fff, 0, 0x7fff, "10000", "00000", "01001"],
    [1, 0x7fff, 0x8000, "00000", "01010", "01001"],
    [0xffff, 0x8000, 0x7fff, "01000", "10011", "11001"],
    [2, 0x7fff, 0x8001, "10000", "01010", "00100"],
  ] as const;
  for (const [index, [input, oldSum, sum, loadFlags, sumFlags, compareFlags]] of cases.entries()) {
    step([0x32, 0x18], 0x2018, { a0: 0xab003002 + index * 2, d1: 0x55660000 + input }, loadFlags, read(0x3000 + index * 2, ...word(input)));
    step([0xd0, 0x41], 0x201a, { d0: sum }, sumFlags);
    step([0xd3, 0x52], 0x201c, {}, sumFlags, [...read(0x4000, ...word(oldSum)), ...write(0x4000, ...word(sum))]);
    step([0xb1, 0xc9], 0x201e, {}, compareFlags);
    step([0x65, 0xf6], index === 3 ? 0x2020 : 0x2016);
  }
  step([0x74, 1], 0x2022, { d2: 1 }, "00000");
  step([0x90, 0x42], 0x2024, { d0: 0x8000 }, "01000");
  step([0x95, 0x52], 0x2026, {}, "01000", [...read(0x4000, 0x80, 1), ...write(0x4000, 0x80, 0)]);
  step([0xb0, 0x52], 0x2028, {}, "00100", read(0x4000, 0x80, 0));
  step([0x90, 0xfc, 0, 8], 0x202c, { a0: 0xab003000 });
  step([0xd2, 0xfc, 0xff, 0xfe], 0x2030, { a1: 0xab003006 });
  return records;
}

function checkMemory(ram: Ram, finished = false): void {
  const expected = new Uint8Array(0x1000000);
  expected.set([0x56, 0, 0x90, 0, 0xab, 0, 0x20, 0]);
  expected.set(program, 0x2000);
  expected.set([0xde, 0xad, 0x7f, 0xff, 0, 1, 0xff, 0xff, 0, 2, 0xbe, 0xef], 0x2ffe);
  expected.set([0xde, 0xad, ...(finished ? [0x80, 0] : [0xcc, 0xcc]), 0xbe, 0xef], 0x3ffe);
  for (const [address, value] of expected.entries()) assert.equal(ram.read(address), value, `memory at ${address}`);
}

test("68000 word-sum factories own their RAM, state, and logical endpoint", () => {
  const first = create68000WordSumExample();
  const second = create68000WordSumExample();
  const memory = create68000WordSumExampleMemory();
  assert.deepEqual(first.cpu.snapshot(), initialState());
  assert.equal(first.endAddress, 0xab002030);
  checkMemory(first.ram);
  checkMemory(memory);
  first.cpu.step();
  first.ram.write(0x3000, 0);
  memory.write(0x4000, 0);
  assert.deepEqual(second.cpu.snapshot(), initialState());
  checkMemory(second.ram);
});

test("68000 word-sum combines all six arithmetic families in 32 exact records in both modes", t => {
  for (const supervisor of [false, true]) {
    const { cpu, ram, endAddress } = create68000WordSumExample();
    if (supervisor) assert.deepEqual(cpu.reset(), { before: initialState(), after: initialState(true),
      accesses: read(0, 0x56, 0, 0x90, 0, 0xab, 0, 0x20, 0) });
    const reads = t.mock.method(ram, "read");
    const writes = t.mock.method(ram, "write");
    const records = expectedRecords(supervisor);
    assert.equal(records.length, 32);
    assert.deepEqual(runCpu(cpu, { maxSteps: 32, endAddress }), { stopReason: "completed", records });
    const accesses = records.flatMap(record => record.accesses);
    assert.deepEqual(reads.mock.calls.map(call => call.arguments), accesses.flatMap(a => a.kind === "read" ? [[a.address]] : []));
    assert.deepEqual(writes.mock.calls.map(call => call.arguments), accesses.flatMap(a => a.kind === "write" ? [[a.address, a.value]] : []));
    assert.deepEqual(cpu.snapshot(), records[31]!.after);
    assert.deepEqual(runCpu(cpu, { maxSteps: 0, endAddress }), { stopReason: "completed", records: [] });
    assert.equal(runCpu(cpu, { maxSteps: 0, endAddress: 0x2030 }).stopReason, "step-limit");
    t.mock.restoreAll();
    checkMemory(ram, true);
  }
});

test("68000 word-sum resumes within the loop with live RAM and detached snapshots", () => {
  const { cpu, ram, endAddress } = create68000WordSumExample();
  const records = expectedRecords();
  const first = runCpu(cpu, { maxSteps: 21, endAddress });
  const saved = structuredClone(first);
  assert.deepEqual(first, { stopReason: "step-limit", records: records.slice(0, 21) });
  const restoredRam = create68000WordSumExampleMemory();
  for (const access of first.records.flatMap(record => record.accesses)) {
    if (access.kind === "write") restoredRam.write(access.address, access.value);
  }
  const restored = new Cpu68000(restoredRam, cpu.snapshot());
  for (const running of [cpu, restored]) {
    assert.deepEqual(runCpu(running, { maxSteps: 11, endAddress }), { stopReason: "completed", records: records.slice(21) });
  }
  assert.deepEqual(first, saved);
  checkMemory(ram, true);
  checkMemory(restoredRam, true);
});

test("68000 word-sum reads changed input and reset preserves the computed result", () => {
  const { cpu, ram, endAddress } = create68000WordSumExample();
  ram.write(0x3000, 0);
  ram.write(0x3001, 0);
  const result = runCpu(cpu, { maxSteps: 32, endAddress });
  assert.equal(result.stopReason, "completed");
  assert.equal(result.records.length, 32);
  assert.equal(cpu.snapshot().d0, 1);
  assert.equal(cpu.snapshot().flags.z, true);
  assert.equal(ram.read(0x4000), 0);
  assert.equal(ram.read(0x4001), 1);
  const before = cpu.snapshot();
  cpu.reset();
  assert.equal(cpu.snapshot().pc, 0xab002000);
  assert.equal(cpu.snapshot().d0, before.d0);
  assert.equal(ram.read(0x4001), 1);
});
