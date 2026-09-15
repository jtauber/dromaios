import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu68000 } from "../../../src/components/cpus/68000.js";
import type { Cpu68000Snapshot, Cpu68000StepRecord, Cpu68000MemoryAccess } from "../../../src/components/cpus/68000.js";
import type { Ram } from "../../../src/components/memory/ram.js";
import { create68000UnaryExample, create68000UnaryExampleMemory } from "../../../src/machines/generated/68000/unary-example.js";
import { runCpu } from "../../../src/runtime/run-cpu.js";

function initialState(supervisor = false): Cpu68000Snapshot {
  return { d0: 0x11223344, d1: 0x55667788, d2: 0x99aabbcc, d3: 0xddeeff00,
    d4: 0x01234567, d5: 0x89abcdef, d6: 0xfedcba98, d7: 0x76543210,
    a0: 0x10000000, a1: 0x20000000, a2: 0x30000000, a3: 0x40000000,
    a4: 0x50000000, a5: 0x60000000, a6: 0x70000000, usp: 0x34008000, ssp: 0x56009000,
    pc: 0xab002000, a7: supervisor ? 0x56009000 : 0x34008000, physicalPc: 0x2000, halted: false, tracePending: false, interruptMask: supervisor ? 7 : 2,
    flags: { x: true, n: false, z: true, v: true, c: true, t: false, s: supervisor } };
}
const read = (address: number, ...bytes: number[]): Cpu68000MemoryAccess[] =>
  bytes.map((value, offset) => ({ kind: "read", address: address + offset, value }));
const write = (address: number, ...bytes: number[]): Cpu68000MemoryAccess[] =>
  bytes.map((value, offset) => ({ kind: "write", address: address + offset, value }));
const word = (value: number): number[] => [Math.floor(value / 256), value % 256];
const program = [0x41, 0xf9, 0xab, 0, 0x30, 0, 0x43, 0xf9, 0xcd, 0, 0x40, 0,
  0x45, 0xf9, 0xef, 0, 0x50, 0, 0x42, 0x82, 0x76, 4, 0x4c, 0x98, 0, 1,
  0x4a, 0x40, 0x5b, 0xd1, 0x6a, 2, 0x44, 0x40, 0x34, 0x80, 0x54, 0x4a, 0x46, 0x11,
  0x44, 0x19, 0xd4, 0x29, 0xff, 0xff, 0x53, 0x43, 0x66, 0xe4, 0x47, 0xf9, 0x12, 0, 0x60, 8,
  0x4a, 0x83, 0x40, 0xa3, 0x40, 0xa3, 0x57, 0xc4];

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
  step([0x41, 0xf9, 0xab, 0, 0x30, 0], 0x2006, { a0: 0xab003000 });
  step([0x43, 0xf9, 0xcd, 0, 0x40, 0], 0x200c, { a1: 0xcd004000 });
  step([0x45, 0xf9, 0xef, 0, 0x50, 0], 0x2012, { a2: 0xef005000 });
  step([0x42, 0x82], 0x2014, { d2: 0 }, "10100");
  step([0x76, 4], 0x2016, { d3: 4 }, "10000");
  const cases = [
    { input: 0, loaded: 0, magnitude: 0, count: 1, test: "10100", moved: "10100", inverted: "11000" },
    { input: 1, loaded: 1, magnitude: 1, count: 2, test: "00000", moved: "00000", inverted: "01000" },
    { input: 0xffff, loaded: 0xffffffff, magnitude: 1, count: 2, test: "01000", moved: "10000", inverted: "10100", negated: "10001" },
    { input: 0x8000, loaded: 0xffff8000, magnitude: 0x8000, count: 2, test: "01000", moved: "11000", inverted: "10100", negated: "11011" },
  ] as const;
  for (const [index, row] of cases.entries()) {
    const negative = row.input >= 0x8000;
    const mask = negative ? 0xff : 0;
    const classification = negative ? 0 : 1;
    step([0x4c, 0x98, 0, 1], 0x201a, { d0: row.loaded, a0: 0xab003002 + index * 2 }, undefined, read(0x3000 + index * 2, ...word(row.input)));
    step([0x4a, 0x40], 0x201c, {}, row.test);
    step([0x5b, 0xd1], 0x201e, {}, undefined, [...read(0x4000 + index, 0xcc), ...write(0x4000 + index, mask)]);
    step([0x6a, 2], negative ? 0x2020 : 0x2022);
    if ("negated" in row) step([0x44, 0x40], 0x2022, { d0: 0xffff0000 + row.magnitude }, row.negated);
    step([0x34, 0x80], 0x2024, {}, row.moved, write(0x5000 + index * 2, ...word(row.magnitude)));
    step([0x54, 0x4a], 0x2026, { a2: 0xef005002 + index * 2 });
    step([0x46, 0x11], 0x2028, {}, row.inverted, [...read(0x4000 + index, mask), ...write(0x4000 + index, 255 - mask)]);
    step([0x44, 0x19], 0x202a, { a1: 0xcd004001 + index }, negative ? "00100" : "10001",
      [...read(0x4000 + index, 255 - mask), ...write(0x4000 + index, classification)]);
    step([0xd4, 0x29, 0xff, 0xff], 0x202e, { d2: row.count }, "00000", read(0x4000 + index, classification));
    step([0x53, 0x43], 0x2030, { d3: 3 - index }, index === 3 ? "00100" : "00000");
    step([0x66, 0xe4], index === 3 ? 0x2032 : 0x2016);
  }
  step([0x47, 0xf9, 0x12, 0, 0x60, 8], 0x2038, { a3: 0x12006008 });
  step([0x4a, 0x83], 0x203a, {}, "00100");
  step([0x40, 0xa3], 0x203c, { a3: 0x12006004 }, "11001", [...read(0x6004, 0, 0, 0, 1), ...write(0x6004, 255, 255, 255, 255)]);
  step([0x40, 0xa3], 0x203e, { a3: 0x12006000 }, "10001", [...read(0x6000, 255, 255, 255, 255), ...write(0x6000, 0, 0, 0, 0)]);
  step([0x57, 0xc4], 0x2040, { d4: 0x01234500 });
  return records;
}

function checkMemory(ram: Ram, finished = false): void {
  const expected = new Uint8Array(0x1000000);
  expected.set([0x56, 0, 0x90, 0, 0xab, 0, 0x20, 0]);
  expected.set(program, 0x2000);
  expected.set([0xde, 0xad, 0, 0, 0, 1, 0xff, 0xff, 0x80, 0, 0xbe, 0xef], 0x2ffe);
  expected.set([0xde, 0xad, ...(finished ? [1, 1, 0, 0] : [0xcc, 0xcc, 0xcc, 0xcc]), 0xbe, 0xef], 0x3ffe);
  expected.set([0xde, 0xad, ...(finished ? [0, 0, 0, 1, 0, 1, 0x80, 0] : Array(8).fill(0xcc)), 0xbe, 0xef], 0x4ffe);
  expected.set([0xde, 0xad, ...(finished ? [0, 0, 0, 0, 255, 255, 255, 255] : [255, 255, 255, 255, 0, 0, 0, 1]), 0xbe, 0xef], 0x5ffe);
  for (const [address, value] of expected.entries()) assert.equal(ram.read(address), value, `memory at ${address}`);
}

test("68000 unary factories own their RAM and state and retain the full logical endpoint", () => {
  const first = create68000UnaryExample();
  const second = create68000UnaryExample();
  const memory = create68000UnaryExampleMemory();
  assert.deepEqual(first.cpu.snapshot(), initialState());
  assert.equal(first.endAddress, 0xab002040);
  checkMemory(first.ram);
  checkMemory(memory);
  first.cpu.step();
  first.ram.write(0x3000, 0xff);
  memory.write(0x4000, 0);
  assert.deepEqual(second.cpu.snapshot(), initialState());
  checkMemory(second.ram);
});

test("68000 unary example combines eight families in 56 exact records in both modes", t => {
  for (const supervisor of [false, true]) {
    const { cpu, ram, endAddress } = create68000UnaryExample();
    if (supervisor) assert.deepEqual(cpu.reset(), { before: initialState(), after: initialState(true),
      accesses: read(0, 0x56, 0, 0x90, 0, 0xab, 0, 0x20, 0) });
    const reads = t.mock.method(ram, "read");
    const writes = t.mock.method(ram, "write");
    const records = expectedRecords(supervisor);
    assert.equal(records.length, 56);
    assert.deepEqual(runCpu(cpu, { maxSteps: 56, endAddress }), { stopReason: "completed", records });
    const accesses = records.flatMap(record => record.accesses);
    assert.deepEqual(reads.mock.calls.map(call => call.arguments), accesses.flatMap(a => a.kind === "read" ? [[a.address]] : []));
    assert.deepEqual(writes.mock.calls.map(call => call.arguments), accesses.flatMap(a => a.kind === "write" ? [[a.address, a.value]] : []));
    assert.deepEqual(cpu.snapshot(), records[55]!.after);
    assert.deepEqual(runCpu(cpu, { maxSteps: 0, endAddress }), { stopReason: "completed", records: [] });
    assert.equal(runCpu(cpu, { maxSteps: 0, endAddress: 0x2040 }).stopReason, "step-limit");
    t.mock.restoreAll();
    checkMemory(ram, true);
  }
});

test("68000 unary example resumes between the two NEGX operations with retained records and restored state", () => {
  const { cpu, ram, endAddress } = create68000UnaryExample();
  const records = expectedRecords();
  const first = runCpu(cpu, { maxSteps: 54, endAddress });
  const saved = structuredClone(first);
  assert.deepEqual(first, { stopReason: "step-limit", records: records.slice(0, 54) });
  assert.equal(cpu.snapshot().flags.x, true);
  assert.equal(cpu.snapshot().flags.z, false);
  const restoredRam = create68000UnaryExampleMemory();
  for (const access of first.records.flatMap(record => record.accesses)) {
    if (access.kind === "write") restoredRam.write(access.address, access.value);
  }
  const restored = new Cpu68000(restoredRam, cpu.snapshot());
  for (const running of [cpu, restored]) {
    assert.deepEqual(runCpu(running, { maxSteps: 2, endAddress }), { stopReason: "completed", records: records.slice(54) });
  }
  assert.deepEqual(first, saved);
  checkMemory(ram, true);
  checkMemory(restoredRam, true);
});

test("68000 unary example reads changed inputs, recognizes a zero multi-precision result, and preserves RAM on reset", () => {
  const { cpu, ram, endAddress } = create68000UnaryExample();
  ram.write(0x3004, 0);
  ram.write(0x3005, 2); // Replace -1 with +2: another nonnegative sample, one fewer NEG.
  for (let address = 0x6000; address < 0x6008; address++) ram.write(address, 0);
  const result = runCpu(cpu, { maxSteps: 56, endAddress });
  assert.equal(result.stopReason, "completed");
  assert.equal(result.records.length, 55);
  assert.equal(cpu.snapshot().d2, 3);
  assert.equal(cpu.snapshot().d4, 0x012345ff);
  assert.equal(cpu.snapshot().flags.z, true);
  assert.equal(cpu.snapshot().flags.x, false);
  assert.deepEqual([ram.read(0x5004), ram.read(0x5005)], [0, 2]);
  cpu.reset();
  assert.equal(cpu.snapshot().pc, 0xab002000);
  assert.equal(cpu.snapshot().d2, 3);
  assert.equal(ram.read(0x4002), 1);
  assert.equal(ram.read(0x5005), 2);
});
