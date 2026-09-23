import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu68000 } from "../../../src/components/cpus/generated/68000-cpu.js";
import type { Cpu68000Snapshot, Cpu68000StepRecord, Cpu68000MemoryAccess } from "../../../src/components/cpus/generated/68000-cpu.js";
import type { Ram } from "../../../src/components/memory/ram.js";
import { create68000AluExample, create68000AluExampleMemory } from "../../../src/machines/generated/68000/alu-example.js";
import { runCpu } from "../../../src/runtime/run-cpu.js";

function initialState(): Cpu68000Snapshot {
  return { d0: 0x11223344, d1: 0x55667788, d2: 0x99aabbcc, d3: 0xddeeff00,
    d4: 0x01234567, d5: 0x89abcdef, d6: 0xfedcba98, d7: 0x76543210,
    a0: 0x10000000, a1: 0x20000000, a2: 0x30000000, a3: 0x40000000,
    a4: 0x50000000, a5: 0x60000000, a6: 0x70000000, usp: 0x34008000, ssp: 0x56009000,
    pc: 0xab002000, a7: 0x34008000, physicalPc: 0x2000, ir: 0, faulted: false, entry: { kind: "none", vector: 0 }, halted: false, tracePending: false, interruptMask: 2,
    flags: { x: true, n: false, z: true, v: true, c: true, t: false, s: false } };
}

const read = (address: number, ...bytes: number[]): Cpu68000MemoryAccess[] =>
  bytes.map((value, offset) => ({ kind: "read", address: address + offset, value }));
const write = (address: number, ...bytes: number[]): Cpu68000MemoryAccess[] =>
  bytes.map((value, offset) => ({ kind: "write", address: address + offset, value }));

// Literal instruction bytes, changed registers, XNZVC, and data accesses.
const steps: readonly (readonly [number[], Partial<Cpu68000Snapshot>, string, Cpu68000MemoryAccess[]])[] = [
  [[0x20, 0x7c, 0xab, 0, 0x30, 0], { a0: 0xab003000 }, "10111", []],
  [[6, 0x18, 0, 1], { a0: 0xab003001 }, "01010", [...read(0x3000, 0x7f), ...write(0x3000, 0x80)]],
  [[4, 0x18, 0, 1], { a0: 0xab003002 }, "11001", [...read(0x3001, 0), ...write(0x3001, 0xff)]],
  [[2, 0x50, 0x0f, 0xff], {}, "10000", [...read(0x3002, 0xab, 0xcd), ...write(0x3002, 0x0b, 0xcd)]],
  [[0, 0x58, 0x80, 0], { a0: 0xab003004 }, "11000", [...read(0x3002, 0x0b, 0xcd), ...write(0x3002, 0x8b, 0xcd)]],
  [[0x0a, 0x90, 0xff, 0xff, 0xff, 0xff], {}, "11000", [...read(0x3004, 0x11, 0x22, 0x33, 0x44), ...write(0x3004, 0xee, 0xdd, 0xcc, 0xbb)]],
  [[4, 0x90, 0, 0, 0, 1], {}, "01000", [...read(0x3004, 0xee, 0xdd, 0xcc, 0xbb), ...write(0x3004, 0xee, 0xdd, 0xcc, 0xba)]],
  [[6, 0x98, 0x11, 0x22, 0x33, 0x46], { a0: 0xab003008 }, "10101", [...read(0x3004, 0xee, 0xdd, 0xcc, 0xba), ...write(0x3004, 0, 0, 0, 0)]],
  [[0x0c, 0xa0, 0, 0, 0, 0], { a0: 0xab003004 }, "10100", read(0x3004, 0, 0, 0, 0)],
  [[0x20, 0x20], { a0: 0xab003000, d0: 0x80ff8bcd }, "11000", read(0x3000, 0x80, 0xff, 0x8b, 0xcd)],
  [[2, 0x80, 0, 0xff, 0xff, 0xff], { d0: 0x00ff8bcd }, "10000", []],
  [[0x0a, 0, 0, 0xff], { d0: 0x00ff8b32 }, "10000", []],
  [[0, 0x40, 0x80, 0], {}, "11000", []],
  [[6, 0x40, 0x74, 0xce], { d0: 0x00ff0000 }, "10101", []],
  [[0x0c, 0x18, 0, 1], { a0: 0xab003001 }, "10010", read(0x3000, 0x80)],
  [[0x0c, 0x18, 0, 0xff], { a0: 0xab003002 }, "10100", read(0x3001, 0xff)],
];

function expectedRecords(): Cpu68000StepRecord[] {
  let before = initialState();
  return steps.map(([bytes, changes, condition, data]) => {
    const [x, n, z, v, c] = [...condition].map(bit => bit === "1");
    const after = { ...before, entry: { kind: "none", vector: 0 } as const, ir: bytes[0]! * 256 + bytes[1]!, ...changes, pc: before.pc + bytes.length, physicalPc: before.physicalPc + bytes.length,
      flags: { ...before.flags, x: x!, n: n!, z: z!, v: v!, c: c! } };
    const record: Cpu68000StepRecord = { before, after, outcome: "executed", instruction: { address: before.pc, bytes },
      accesses: [...read(before.physicalPc, ...bytes), ...data] };
    before = after;
    return record;
  });
}

function checkMemory(ram: Ram, finished = false): void {
  const expected = new Uint8Array(0x1000000);
  expected.set([0x56, 0, 0x90, 0, 0xab, 0, 0x20, 0]);
  expected.set(steps.flatMap(([bytes]) => bytes), 0x2000);
  expected.set([0xde, 0xad, ...(finished ? [0x80, 0xff, 0x8b, 0xcd, 0, 0, 0, 0] : [0x7f, 0, 0xab, 0xcd, 0x11, 0x22, 0x33, 0x44]), 0xbe, 0xef], 0x2ffe);
  for (const [address, value] of expected.entries()) assert.equal(ram.read(address), value, `memory at ${address}`);
}

test("68000 ALU factories own their full RAM images and initial CPU state", () => {
  const first = create68000AluExample();
  const second = create68000AluExample();
  const memory = create68000AluExampleMemory();
  assert.deepEqual(first.cpu.snapshot(), initialState());
  assert.equal(first.endAddress, 0xab00204a);
  checkMemory(first.ram);
  checkMemory(memory);
  first.cpu.step();
  first.ram.write(0x3000, 0);
  memory.write(0x3001, 0xff);
  assert.deepEqual(second.cpu.snapshot(), initialState());
  checkMemory(second.ram);
});

test("68000 ALU example transforms RAM through 16 exact records with one update per operand", t => {
  const { cpu, ram, endAddress } = create68000AluExample();
  const reads = t.mock.method(ram, "read");
  const writes = t.mock.method(ram, "write");
  const records = expectedRecords();
  assert.deepEqual(runCpu(cpu, { maxSteps: 16, endAddress }), { stopReason: "completed", records });
  const accesses = records.flatMap(record => record.accesses);
  assert.deepEqual(reads.mock.calls.map(call => call.arguments), accesses.flatMap(a => a.kind === "read" ? [[a.address]] : []));
  assert.deepEqual(writes.mock.calls.map(call => call.arguments), accesses.flatMap(a => a.kind === "write" ? [[a.address, a.value]] : []));
  assert.deepEqual(cpu.snapshot(), records[15]!.after);
  assert.deepEqual(runCpu(cpu, { maxSteps: 0, endAddress }), { stopReason: "completed", records: [] });
  assert.equal(runCpu(cpu, { maxSteps: 0, endAddress: 0x204a }).stopReason, "step-limit");
  t.mock.restoreAll();
  checkMemory(ram, true);
});

test("68000 ALU example resumes before comparison, restores snapshots, and preserves earlier records", () => {
  const { cpu, ram, endAddress } = create68000AluExample();
  const expected = expectedRecords();
  const first = runCpu(cpu, { maxSteps: 8, endAddress });
  const saved = structuredClone(first);
  assert.deepEqual(first, { stopReason: "step-limit", records: expected.slice(0, 8) });
  const restored = new Cpu68000(ram, cpu.snapshot());
  assert.deepEqual(runCpu(cpu, { maxSteps: 8, endAddress }), { stopReason: "completed", records: expected.slice(8) });
  assert.deepEqual(runCpu(restored, { maxSteps: 8, endAddress }), { stopReason: "completed", records: expected.slice(8) });
  assert.deepEqual(first, saved);
  checkMemory(ram, true);
});

test("68000 ALU example reads changed input and reset changes control state without restoring RAM", () => {
  const { cpu, ram, endAddress } = create68000AluExample();
  ram.write(0x3000, 0xff);
  assert.equal(runCpu(cpu, { maxSteps: 16, endAddress }).stopReason, "completed");
  assert.equal(ram.read(0x3000), 0);
  const before = cpu.snapshot();
  const reset = cpu.reset();
  assert.deepEqual(reset, { before,
    after: { ...before, entry: { kind: "reset", vector: 0 }, pc: 0xab002000, physicalPc: 0x2000, a7: 0x56009000,
      interruptMask: 7, flags: { ...before.flags, s: true, t: false } },
    accesses: read(0, 0x56, 0, 0x90, 0, 0xab, 0, 0x20, 0) });
  assert.equal(ram.read(0x3000), 0);
  const fresh = create68000AluExample();
  fresh.cpu.reset();
  assert.equal(runCpu(fresh.cpu, { maxSteps: 16, endAddress }).stopReason, "completed");
  const expected = expectedRecords()[15]!.after;
  assert.deepEqual(fresh.cpu.snapshot(), { ...expected, a7: 0x56009000, interruptMask: 7, flags: { ...expected.flags, s: true } });
  checkMemory(fresh.ram, true);
});
