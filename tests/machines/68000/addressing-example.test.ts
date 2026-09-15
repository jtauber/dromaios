import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu68000 } from "../../../src/components/cpus/68000.js";
import type { Cpu68000Snapshot, Cpu68000StepRecord, Cpu68000MemoryAccess } from "../../../src/components/cpus/68000.js";
import type { Ram } from "../../../src/components/memory/ram.js";
import { create68000AddressingExample, create68000AddressingExampleMemory } from "../../../src/machines/generated/68000/addressing-example.js";
import { runCpu } from "../../../src/runtime/run-cpu.js";

function initialState(): Cpu68000Snapshot {
  return { d0: 0x11223344, d1: 0x55667788, d2: 0x99aabbcc, d3: 0xddeeff00,
    d4: 0x01234567, d5: 0xffffffff, d6: 0xfedcba98, d7: 0x76543210,
    a0: 0x10000000, a1: 0x20000000, a2: 0x30000000, a3: 0x40000000,
    a4: 0x50000000, a5: 0x60000000, a6: 0x70000000, usp: 0x34008000, ssp: 0x56009000,
    pc: 0xab002000, a7: 0x34008000, physicalPc: 0x2000, interruptMask: 2,
    flags: { x: true, n: false, z: true, v: true, c: true, t: false, s: false } };
}

const program = [
  0x20, 0x7c, 0xab, 0, 0x30, 0, 0x22, 0x7c, 0xcd, 0, 0x40, 0, 0x34, 0x7c, 0xff, 0x80,
  0x10, 0x18, 0x12, 0xd8, 0x12, 0xc0, 0x32, 0xd8, 0x22, 0xd8, 0x22, 0x20, 0x3f, 1, 0x34, 0x1f,
  0x36, 0x52, 0x16, 0x2a, 0, 2, 0x38, 0x3a, 0, 0x78, 0x3c, 0x31, 0x50, 0xfd,
  0x26, 0x81, 0x1e, 0x38, 0xff, 0x82, 0x23, 0xc6, 0xcd, 0, 0x40, 8,
];

function checkMemory(ram: Ram, finished = false, supervisor = false): void {
  const expected = new Uint8Array(0x1000000);
  expected.set([0x56, 0, 0x90, 0, 0xab, 0, 0x20, 0]);
  expected.set(program, 0x2000);
  expected.set([0xf0, 0x0d], 0x20a0);
  expected.set([0xde, 0xad, 0x80, 0x7f, 0x12, 0x34, 0x89, 0xab, 0xcd, 0xef, 0xbe, 0xef], 0x2ffe);
  expected.set([0xde, 0xad, ...Array<number>(12).fill(0xcc), 0xbe, 0xef], 0x3ffe);
  expected.set([0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff], 0x7ffc);
  expected.set([0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff], 0x8ffc);
  expected.set([0xde, 0xad, 0xcc, 0xcc, 0xcc, 0xcc, 0xbe, 0xef], 0xff8000);
  expected.set([0x80, 2, 0x55, 0xaa], 0xffff80);
  if (finished) {
    expected.set([0x7f, 0x80, 0x12, 0x34, 0x89, 0xab, 0xcd, 0xef, 0xfe, 0xdc, 0x89, 0xab], 0x4000);
    expected.set([0xcd, 0xef], supervisor ? 0x8ffe : 0x7ffe);
    expected.set([0x89, 0xab, 0xcd, 0xef], 0xff8002);
  }
  for (const [address, value] of expected.entries()) assert.equal(ram.read(address), value, `memory at ${address}`);
}

const read = (address: number, ...bytes: number[]): Cpu68000MemoryAccess[] =>
  bytes.map((value, offset) => ({ kind: "read", address: address + offset, value }));
const write = (address: number, ...bytes: number[]): Cpu68000MemoryAccess[] =>
  bytes.map((value, offset) => ({ kind: "write", address: address + offset, value }));

function expectedRecords(): Cpu68000StepRecord[] {
  let before = initialState();
  // Each row specifies the literal instruction, its state change, N (null means preserve flags),
  // and data accesses. No memory-source instruction in this example has a destination extension.
  const steps: readonly (readonly [number[], Partial<Cpu68000Snapshot>, boolean | null, Cpu68000MemoryAccess[]])[] = [
    [[0x20, 0x7c, 0xab, 0, 0x30, 0], { a0: 0xab003000 }, null, []],
    [[0x22, 0x7c, 0xcd, 0, 0x40, 0], { a1: 0xcd004000 }, null, []],
    [[0x34, 0x7c, 0xff, 0x80], { a2: 0xffffff80 }, null, []],
    [[0x10, 0x18], { a0: 0xab003001, d0: 0x11223380 }, true, read(0x3000, 0x80)],
    [[0x12, 0xd8], { a0: 0xab003002, a1: 0xcd004001 }, false, [...read(0x3001, 0x7f), ...write(0x4000, 0x7f)]],
    [[0x12, 0xc0], { a1: 0xcd004002 }, true, write(0x4001, 0x80)],
    [[0x32, 0xd8], { a0: 0xab003004, a1: 0xcd004004 }, false, [...read(0x3002, 0x12, 0x34), ...write(0x4002, 0x12, 0x34)]],
    [[0x22, 0xd8], { a0: 0xab003008, a1: 0xcd004008 }, true, [...read(0x3004, 0x89, 0xab, 0xcd, 0xef), ...write(0x4004, 0x89, 0xab, 0xcd, 0xef)]],
    [[0x22, 0x20], { a0: 0xab003004, d1: 0x89abcdef }, true, read(0x3004, 0x89, 0xab, 0xcd, 0xef)],
    [[0x3f, 1], { usp: 0x34007ffe, a7: 0x34007ffe }, true, write(0x7ffe, 0xcd, 0xef)],
    [[0x34, 0x1f], { usp: 0x34008000, a7: 0x34008000, d2: 0x99aacdef }, true, read(0x7ffe, 0xcd, 0xef)],
    [[0x36, 0x52], { a3: 0xffff8002 }, null, read(0xffff80, 0x80, 2)],
    [[0x16, 0x2a, 0, 2], { d3: 0xddeeff55 }, false, read(0xffff82, 0x55)],
    [[0x38, 0x3a, 0, 0x78], { d4: 0x0123f00d }, true, read(0x20a0, 0xf0, 0x0d)],
    [[0x3c, 0x31, 0x50, 0xfd], { d6: 0xfedc89ab }, true, read(0x4004, 0x89, 0xab)],
    [[0x26, 0x81], {}, true, write(0xff8002, 0x89, 0xab, 0xcd, 0xef)],
    [[0x1e, 0x38, 0xff, 0x82], { d7: 0x76543255 }, false, read(0xffff82, 0x55)],
    [[0x23, 0xc6, 0xcd, 0, 0x40, 8], {}, true, write(0x4008, 0xfe, 0xdc, 0x89, 0xab)],
  ];
  return steps.map(([bytes, changes, negative, data]) => {
    const after = { ...before, ...changes, pc: before.pc + bytes.length, physicalPc: before.physicalPc + bytes.length,
      flags: negative === null ? { ...before.flags } : { ...before.flags, n: negative, z: false, v: false, c: false } };
    const record: Cpu68000StepRecord = { before, after, outcome: "executed", instruction: { address: before.pc, bytes },
      accesses: [...read(before.physicalPc, ...bytes), ...data] };
    before = after;
    return record;
  });
}

test("68000 addressing factories own independent full RAM images and logical completion addresses", () => {
  const first = create68000AddressingExample();
  const second = create68000AddressingExample();
  const memory = create68000AddressingExampleMemory();
  checkMemory(first.ram);
  checkMemory(memory);
  assert.deepEqual(first.cpu.snapshot(), initialState());
  assert.equal(first.endAddress, 0xab00203a);
  first.cpu.step();
  first.ram.write(0x3000, 0);
  memory.write(0x4000, 0);
  assert.deepEqual(second.cpu.snapshot(), initialState());
  checkMemory(second.ram);
});

test("68000 mixed-size transfers and address arithmetic produce all 18 exact records and actual RAM accesses", t => {
  const { cpu, ram, endAddress } = create68000AddressingExample();
  const reads = t.mock.method(ram, "read");
  const writes = t.mock.method(ram, "write");
  const records = expectedRecords();
  assert.deepEqual(runCpu(cpu, { maxSteps: 18, endAddress }), { stopReason: "completed", records });
  const accesses = records.flatMap(r => r.accesses);
  assert.deepEqual(reads.mock.calls.map(c => c.arguments), accesses.filter(a => a.kind === "read").map(a => [a.address]));
  assert.deepEqual(writes.mock.calls.map(c => c.arguments), accesses.filter(a => a.kind === "write").map(a => [a.address, a.value]));
  assert.deepEqual(cpu.snapshot(), records[17]!.after);
  assert.deepEqual(runCpu(cpu, { maxSteps: 0, endAddress }), { stopReason: "completed", records: [] });
  assert.equal(runCpu(cpu, { maxSteps: 0, endAddress: 0x203a }).stopReason, "step-limit");
  t.mock.restoreAll();
  checkMemory(ram, true);
  const continued = cpu.step();
  assert.equal(continued.outcome, "executed");
  assert.deepEqual(continued.instruction?.bytes, [0, 0, 0, 0]);
  assert.deepEqual(continued.after, { ...records[17]!.after, pc: endAddress + 4, physicalPc: 0x203e });
});

test("68000 addressing pauses across stack operations, resumes from snapshots, and preserves detached traces", () => {
  const { cpu, ram, endAddress } = create68000AddressingExample();
  const expected = expectedRecords();
  const first = runCpu(cpu, { maxSteps: 10, endAddress });
  const saved = structuredClone(first);
  assert.deepEqual(first, { stopReason: "step-limit", records: expected.slice(0, 10) });
  const restored = new Cpu68000(ram, cpu.snapshot());
  assert.deepEqual(runCpu(cpu, { maxSteps: 8, endAddress }), { stopReason: "completed", records: expected.slice(10) });
  assert.deepEqual(runCpu(restored, { maxSteps: 8, endAddress }), { stopReason: "completed", records: expected.slice(10) });
  assert.deepEqual(first, saved);
  checkMemory(ram, true);
  const live = cpu.snapshot();
  Reflect.set(first.records[0]!.after, "a0", 0);
  Reflect.set(first.records[0]!.after.flags, "s", true);
  assert.deepEqual(first.records[1]!.before, saved.records[1]!.before);
  assert.deepEqual(cpu.snapshot(), live);
});

test("68000 addressing after reset uses SSP, preserves USP, and leaves the inactive stack memory untouched", () => {
  const { cpu, ram, endAddress } = create68000AddressingExample();
  const before = initialState();
  const after = { ...before, flags: { ...before.flags, s: true }, interruptMask: 7, a7: before.ssp };
  assert.deepEqual(cpu.reset(), { before, after, accesses: read(0, 0x56, 0, 0x90, 0, 0xab, 0, 0x20, 0) });
  checkMemory(ram);
  const result = runCpu(cpu, { maxSteps: 18, endAddress });
  assert.equal(result.stopReason, "completed");
  const final = expectedRecords()[17]!.after;
  assert.deepEqual(cpu.snapshot(), { ...final, flags: { ...final.flags, s: true }, interruptMask: 7, a7: final.ssp });
  assert.equal(result.records[9]!.after.ssp, 0x56008ffe);
  assert.equal(result.records[9]!.after.usp, 0x34008000);
  checkMemory(ram, true, true);
  const fresh = create68000AddressingExample();
  assert.deepEqual(fresh.cpu.snapshot(), before);
});
