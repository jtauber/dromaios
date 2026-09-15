import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu68000 } from "../../../src/components/cpus/68000.js";
import type { Cpu68000Snapshot, Cpu68000StepRecord, Cpu68000MemoryAccess } from "../../../src/components/cpus/68000.js";
import type { Ram } from "../../../src/components/memory/ram.js";
import { create68000BitsExample, create68000BitsExampleMemory } from "../../../src/machines/generated/68000/bits-example.js";
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
const program = [0x41, 0xf9, 0xab, 0, 0x30, 0, 0x43, 0xf9, 0xcd, 0, 0x40, 0, 0x45, 0xf9, 0xef, 0, 0x50, 0,
  0x42, 0x80, 0x72, 0, 0x7e, 3, 0x12, 0x18, 3, 0xc0, 3, 0x51, 0x57, 0xda, 0x51, 0xcf, 0xff, 0xf6,
  8, 0, 0, 31, 8, 0x80, 0, 31, 8, 0xd1, 0, 7, 3, 0x11, 3, 0x91, 8, 0x40, 0, 0, 8, 0x3a, 0, 7, 0, 0x44];

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
  step([0x42, 0x80], 0x2014, { d0: 0 }, "10100");
  step([0x72, 0], 0x2016, { d1: 0 }, "10100");
  step([0x7e, 3], 0x2018, { d7: 3 }, "10000");
  const requests = [
    { bit: 0, bitmap: 1, oldByte: 0, newByte: 1, classification: 255 },
    { bit: 7, bitmap: 0x81, oldByte: 1, newByte: 0x81, classification: 255 },
    { bit: 8, bitmap: 0x181, oldByte: 0x81, newByte: 0x80, classification: 0 },
    { bit: 31, bitmap: 0x80000181, oldByte: 0x80, newByte: 0, classification: 0 },
  ];
  for (const [index, row] of requests.entries()) {
    step([0x12, 0x18], 0x201a, { d1: row.bit, a0: 0xab003001 + index }, index === 0 ? "10100" : "10000", read(0x3000 + index, row.bit));
    step([3, 0xc0], 0x201c, { d0: row.bitmap }, "10100");
    step([3, 0x51], 0x201e, {}, row.classification ? "10100" : "10000", [...read(0x4000, row.oldByte), ...write(0x4000, row.newByte)]);
    step([0x57, 0xda], 0x2020, { a2: 0xef005001 + index }, undefined, [...read(0x5000 + index, 0xcc), ...write(0x5000 + index, row.classification)]);
    step([0x51, 0xcf, 0xff, 0xf6], index === 3 ? 0x2024 : 0x2018, { d7: index === 3 ? 0xffff : 2 - index });
  }
  step([8, 0, 0, 31], 0x2028);
  step([8, 0x80, 0, 31], 0x202c, { d0: 0x181 });
  step([8, 0xd1, 0, 7], 0x2030, {}, "10100", [...read(0x4000, 0), ...write(0x4000, 0x80)]);
  step([3, 0x11], 0x2032, {}, "10000", read(0x4000, 0x80));
  step([3, 0x91], 0x2034, {}, undefined, [...read(0x4000, 0x80), ...write(0x4000, 0)]);
  step([8, 0x40, 0, 0], 0x2038, { d0: 0x180 });
  step([8, 0x3a, 0, 7, 0, 0x44], 0x203e, {}, undefined, read(0x2080, 0x80));
  return records;
}

function checkMemory(ram: Ram, finished = false): void {
  const expected = new Uint8Array(0x1000000);
  expected.set([0x56, 0, 0x90, 0, 0xab, 0, 0x20, 0]);
  expected.set(program, 0x2000);
  expected[0x2080] = 0x80;
  expected.set([0xde, 0xad, 0, 7, 8, 31, 0xbe, 0xef], 0x2ffe);
  expected.set([0xde, 0xad, 0, 0xbe, 0xef], 0x3ffe);
  expected.set([0xde, 0xad, ...(finished ? [255, 255, 0, 0] : [0xcc, 0xcc, 0xcc, 0xcc]), 0xbe, 0xef], 0x4ffe);
  for (const [address, value] of expected.entries()) assert.equal(ram.read(address), value, `memory at ${address}`);
}

test("68000 bits factories own their state and RAM and expose the full logical endpoint", () => {
  const first = create68000BitsExample();
  const second = create68000BitsExample();
  const memory = create68000BitsExampleMemory();
  assert.deepEqual(first.cpu.snapshot(), initialState());
  assert.equal(first.endAddress, 0xab00203e);
  checkMemory(first.ram);
  checkMemory(memory);
  first.cpu.step();
  first.ram.write(0x3000, 31);
  memory.write(0x4000, 0xff);
  assert.deepEqual(second.cpu.snapshot(), initialState());
  assert.equal(second.ram.read(0x3000), 0);
  assert.equal(second.ram.read(0x4000), 0);
});

test("68000 bits example combines static and dynamic operations in 33 exact records in both modes", t => {
  for (const supervisor of [false, true]) {
    const { cpu, ram, endAddress } = create68000BitsExample();
    if (supervisor) assert.deepEqual(cpu.reset(), { before: initialState(), after: initialState(true),
      accesses: read(0, 0x56, 0, 0x90, 0, 0xab, 0, 0x20, 0) });
    const reads = t.mock.method(ram, "read");
    const writes = t.mock.method(ram, "write");
    const records = expectedRecords(supervisor);
    assert.equal(records.length, 33);
    assert.deepEqual(runCpu(cpu, { maxSteps: 33, endAddress }), { stopReason: "completed", records });
    const accesses = records.flatMap(record => record.accesses);
    assert.deepEqual(reads.mock.calls.map(call => call.arguments), accesses.filter(a => a.kind === "read").map(a => [a.address]));
    assert.deepEqual(writes.mock.calls.map(call => call.arguments), accesses.filter(a => a.kind === "write").map(a => [a.address, a.value]));
    assert.deepEqual(cpu.snapshot(), records[32]!.after);
    assert.equal(runCpu(cpu, { maxSteps: 0, endAddress }).stopReason, "completed");
    assert.equal(runCpu(cpu, { maxSteps: 0, endAddress: 0x203e }).stopReason, "step-limit");
    t.mock.restoreAll();
    checkMemory(ram, true);
  }
});

test("68000 bits example resumes between a bit modification and the condition-byte write using saved Z", () => {
  const { cpu, ram, endAddress } = create68000BitsExample();
  const records = expectedRecords();
  const first = runCpu(cpu, { maxSteps: 19, endAddress });
  const saved = structuredClone(first);
  assert.deepEqual(first, { stopReason: "step-limit", records: records.slice(0, 19) });
  assert.equal(cpu.snapshot().flags.z, false); // Third request toggled an old one to zero.
  const restoredRam = create68000BitsExampleMemory();
  for (const access of first.records.flatMap(record => record.accesses)) {
    if (access.kind === "write") restoredRam.write(access.address, access.value);
  }
  const restored = new Cpu68000(restoredRam, cpu.snapshot());
  for (const running of [cpu, restored]) {
    assert.deepEqual(runCpu(running, { maxSteps: 14, endAddress }), { stopReason: "completed", records: records.slice(19) });
  }
  cpu.reset();
  assert.deepEqual(first, saved);
  assert.equal(ram.read(0x5002), 0);
  assert.equal(restoredRam.read(0x5002), 0);
});

test("68000 bits example consumes live bit requests and PC-relative data and preserves results on reset", () => {
  const { cpu, ram, endAddress } = create68000BitsExample();
  ram.write(0x3002, 1); // Distinct modulo-eight position instead of a repeated bit zero.
  ram.write(0x2080, 0); // Final BTST now sets Z.
  assert.equal(runCpu(cpu, { maxSteps: 33, endAddress }).stopReason, "completed");
  assert.equal(cpu.snapshot().d0, 0x82);
  assert.equal(ram.read(0x4000), 3);
  assert.equal(ram.read(0x5002), 0xff);
  assert.equal(cpu.snapshot().flags.z, true);
  cpu.reset();
  assert.equal(cpu.snapshot().pc, 0xab002000);
  assert.equal(cpu.snapshot().d0, 0x82);
  assert.equal(ram.read(0x5002), 0xff);
  assert.equal(ram.read(0x4000), 3);
});
