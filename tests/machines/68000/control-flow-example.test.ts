import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu68000 } from "../../../src/components/cpus/68000.js";
import type { Cpu68000Snapshot, Cpu68000StepRecord, Cpu68000MemoryAccess } from "../../../src/components/cpus/68000.js";
import type { Ram } from "../../../src/components/memory/ram.js";
import { create68000ControlFlowExample, create68000ControlFlowExampleMemory } from "../../../src/machines/generated/68000/control-flow-example.js";
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
const program = [0x20, 0x7c, 0xab, 0, 0x30, 0, 0x22, 0x3c, 0x12, 0x34, 0, 3, 0x74, 0,
  0x61, 0, 0, 0x30, 0x23, 0xc2, 0xcd, 0, 0x40, 0, 0x60, 0, 0, 0x66];
const process = [0x61, 0x1e, 6, 0x42, 0, 1, 0x51, 0xc9, 0xff, 0xf8, 0x4e, 0x75];
const transform = [6, 0x10, 0, 1, 0x66, 4, 0, 0x10, 0, 1, 0x10, 0x18, 0x4e, 0x75];

function expectedRecords(supervisor = false): Cpu68000StepRecord[] {
  let before = initialState(supervisor);
  const records: Cpu68000StepRecord[] = [];
  const stack = supervisor ? "ssp" : "usp";
  const top = before[stack];
  const physicalTop = supervisor ? 0x9000 : 0x8000;
  const stackAt = (address: number) => ({ [stack]: address, a7: address });
  function step(bytes: number[], nextPc: number, changes: Partial<Cpu68000Snapshot> = {}, condition?: string,
    data: Cpu68000MemoryAccess[] = []): void {
    const flags = condition === undefined ? { ...before.flags } : { ...before.flags,
      x: condition[0] === "1", n: condition[1] === "1", z: condition[2] === "1", v: condition[3] === "1", c: condition[4] === "1" };
    const after = { ...before, ...changes, flags, pc: 0xab000000 + nextPc, physicalPc: nextPc };
    records.push({ before, after, outcome: "executed", instruction: { address: before.pc, bytes },
      accesses: [...read(before.physicalPc, ...bytes), ...data] });
    before = after;
  }
  step([0x20, 0x7c, 0xab, 0, 0x30, 0], 0x2006, { a0: 0xab003000 });
  step([0x22, 0x3c, 0x12, 0x34, 0, 3], 0x200c, { d1: 0x12340003 }, "10000");
  step([0x74, 0], 0x200e, { d2: 0 }, "10100");
  step([0x61, 0, 0, 0x30], 0x2040, stackAt(top - 4), undefined, write(physicalTop - 4, 0xab, 0, 0x20, 0x12));
  // Literal input, sum, final byte, ADDI flags, and MOVE flags for each loop iteration.
  const cases = [[0, 1, 1, "00000", "00000"], [0x7f, 0x80, 0x80, "01010", "01000"],
    [0xff, 0, 1, "10101", "10000"], [0xfe, 0xff, 0xff, "01000", "01000"]] as const;
  for (const [index, [input, sum, result, arithmeticFlags, moveFlags]] of cases.entries()) {
    step([0x61, 0x1e], 0x2060, stackAt(top - 8), undefined, write(physicalTop - 8, 0xab, 0, 0x20, 0x42));
    step([6, 0x10, 0, 1], 0x2064, {}, arithmeticFlags, [...read(0x3000 + index, input), ...write(0x3000 + index, sum)]);
    step([0x66, 4], index === 2 ? 0x2066 : 0x206a);
    if (index === 2) step([0, 0x10, 0, 1], 0x206a, {}, "10000", [...read(0x3002, 0), ...write(0x3002, 1)]);
    step([0x10, 0x18], 0x206c, { a0: 0xab003001 + index, d0: 0x11223300 + result }, moveFlags, read(0x3000 + index, result));
    step([0x4e, 0x75], 0x2042, stackAt(top - 4), undefined, read(physicalTop - 8, 0xab, 0, 0x20, 0x42));
    step([6, 0x42, 0, 1], 0x2046, { d2: index + 1 }, "00000");
    step([0x51, 0xc9, 0xff, 0xf8], index === 3 ? 0x204a : 0x2040, { d1: index === 3 ? 0x1234ffff : 0x12340002 - index });
  }
  step([0x4e, 0x75], 0x2012, stackAt(top), undefined, read(physicalTop - 4, 0xab, 0, 0x20, 0x12));
  step([0x23, 0xc2, 0xcd, 0, 0x40, 0], 0x2018, {}, "00000", write(0x4000, 0, 0, 0, 4));
  step([0x60, 0, 0, 0x66], 0x2080);
  return records;
}

function checkMemory(ram: Ram, finished = false, supervisor = false): void {
  const expected = new Uint8Array(0x1000000);
  expected.set([0x56, 0, 0x90, 0, 0xab, 0, 0x20, 0]);
  expected.set(program, 0x2000);
  expected.set(process, 0x2040);
  expected.set(transform, 0x2060);
  expected.set([0xde, 0xad, ...(finished ? [1, 0x80, 1, 0xff] : [0, 0x7f, 0xff, 0xfe]), 0xbe, 0xef], 0x2ffe);
  expected.set([0xde, 0xad, ...(finished ? [0, 0, 0, 4] : [0xcc, 0xcc, 0xcc, 0xcc]), 0xbe, 0xef], 0x3ffe);
  for (const address of [0x7ff6, 0x8ff6]) expected.set([0xde, 0xad, ...Array<number>(8).fill(0xcc), 0xbe, 0xef], address);
  if (finished) expected.set([0xab, 0, 0x20, 0x42, 0xab, 0, 0x20, 0x12], supervisor ? 0x8ff8 : 0x7ff8);
  for (const [address, value] of expected.entries()) assert.equal(ram.read(address), value, `memory at ${address}`);
}

test("68000 control-flow factories own full RAM images and a logical completion address", () => {
  const first = create68000ControlFlowExample();
  const second = create68000ControlFlowExample();
  const memory = create68000ControlFlowExampleMemory();
  assert.deepEqual(first.cpu.snapshot(), initialState());
  assert.equal(first.endAddress, 0xab002080);
  checkMemory(first.ram);
  checkMemory(memory);
  first.cpu.step();
  first.ram.write(0x3000, 0xff);
  memory.write(0x4000, 0);
  assert.deepEqual(second.cpu.snapshot(), initialState());
  checkMemory(second.ram);
});

test("68000 nested calls transform a buffer with 36 exact records and real stack accesses", t => {
  for (const supervisor of [false, true]) {
    const { cpu, ram, endAddress } = create68000ControlFlowExample();
    if (supervisor) {
      assert.deepEqual(cpu.reset(), { before: initialState(), after: initialState(true),
        accesses: read(0, 0x56, 0, 0x90, 0, 0xab, 0, 0x20, 0) });
    }
    const reads = t.mock.method(ram, "read");
    const writes = t.mock.method(ram, "write");
    const records = expectedRecords(supervisor);
    assert.equal(records.length, 36);
    assert.deepEqual(runCpu(cpu, { maxSteps: 36, endAddress }), { stopReason: "completed", records });
    const accesses = records.flatMap(record => record.accesses);
    assert.deepEqual(reads.mock.calls.map(call => call.arguments), accesses.flatMap(a => a.kind === "read" ? [[a.address]] : []));
    assert.deepEqual(writes.mock.calls.map(call => call.arguments), accesses.flatMap(a => a.kind === "write" ? [[a.address, a.value]] : []));
    assert.deepEqual(cpu.snapshot(), records[35]!.after);
    assert.deepEqual(runCpu(cpu, { maxSteps: 0, endAddress }), { stopReason: "completed", records: [] });
    assert.equal(runCpu(cpu, { maxSteps: 0, endAddress: 0x2080 }).stopReason, "step-limit");
    t.mock.restoreAll();
    checkMemory(ram, true, supervisor);
  }
});

test("68000 control-flow resumes with two live return addresses, restores snapshots, and detaches traces", () => {
  const { cpu, ram, endAddress } = create68000ControlFlowExample();
  const expected = expectedRecords();
  const first = runCpu(cpu, { maxSteps: 6, endAddress });
  const saved = structuredClone(first);
  assert.deepEqual(first, { stopReason: "step-limit", records: expected.slice(0, 6) });
  const restoredRam = create68000ControlFlowExampleMemory();
  for (const access of first.records.flatMap(record => record.accesses)) {
    if (access.kind === "write") restoredRam.write(access.address, access.value);
  }
  const restored = new Cpu68000(restoredRam, cpu.snapshot());
  assert.deepEqual(runCpu(cpu, { maxSteps: 30, endAddress }), { stopReason: "completed", records: expected.slice(6) });
  assert.deepEqual(runCpu(restored, { maxSteps: 30, endAddress }), { stopReason: "completed", records: expected.slice(6) });
  assert.deepEqual(first, saved);
  checkMemory(ram, true);
  checkMemory(restoredRam, true);
  const final = cpu.snapshot();
  Reflect.set(first.records[4]!.after, "usp", 0);
  Reflect.set(first.records[4]!.after.flags, "s", true);
  assert.deepEqual(first.records[5]!.before, saved.records[5]!.before);
  assert.deepEqual(cpu.snapshot(), final);
});

test("68000 runner stops at an odd call target without pushing, then resumes with corrected code", () => {
  const { cpu, ram, endAddress } = create68000ControlFlowExample();
  const expected = expectedRecords();
  assert.equal(runCpu(cpu, { maxSteps: 4, endAddress }).stopReason, "step-limit");
  ram.write(0x2041, 1);
  const rejected = runCpu(cpu, { maxSteps: 32, endAddress });
  assert.equal(rejected.stopReason, "unsupported");
  assert.equal(rejected.records.length, 1);
  const before = expected[4]!.before;
  assert.deepEqual(rejected.records[0], { before, after: before, outcome: "unsupported", reason: "unaligned-address",
    instruction: { address: 0xab002040, bytes: [0x61, 1] }, fault: { operation: "fetch", address: 0xab002043 },
    accesses: read(0x2040, 0x61, 1) });
  for (const address of [0x7ff8, 0x7ff9, 0x7ffa, 0x7ffb]) assert.equal(ram.read(address), 0xcc);
  ram.write(0x2041, 0x1e);
  assert.deepEqual(runCpu(cpu, { maxSteps: 32, endAddress }), { stopReason: "completed", records: expected.slice(4) });
});

test("68000 loops obey the runner budget and changed input follows the conditional path", () => {
  const loop = create68000ControlFlowExample();
  loop.ram.write(0x2000, 0x60);
  loop.ram.write(0x2001, 0xfe); // BRA back to itself.
  const bounded = runCpu(loop.cpu, { maxSteps: 5, endAddress: loop.endAddress });
  assert.equal(bounded.stopReason, "step-limit");
  assert.equal(bounded.records.length, 5);
  assert.ok(bounded.records.every(record => record.after.pc === 0xab002000 && record.accesses.length === 2));
  const { cpu, ram, endAddress } = create68000ControlFlowExample();
  ram.write(0x3002, 0x10); // Remove the only zero result and its correction instruction.
  const result = runCpu(cpu, { maxSteps: 36, endAddress });
  assert.equal(result.stopReason, "completed");
  assert.equal(result.records.length, 35);
  assert.equal(ram.read(0x3002), 0x11);
  assert.equal(cpu.snapshot().d2, 4);
  const before = cpu.snapshot();
  cpu.reset();
  assert.equal(ram.read(0x3002), 0x11);
  assert.equal(cpu.snapshot().d1, before.d1);
  assert.equal(cpu.snapshot().pc, 0xab002000);
});
