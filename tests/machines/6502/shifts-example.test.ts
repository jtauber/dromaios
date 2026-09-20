import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu6502 } from "../../../src/components/cpus/generated/6502-cpu.js";
import type { Cpu6502Flags, Cpu6502MemoryAccess, Cpu6502Snapshot, Cpu6502StepRecord } from "../../../src/components/cpus/generated/6502-cpu.js";
import type { Ram } from "../../../src/components/memory/ram.js";
import { create6502ShiftsExample, create6502ShiftsExampleMemory } from "../../../src/machines/generated/6502/shifts-example.js";
import { runCpu } from "../../../src/runtime/run-cpu.js";

function expectedInitialState(): Cpu6502Snapshot {
  return { a: 0x11, x: 0x22, y: 0x33, pc: 0x0200, sp: 0xab,
    flags: { n: true, v: true, d: true, i: true, z: true, c: true } };
}

function checkMemory(ram: Ram, finished: boolean): void {
  const expected = new Uint8Array(0x10000);
  expected.set([
    0xa2, 1, 0x16, 0x7f, 0x3e, 0x80, 0, 0xe6, 0x83, 0xc6, 0x82, 0xd0, 0xf5,
    0x46, 0x81, 0x66, 0x80, 0xa5, 0x80, 0x0a, 0x6a, 0x2a, 0x4a, 0x8d, 0x90, 0, 0x4c, 0x20, 2,
  ], 0x0200);
  expected.set(finished ? [0xaa, 0xfe, 1, 0, 2, 0x55] : [0xaa, 0xff, 0x80, 2, 0, 0x55], 0x7f);
  expected.set([0xaa, finished ? 0x7e : 0xcc, 0x55], 0x8f);
  expected.set([0, 2], 0xfffc);
  assert.equal(ram.size, expected.length);
  expected.forEach((value, address) => assert.equal(ram.read(address), value, `RAM ${address}`));
}

function expectedRecords(): readonly Cpu6502StepRecord[] {
  const modify = (address: number, old: number, value: number): readonly Cpu6502MemoryAccess[] => [
    { kind: "read", address, value: old }, { kind: "write", address, value: old }, { kind: "write", address, value },
  ];
  const records: Cpu6502StepRecord[] = [];
  let state = expectedInitialState();
  const append = (bytes: readonly number[], pc: number,
    changes: Partial<Omit<Cpu6502Snapshot, "flags">> & { flags?: Partial<Cpu6502Flags> } = {},
    data: readonly Cpu6502MemoryAccess[] = []) => {
    const before = state;
    state = { ...before, ...changes, pc, flags: { ...before.flags, ...changes.flags } };
    records.push({ before, after: state, instruction: { address: before.pc, bytes }, outcome: "executed",
      accesses: [...bytes.map((value, offset) => ({ kind: "read" as const, address: before.pc + offset, value })), ...data] });
  };
  append([0xa2, 1], 0x0202, { x: 1, flags: { n: false, z: false } });
  append([0x16, 0x7f], 0x0204, { flags: { n: true, z: false, c: true } }, modify(0x80, 0xff, 0xfe));
  append([0x3e, 0x80, 0], 0x0207, { flags: { n: false, z: false, c: true } }, modify(0x81, 0x80, 1));
  append([0xe6, 0x83], 0x0209, { flags: { n: false, z: false } }, modify(0x83, 0, 1));
  append([0xc6, 0x82], 0x020b, { flags: { n: false, z: false } }, modify(0x82, 2, 1));
  append([0xd0, 0xf5], 0x0202);
  append([0x16, 0x7f], 0x0204, { flags: { n: true, z: false, c: true } }, modify(0x80, 0xfe, 0xfc));
  append([0x3e, 0x80, 0], 0x0207, { flags: { n: false, z: false, c: false } }, modify(0x81, 1, 3));
  append([0xe6, 0x83], 0x0209, { flags: { n: false, z: false } }, modify(0x83, 1, 2));
  append([0xc6, 0x82], 0x020b, { flags: { n: false, z: true } }, modify(0x82, 1, 0));
  append([0xd0, 0xf5], 0x020d);
  append([0x46, 0x81], 0x020f, { flags: { n: false, z: false, c: true } }, modify(0x81, 3, 1));
  append([0x66, 0x80], 0x0211, { flags: { n: true, z: false, c: false } }, modify(0x80, 0xfc, 0xfe));
  append([0xa5, 0x80], 0x0213, { a: 0xfe, flags: { n: true, z: false } }, [{ kind: "read", address: 0x80, value: 0xfe }]);
  append([0x0a], 0x0214, { a: 0xfc, flags: { n: true, z: false, c: true } });
  append([0x6a], 0x0215, { a: 0xfe, flags: { n: true, z: false, c: false } });
  append([0x2a], 0x0216, { a: 0xfc, flags: { n: true, z: false, c: true } });
  append([0x4a], 0x0217, { a: 0x7e, flags: { n: false, z: false, c: false } });
  append([0x8d, 0x90, 0], 0x021a, {}, [{ kind: "write", address: 0x90, value: 0x7e }]);
  append([0x4c, 0x20, 2], 0x0220);
  return records;
}

test("6502 shift factories provide fresh components and the complete initial image", () => {
  const first = create6502ShiftsExample();
  assert.deepEqual(first.cpu.snapshot(), expectedInitialState());
  assert.equal(first.endAddress, 0x0220);
  checkMemory(first.ram, false);
  runCpu(first.cpu, { maxSteps: 20, endAddress: first.endAddress });
  const fresh = create6502ShiftsExample();
  assert.notStrictEqual(fresh.cpu, first.cpu);
  assert.notStrictEqual(fresh.ram, first.ram);
  assert.deepEqual(fresh.cpu.snapshot(), expectedInitialState());
  checkMemory(fresh.ram, false);
  const memory = create6502ShiftsExampleMemory();
  memory.write(0x80, 0);
  checkMemory(create6502ShiftsExampleMemory(), false);
});

test("6502 shifts a two-byte word, counts in memory, and records both writes with D set", t => {
  const { cpu, ram, endAddress } = create6502ShiftsExample();
  const accesses: Cpu6502MemoryAccess[] = [];
  const read = ram.read.bind(ram), write = ram.write.bind(ram);
  t.mock.method(ram, "read", (address: number) => {
    const value = read(address);
    accesses.push({ kind: "read", address, value });
    return value;
  });
  t.mock.method(ram, "write", (address: number, value: number) => {
    write(address, value);
    accesses.push({ kind: "write", address, value });
  });
  const expected = expectedRecords();
  const run = runCpu(cpu, { maxSteps: 20, endAddress });
  assert.equal(expected.length, 20);
  assert.deepEqual(run, { records: expected, stopReason: "completed" });
  assert.deepEqual(accesses, expected.flatMap(record => record.accesses));
  t.mock.restoreAll();
  checkMemory(ram, true);
  const final = { a: 0x7e, x: 1, y: 0x33, pc: 0x0220, sp: 0xab,
    flags: { n: false, v: true, d: true, i: true, z: false, c: false } };
  assert.deepEqual(cpu.snapshot(), final);
  assert.deepEqual(runCpu(cpu, { maxSteps: 0, endAddress }), { records: [], stopReason: "completed" });
  const brk = cpu.step();
  assert.equal(brk.outcome, "executed");
  assert.deepEqual(brk.instruction, { address: 0x0220, bytes: [0, 0] });
  assert.equal(brk.after.pc, 0); // The unused IRQ/BRK vector contains zero.
});

test("6502 shifts resume with carry between bytes and retain records across reset and host edits", () => {
  for (const pauseAfter of [2, 3, 5, 10, 12, 15]) {
    const { cpu, ram, endAddress } = create6502ShiftsExample();
    const first = runCpu(cpu, { maxSteps: pauseAfter, endAddress });
    const saved = structuredClone(first);
    assert.equal(first.stopReason, "step-limit");
    const resumed = new Cpu6502(ram, cpu.snapshot());
    const rest = runCpu(resumed, { maxSteps: 20 - pauseAfter, endAddress });
    assert.equal(rest.stopReason, "completed");
    assert.deepEqual([...first.records, ...rest.records], expectedRecords());
    checkMemory(ram, true);
    const before = resumed.snapshot();
    const memory = Array.from({ length: ram.size }, (_, address) => ram.read(address));
    assert.deepEqual(resumed.reset(), { before,
      after: { ...before, pc: 0x0200, sp: 0xa8 },
      accesses: [{ kind: "read", address: 0xfffc, value: 0 }, { kind: "read", address: 0xfffd, value: 2 }] });
    memory.forEach((value, address) => assert.equal(ram.read(address), value));
    ram.write(0x80, 0);
    assert.deepEqual(first, saved);
    checkMemory(create6502ShiftsExampleMemory(), false);
  }
});

test("an edited 6502 counter branch stays bounded while preserving its carry", () => {
  const { cpu, ram, endAddress } = create6502ShiftsExample();
  runCpu(cpu, { maxSteps: 5, endAddress });
  ram.write(0x020c, 0xfe);
  const before = cpu.snapshot();
  assert.equal(before.pc, 0x020b);
  assert.equal(before.flags.c, true);
  const record: Cpu6502StepRecord = { before, after: before, outcome: "executed",
    instruction: { address: 0x020b, bytes: [0xd0, 0xfe] },
    accesses: [{ kind: "read", address: 0x020b, value: 0xd0 }, { kind: "read", address: 0x020c, value: 0xfe }] };
  assert.deepEqual(runCpu(cpu, { maxSteps: 3, endAddress }), { records: [record, record, record], stopReason: "step-limit" });
});
