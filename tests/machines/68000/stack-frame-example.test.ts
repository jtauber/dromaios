import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu68000 } from "../../../src/components/cpus/generated/68000-cpu.js";
import type { Cpu68000Snapshot, Cpu68000StepRecord, Cpu68000MemoryAccess } from "../../../src/components/cpus/generated/68000-cpu.js";
import type { Ram } from "../../../src/components/memory/ram.js";
import { create68000StackFrameExample, create68000StackFrameExampleMemory } from "../../../src/machines/generated/68000/stack-frame-example.js";
import { runCpu } from "../../../src/runtime/run-cpu.js";

function initialState(supervisor = false): Cpu68000Snapshot {
  return { d0: 0x11223344, d1: 0x55667788, d2: 0x99aabbcc, d3: 0xddeeff00,
    d4: 0x01234567, d5: 0x89abcdef, d6: 0xfedcba98, d7: 0x76543210,
    a0: 0x10000000, a1: 0x20000000, a2: 0x30000000, a3: 0x40000000,
    a4: 0x50000000, a5: 0x60000000, a6: 0x70000000, usp: 0x34008000, ssp: 0x56009000,
    pc: 0xab002000, a7: supervisor ? 0x56009000 : 0x34008000, physicalPc: 0x2000, ir: 0, faulted: false, entry: { kind: supervisor ? "reset" : "none", vector: 0 }, halted: false, tracePending: false, interruptMask: supervisor ? 7 : 2,
    flags: { x: true, n: false, z: true, v: true, c: true, t: false, s: supervisor } };
}

const accesses = (kind: "read" | "write", address: number, bytes: readonly number[]): Cpu68000MemoryAccess[] =>
  bytes.map((value, offset) => ({ kind, address: (address + offset) % 16777216, value }));
const long = (value: number): number[] =>
  [Math.floor(value / 16777216), Math.floor(value / 65536) % 256, Math.floor(value / 256) % 256, value % 256];
const main = [0x41, 0xfa, 0x0f, 0xfe, 0x48, 0x50, 0x4e, 0xba, 0, 0x38,
  0xde, 0xfc, 0, 4, 0x43, 0xfa, 0, 0x10, 0x4e, 0xd1];
const subroutine = [0x4e, 0x56, 0xff, 0xf8, 0x48, 0xe7, 0x60, 0x80, 0x20, 0x6e, 0, 8,
  0x4c, 0x98, 0, 6, 0xd4, 0x81, 0x2d, 0x42, 0xff, 0xfc, 0x20, 0x2e, 0xff, 0xfc,
  0x4c, 0xdf, 1, 6, 0x4e, 0x5e, 0x4e, 0x75];

function expectedRecords(supervisor = false): Cpu68000StepRecord[] {
  let before = initialState(supervisor);
  const sp = before.a7;
  const stack = supervisor ? "ssp" : "usp";
  const records: Cpu68000StepRecord[] = [];
  const pointer = (offset: number): Partial<Cpu68000Snapshot> => ({ [stack]: sp + offset, a7: sp + offset });
  function step(bytes: number[], nextPc: number, changes: Partial<Cpu68000Snapshot> = {}, data: Cpu68000MemoryAccess[] = []): void {
    const after = { ...before, entry: { kind: "none", vector: 0 } as const, ir: bytes[0]! * 256 + bytes[1]!, flags: { ...before.flags }, ...changes, pc: 0xab000000 + nextPc, physicalPc: nextPc };
    records.push({ before, after, outcome: "executed", instruction: { address: before.pc, bytes },
      accesses: [...accesses("read", before.pc, bytes), ...data] });
    before = after;
  }
  step([0x41, 0xfa, 0x0f, 0xfe], 0x2004, { a0: 0xab003000 });
  step([0x48, 0x50], 0x2006, pointer(-4), accesses("write", sp - 4, long(0xab003000)));
  step([0x4e, 0xba, 0, 0x38], 0x2040, pointer(-8), accesses("write", sp - 8, long(0xab00200a)));
  step([0x4e, 0x56, 0xff, 0xf8], 0x2044, { ...pointer(-20), a6: sp - 12 }, accesses("write", sp - 12, long(0x70000000)));
  step([0x48, 0xe7, 0x60, 0x80], 0x2048, pointer(-32), [
    ...accesses("write", sp - 24, long(0xab003000)), ...accesses("write", sp - 28, long(0x99aabbcc)),
    ...accesses("write", sp - 32, long(0x55667788)),
  ]);
  step([0x20, 0x6e, 0, 8], 0x204c, {}, accesses("read", sp - 4, long(0xab003000)));
  step([0x4c, 0x98, 0, 6], 0x2050, { a0: 0xab003004, d1: 0x7fff, d2: 0xffff8000 }, accesses("read", 0x3000, [0x7f, 0xff, 0x80, 0]));
  step([0xd4, 0x81], 0x2052, { d2: 0xffffffff, flags: { ...before.flags, x: false, n: true, z: false, v: false, c: false } });
  step([0x2d, 0x42, 0xff, 0xfc], 0x2056, {}, accesses("write", sp - 16, long(0xffffffff)));
  step([0x20, 0x2e, 0xff, 0xfc], 0x205a, { d0: 0xffffffff }, accesses("read", sp - 16, long(0xffffffff)));
  step([0x4c, 0xdf, 1, 6], 0x205e, { ...pointer(-20), d1: 0x55667788, d2: 0x99aabbcc, a0: 0xab003000 }, [
    ...accesses("read", sp - 32, long(0x55667788)), ...accesses("read", sp - 28, long(0x99aabbcc)),
    ...accesses("read", sp - 24, long(0xab003000)),
  ]);
  step([0x4e, 0x5e], 0x2060, { ...pointer(-8), a6: 0x70000000 }, accesses("read", sp - 12, long(0x70000000)));
  step([0x4e, 0x75], 0x200a, pointer(-4), accesses("read", sp - 8, long(0xab00200a)));
  step([0xde, 0xfc, 0, 4], 0x200e, pointer(0));
  step([0x43, 0xfa, 0, 0x10], 0x2012, { a1: 0xab002020 });
  step([0x4e, 0xd1], 0x2020);
  return records;
}

function checkMemory(ram: Ram, finished = false, supervisor = false): void {
  const expected = new Uint8Array(0x1000000);
  expected.set([0x56, 0, 0x90, 0, 0xab, 0, 0x20, 0]);
  expected.set(main, 0x2000);
  expected.set(subroutine, 0x2040);
  expected.set([0xde, 0xad, 0x7f, 0xff, 0x80, 0, 0xbe, 0xef], 0x2ffe);
  if (finished) {
    const sp = supervisor ? 0x9000 : 0x8000;
    expected.set([0x55, 0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xab, 0, 0x30, 0,
      0, 0, 0, 0, 0xff, 0xff, 0xff, 0xff, 0x70, 0, 0, 0, 0xab, 0, 0x20, 0x0a, 0xab, 0, 0x30, 0], sp - 32);
  }
  for (const [address, value] of expected.entries()) assert.equal(ram.read(address), value, `memory at ${address}`);
}

test("68000 frame factories own their memory and state and preserve the full logical endpoint", () => {
  const first = create68000StackFrameExample();
  const second = create68000StackFrameExample();
  const memory = create68000StackFrameExampleMemory();
  assert.deepEqual(first.cpu.snapshot(), initialState());
  assert.equal(first.endAddress, 0xab002020);
  checkMemory(first.ram);
  checkMemory(memory);
  first.cpu.step();
  first.ram.write(0x3000, 0);
  memory.write(0x3001, 0);
  assert.deepEqual(second.cpu.snapshot(), initialState());
  checkMemory(second.ram);
});

test("68000 frame example combines all seven new families in sixteen exact records in both modes", t => {
  for (const supervisor of [false, true]) {
    const { cpu, ram, endAddress } = create68000StackFrameExample();
    if (supervisor) assert.deepEqual(cpu.reset(), { before: initialState(), after: initialState(true),
      accesses: accesses("read", 0, [0x56, 0, 0x90, 0, 0xab, 0, 0x20, 0]) });
    const reads = t.mock.method(ram, "read");
    const writes = t.mock.method(ram, "write");
    const records = expectedRecords(supervisor);
    assert.equal(records.length, 16);
    assert.deepEqual(runCpu(cpu, { maxSteps: 16, endAddress }), { stopReason: "completed", records });
    const expected = records.flatMap(record => record.accesses);
    assert.deepEqual(reads.mock.calls.map(call => call.arguments), expected.flatMap(a => a.kind === "read" ? [[a.address]] : []));
    assert.deepEqual(writes.mock.calls.map(call => call.arguments), expected.flatMap(a => a.kind === "write" ? [[a.address, a.value]] : []));
    assert.deepEqual(cpu.snapshot(), records[15]!.after);
    assert.deepEqual(runCpu(cpu, { maxSteps: 0, endAddress }), { stopReason: "completed", records: [] });
    assert.equal(runCpu(cpu, { maxSteps: 0, endAddress: 0x2020 }).stopReason, "step-limit");
    t.mock.restoreAll();
    checkMemory(ram, true, supervisor);
  }
});

test("68000 frame example resumes from saved registers with detached records and a restored snapshot", () => {
  const { cpu, ram, endAddress } = create68000StackFrameExample();
  const records = expectedRecords();
  const first = runCpu(cpu, { maxSteps: 7, endAddress });
  const saved = structuredClone(first);
  assert.deepEqual(first, { stopReason: "step-limit", records: records.slice(0, 7) });
  const restoredRam = create68000StackFrameExampleMemory();
  for (const access of first.records.flatMap(record => record.accesses)) {
    if (access.kind === "write") restoredRam.write(access.address, access.value);
  }
  const restored = new Cpu68000(restoredRam, cpu.snapshot());
  for (const running of [cpu, restored]) {
    assert.deepEqual(runCpu(running, { maxSteps: 9, endAddress }), { stopReason: "completed", records: records.slice(7) });
  }
  assert.deepEqual(first, saved);
  checkMemory(ram, true);
  checkMemory(restoredRam, true);
});

test("68000 frame example reads live input and reset preserves its result and stack memory", () => {
  const { cpu, ram, endAddress } = create68000StackFrameExample();
  ram.write(0x3000, 0);
  ram.write(0x3001, 0);
  assert.equal(runCpu(cpu, { maxSteps: 16, endAddress }).stopReason, "completed");
  assert.equal(cpu.snapshot().d0, 0xffff8000);
  assert.equal(cpu.snapshot().usp, 0x34008000);
  cpu.reset();
  assert.equal(cpu.snapshot().pc, 0xab002000);
  assert.equal(cpu.snapshot().d0, 0xffff8000);
  assert.deepEqual([ram.read(0x7ff0), ram.read(0x7ff1), ram.read(0x7ff2), ram.read(0x7ff3)], [0xff, 0xff, 0x80, 0]);
});
