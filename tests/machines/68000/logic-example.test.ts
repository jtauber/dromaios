import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu68000 } from "../../../src/components/cpus/68000.js";
import type { Cpu68000Snapshot, Cpu68000StepRecord, Cpu68000MemoryAccess } from "../../../src/components/cpus/68000.js";
import type { Ram } from "../../../src/components/memory/ram.js";
import { create68000LogicExample, create68000LogicExampleMemory } from "../../../src/machines/generated/68000/logic-example.js";
import { runCpu } from "../../../src/runtime/run-cpu.js";

function initialState(supervisor = false): Cpu68000Snapshot {
  return { d0: 0x11223344, d1: 0x55667788, d2: 0x99aabbcc, d3: 0xddeeff00,
    d4: 0x01234567, d5: 0x89abcdef, d6: 0xfedcba98, d7: 0x76543210,
    a0: 0x10000000, a1: 0x20000000, a2: 0x30000000, a3: 0x40000000,
    a4: 0x50000000, a5: 0x60000000, a6: 0x70000000, usp: 0x34008000, ssp: 0x56009000,
    pc: 0xab002000, a7: supervisor ? 0x56009000 : 0x34008000, physicalPc: 0x2000, ir: 0, faulted: false, halted: false, tracePending: false, interruptMask: supervisor ? 7 : 2,
    flags: { x: true, n: false, z: true, v: true, c: true, t: false, s: supervisor } };
}

const read = (address: number, ...bytes: number[]): Cpu68000MemoryAccess[] =>
  bytes.map((value, offset) => ({ kind: "read", address: address + offset, value }));
const write = (address: number, ...bytes: number[]): Cpu68000MemoryAccess[] =>
  bytes.map((value, offset) => ({ kind: "write", address: address + offset, value }));
const long = (value: number): number[] =>
  [Math.floor(value / 16777216), Math.floor(value / 65536) % 256, Math.floor(value / 256) % 256, value % 256];
const program = [0x20, 0x7c, 0xab, 0, 0x30, 0, 0x22, 0x7c, 0xcd, 0, 0x40, 0,
  0x24, 0x3c, 0, 0xff, 0, 0xff, 0x76, 0xff, 0xb5, 0x83, 0x78, 0, 0x7a, 0, 0x7e, 3,
  0x20, 0x18, 0xc0, 0x82, 0xc7, 0x91, 0x81, 0x91, 0x22, 0x19, 0xb3, 0x84, 0x8a, 0x81,
  0x51, 0xcf, 0xff, 0xf0, 0x23, 0xc4, 0xcd, 0, 0x50, 0, 0x23, 0xc5, 0xcd, 0, 0x50, 4];

function expectedRecords(supervisor = false): Cpu68000StepRecord[] {
  let before = initialState(supervisor);
  const records: Cpu68000StepRecord[] = [];
  function step(bytes: number[], nextPc: number, changes: Partial<Cpu68000Snapshot> = {}, condition?: string,
    data: Cpu68000MemoryAccess[] = []): void {
    const flags = condition === undefined ? { ...before.flags } : { ...before.flags,
      x: condition[0] === "1", n: condition[1] === "1", z: condition[2] === "1", v: condition[3] === "1", c: condition[4] === "1" };
    const after = { ...before, ir: bytes[0]! * 256 + bytes[1]!, ...changes, flags, pc: 0xab000000 + nextPc, physicalPc: nextPc };
    records.push({ before, after, outcome: "executed", instruction: { address: before.pc, bytes },
      accesses: [...read(before.physicalPc, ...bytes), ...data] });
    before = after;
  }
  step([0x20, 0x7c, 0xab, 0, 0x30, 0], 0x2006, { a0: 0xab003000 });
  step([0x22, 0x7c, 0xcd, 0, 0x40, 0], 0x200c, { a1: 0xcd004000 });
  step([0x24, 0x3c, 0, 0xff, 0, 0xff], 0x2012, { d2: 0x00ff00ff }, "10000");
  step([0x76, 0xff], 0x2014, { d3: 0xffffffff }, "11000");
  step([0xb5, 0x83], 0x2016, { d3: 0xff00ff00 }, "11000");
  step([0x78, 0], 0x2018, { d4: 0 }, "10100");
  step([0x7a, 0], 0x201a, { d5: 0 }, "10100");
  step([0x7e, 3], 0x201c, { d7: 3 }, "10000");
  // Literal source, destination, selected/retained bytes, merged value, checksum, and union.
  const cases = [
    [0x11223344, 0xaabbccdd, 0x00220044, 0xaa00cc00, 0xaa22cc44, 0xaa22cc44, 0xaa22cc44],
    [0x89abcdef, 0x12345678, 0x00ab00ef, 0x12005600, 0x12ab56ef, 0xb8899aab, 0xbaabdeef],
    [0xffff0000, 0xff00ff00, 0x00ff0000, 0xff00ff00, 0xffffff00, 0x477665ab, 0xffffffef],
    [0x0000ffff, 0, 0x000000ff, 0, 0x000000ff, 0x47766554, 0xffffffff],
  ] as const;
  const conditions = [
    ["10000", "11000", "11000", "11000"], ["11000", "10000", "10000", "11000"],
    ["11000", "11000", "11000", "10000"], ["10000", "10100", "10000", "10000"],
  ] as const; // Flags after source load, retained bytes, merge, and checksum.
  for (const [index, [source, destination, selected, retained, merged, checksum, union]] of cases.entries()) {
    const [loadFlags, retainedFlags, mergedFlags, checksumFlags] = conditions[index]!;
    step([0x20, 0x18], 0x201e, { a0: 0xab003004 + index * 4, d0: source }, loadFlags, read(0x3000 + index * 4, ...long(source)));
    step([0xc0, 0x82], 0x2020, { d0: selected }, "10000");
    step([0xc7, 0x91], 0x2022, {}, retainedFlags, [...read(0x4000 + index * 4, ...long(destination)), ...write(0x4000 + index * 4, ...long(retained))]);
    step([0x81, 0x91], 0x2024, {}, mergedFlags, [...read(0x4000 + index * 4, ...long(retained)), ...write(0x4000 + index * 4, ...long(merged))]);
    step([0x22, 0x19], 0x2026, { a1: 0xcd004004 + index * 4, d1: merged }, mergedFlags, read(0x4000 + index * 4, ...long(merged)));
    step([0xb3, 0x84], 0x2028, { d4: checksum }, checksumFlags);
    step([0x8a, 0x81], 0x202a, { d5: union }, "11000");
    step([0x51, 0xcf, 0xff, 0xf0], index === 3 ? 0x202e : 0x201c, { d7: index === 3 ? 0xffff : 2 - index });
  }
  step([0x23, 0xc4, 0xcd, 0, 0x50, 0], 0x2034, {}, "10000", write(0x5000, 0x47, 0x76, 0x65, 0x54));
  step([0x23, 0xc5, 0xcd, 0, 0x50, 4], 0x203a, {}, "11000", write(0x5004, 0xff, 0xff, 0xff, 0xff));
  return records;
}

function checkMemory(ram: Ram, finished = false): void {
  const expected = new Uint8Array(0x1000000);
  expected.set([0x56, 0, 0x90, 0, 0xab, 0, 0x20, 0]);
  expected.set(program, 0x2000);
  expected.set([0xde, 0xad, ...[0x11223344, 0x89abcdef, 0xffff0000, 0x0000ffff].flatMap(long), 0xbe, 0xef], 0x2ffe);
  const destination = finished ? [0xaa22cc44, 0x12ab56ef, 0xffffff00, 0x000000ff] : [0xaabbccdd, 0x12345678, 0xff00ff00, 0];
  expected.set([0xde, 0xad, ...destination.flatMap(long), 0xbe, 0xef], 0x3ffe);
  expected.set([0xde, 0xad, ...(finished ? [0x47766554, 0xffffffff] : [0xcccccccc, 0xcccccccc]).flatMap(long), 0xbe, 0xef], 0x4ffe);
  for (const [address, value] of expected.entries()) assert.equal(ram.read(address), value, `memory at ${address}`);
}

test("68000 logic factories own their RAM, state, and logical endpoint", () => {
  const first = create68000LogicExample();
  const second = create68000LogicExample();
  const memory = create68000LogicExampleMemory();
  assert.deepEqual(first.cpu.snapshot(), initialState());
  assert.equal(first.endAddress, 0xab00203a);
  checkMemory(first.ram);
  checkMemory(memory);
  first.cpu.step();
  first.ram.write(0x3000, 0);
  memory.write(0x4000, 0);
  assert.deepEqual(second.cpu.snapshot(), initialState());
  checkMemory(second.ram);
});

test("68000 masked merge executes 42 exact records, including unchanged writes, in both processor modes", t => {
  for (const supervisor of [false, true]) {
    const { cpu, ram, endAddress } = create68000LogicExample();
    if (supervisor) assert.deepEqual(cpu.reset(), { before: initialState(), after: initialState(true),
      accesses: read(0, 0x56, 0, 0x90, 0, 0xab, 0, 0x20, 0) });
    const reads = t.mock.method(ram, "read");
    const writes = t.mock.method(ram, "write");
    const records = expectedRecords(supervisor);
    assert.equal(records.length, 42);
    assert.deepEqual(runCpu(cpu, { maxSteps: 42, endAddress }), { stopReason: "completed", records });
    const accesses = records.flatMap(record => record.accesses);
    assert.deepEqual(reads.mock.calls.map(call => call.arguments), accesses.flatMap(a => a.kind === "read" ? [[a.address]] : []));
    assert.deepEqual(writes.mock.calls.map(call => call.arguments), accesses.flatMap(a => a.kind === "write" ? [[a.address, a.value]] : []));
    assert.deepEqual(cpu.snapshot(), records[41]!.after);
    assert.deepEqual(runCpu(cpu, { maxSteps: 0, endAddress }), { stopReason: "completed", records: [] });
    assert.equal(runCpu(cpu, { maxSteps: 0, endAddress: 0x203a }).stopReason, "step-limit");
    t.mock.restoreAll();
    checkMemory(ram, true);
  }
});

test("68000 masked merge resumes after clearing destination bits and restores snapshots with live RAM", () => {
  const { cpu, ram, endAddress } = create68000LogicExample();
  const records = expectedRecords();
  const first = runCpu(cpu, { maxSteps: 11, endAddress });
  const saved = structuredClone(first);
  assert.deepEqual(first, { stopReason: "step-limit", records: records.slice(0, 11) });
  const restoredRam = create68000LogicExampleMemory();
  for (const access of first.records.flatMap(record => record.accesses)) {
    if (access.kind === "write") restoredRam.write(access.address, access.value);
  }
  const restored = new Cpu68000(restoredRam, cpu.snapshot());
  for (const running of [cpu, restored]) {
    assert.deepEqual(runCpu(running, { maxSteps: 31, endAddress }), { stopReason: "completed", records: records.slice(11) });
  }
  assert.deepEqual(first, saved);
  checkMemory(ram, true);
  checkMemory(restoredRam, true);
});

test("68000 masked merge reads current masks and reset preserves the completed buffer", () => {
  const { cpu, ram, endAddress } = create68000LogicExample();
  ram.write(0x200f, 0); // Replacement mask becomes 000000FF: replace only the final byte.
  const result = runCpu(cpu, { maxSteps: 42, endAddress });
  assert.equal(result.stopReason, "completed");
  assert.equal(result.records.length, 42);
  assert.equal(cpu.snapshot().d2, 0xff);
  assert.equal(cpu.snapshot().d3, 0xffffff00);
  for (const [index, value] of [0xaabbcc44, 0x123456ef, 0xff00ff00, 0x000000ff].entries()) {
    assert.deepEqual([0, 1, 2, 3].map(offset => ram.read(0x4000 + index * 4 + offset)), long(value));
  }
  const before = cpu.snapshot();
  cpu.reset();
  assert.equal(cpu.snapshot().pc, 0xab002000);
  assert.equal(cpu.snapshot().d4, before.d4);
  assert.deepEqual([0, 1, 2, 3].map(offset => ram.read(0x4000 + offset)), [0xaa, 0xbb, 0xcc, 0x44]);
});
