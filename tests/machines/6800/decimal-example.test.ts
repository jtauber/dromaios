import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu6800 } from "../../../src/components/cpus/generated/6800-cpu.js";
import type { Cpu6800Snapshot, Cpu6800StepRecord, Cpu6800MemoryAccess } from "../../../src/components/cpus/generated/6800-cpu.js";
import type { Ram } from "../../../src/components/memory/ram.js";
import { create6800DecimalExample, create6800DecimalExampleMemory } from "../../../src/machines/generated/6800/decimal-example.js";
import { runCpu } from "../../../src/runtime/run-cpu.js";

function initialState(): Cpu6800Snapshot {
  return { waiting: false, a: 0x81, b: 0x22, x: 0x3456, sp: 0x789a, pc: 0x200,
    flags: { h: true, i: false, n: true, z: false, v: true, c: true } };
}

function checkMemory(ram: Ram, completed = false): void {
  const expected = new Uint8Array(65536);
  expected.set(completed ? [0xcc, 3, 0xff, 0xc1, 0x25, 4, 0, 0xcc] : [0xcc, 0, 0, 0, 0, 0, 0, 0xcc], 0x7f);
  expected.set(completed ? [0xcc, 2, 0x0e, 0xcc] : [0xcc, 0, 0, 0xcc], 0x3fe);
  expected.set([0x8e, 4, 0, 0x9f, 0x84, 0xce, 3, 0, 0x86, 0x58, 0xc6, 0x67,
    0xad, 0, 0xd7, 0x83, 0xde, 0x80, 0x8c, 3, 0xff, 0x26, 0xfe, 0x7e, 2, 0x40], 0x200);
  expected.set([0x30, 0xdf, 0x80, 0x1b, 0x19, 0x16, 0x07, 0x97, 0x82, 0x17, 0x39], 0x300);
  expected.set([2, 0], 0xfffe);
  assert.equal(ram.size, expected.length);
  for (const [address, byte] of expected.entries()) assert.equal(ram.read(address), byte, `memory at ${address}`);
}

function expectedRecords(): readonly Cpu6800StepRecord[] {
  const steps: readonly {
    bytes: readonly number[]; changes: Partial<Cpu6800Snapshot> & { pc: number }; data?: readonly Cpu6800MemoryAccess[];
  }[] = [
    { bytes: [0x8e, 4, 0], changes: { pc: 0x203, sp: 0x400, flags: { h: true, i: false, n: false, z: false, v: false, c: true } } },
    { bytes: [0x9f, 0x84], changes: { pc: 0x205 }, data: [{ kind: "write", address: 0x84, value: 4 }, { kind: "write", address: 0x85, value: 0 }] },
    { bytes: [0xce, 3, 0], changes: { pc: 0x208, x: 0x300 } },
    { bytes: [0x86, 0x58], changes: { pc: 0x20a, a: 0x58 } },
    { bytes: [0xc6, 0x67], changes: { pc: 0x20c, b: 0x67 } },
    { bytes: [0xad, 0], changes: { pc: 0x300, sp: 0x3fe },
      data: [{ kind: "write", address: 0x400, value: 0x0e }, { kind: "write", address: 0x3ff, value: 2 }] },
    { bytes: [0x30], changes: { pc: 0x301, x: 0x3ff } },
    { bytes: [0xdf, 0x80], changes: { pc: 0x303 }, data: [{ kind: "write", address: 0x80, value: 3 }, { kind: "write", address: 0x81, value: 0xff }] },
    { bytes: [0x1b], changes: { pc: 0x304, a: 0xbf, flags: { h: false, i: false, n: true, z: false, v: true, c: false } } },
    { bytes: [0x19], changes: { pc: 0x305, a: 0x25, flags: { h: false, i: false, n: false, z: false, v: false, c: true } } },
    { bytes: [0x16], changes: { pc: 0x306, b: 0x25 } },
    { bytes: [0x07], changes: { pc: 0x307, a: 0xc1 } },
    { bytes: [0x97, 0x82], changes: { pc: 0x309, flags: { h: false, i: false, n: true, z: false, v: false, c: true } },
      data: [{ kind: "write", address: 0x82, value: 0xc1 }] },
    { bytes: [0x17], changes: { pc: 0x30a, a: 0x25, flags: { h: false, i: false, n: false, z: false, v: false, c: true } } },
    { bytes: [0x39], changes: { pc: 0x20e, sp: 0x400 }, data: [{ kind: "read", address: 0x3ff, value: 2 }, { kind: "read", address: 0x400, value: 0x0e }] },
    { bytes: [0xd7, 0x83], changes: { pc: 0x210 }, data: [{ kind: "write", address: 0x83, value: 0x25 }] },
    { bytes: [0xde, 0x80], changes: { pc: 0x212 }, data: [{ kind: "read", address: 0x80, value: 3 }, { kind: "read", address: 0x81, value: 0xff }] },
    { bytes: [0x8c, 3, 0xff], changes: { pc: 0x215, flags: { h: false, i: false, n: false, z: true, v: false, c: true } } },
    { bytes: [0x26, 0xfe], changes: { pc: 0x217 } },
    { bytes: [0x7e, 2, 0x40], changes: { pc: 0x240 } },
  ];
  let state = initialState();
  return steps.map(({ bytes, changes, data = [] }) => {
    const before = state;
    state = { ...before, ...changes };
    return { before, after: state, instruction: { address: before.pc, bytes }, outcome: "executed",
      accesses: [...bytes.map((value, offset): Cpu6800MemoryAccess => ({ kind: "read", address: before.pc + offset, value })), ...data] };
  });
}

test("6800 decimal factories provide fresh components, complete memory, and the specified completion address", () => {
  const { cpu, ram, endAddress } = create6800DecimalExample();
  const memory = create6800DecimalExampleMemory();
  assert.deepEqual(cpu.snapshot(), initialState());
  assert.equal(endAddress, 0x240);
  assert.notStrictEqual(memory, ram);
  checkMemory(ram);
  checkMemory(memory);
  ram.write(0x83, 0xff);
  assert.equal(memory.read(0x83), 0);
});

test("6800 decimal example adds 58 and 67, records carry and stack pointers, and completes in 20 steps", t => {
  const { cpu, ram, endAddress } = create6800DecimalExample();
  const read = t.mock.method(ram, "read"), write = t.mock.method(ram, "write");
  const records = expectedRecords();
  assert.deepEqual(runCpu(cpu, { maxSteps: 20, endAddress }), { records, stopReason: "completed" });
  const accesses = records.flatMap(record => record.accesses);
  assert.deepEqual(read.mock.calls.map(call => call.arguments), accesses.filter(access => access.kind === "read").map(access => [access.address]));
  assert.deepEqual(write.mock.calls.map(call => call.arguments), accesses.filter(access => access.kind === "write").map(access => [access.address, access.value]));
  assert.equal(read.mock.callCount(), 41);
  assert.equal(write.mock.callCount(), 8);
  assert.deepEqual(cpu.snapshot(), records.at(-1)!.after);
  assert.deepEqual(runCpu(cpu, { maxSteps: 0, endAddress }), { records: [], stopReason: "completed" });
  t.mock.restoreAll();
  checkMemory(ram, true);
});

test("6800 decimal example resumes after adjustment with a saved return address, preserving earlier records through reset", () => {
  const { cpu, ram, endAddress } = create6800DecimalExample();
  const records = expectedRecords();
  const first = runCpu(cpu, { maxSteps: 10, endAddress });
  const saved = structuredClone(first);
  assert.deepEqual(first, { records: records.slice(0, 10), stopReason: "step-limit" });
  const paused = cpu.snapshot();
  const resumed = new Cpu6800(ram, paused);
  Reflect.set(paused.flags, "c", false);
  assert.deepEqual(runCpu(resumed, { maxSteps: 10, endAddress }), { records: records.slice(10), stopReason: "completed" });
  const before = resumed.snapshot();
  const after = { ...before, pc: 0x200, flags: { ...before.flags, i: true } };
  assert.deepEqual(resumed.reset(), { before, after, accesses: [{ kind: "read", address: 0xfffe, value: 2 }, { kind: "read", address: 0xffff, value: 0 }] });
  checkMemory(ram, true);
  assert.deepEqual(first, saved);
  const fresh = create6800DecimalExample();
  assert.notStrictEqual(fresh.cpu, cpu);
  assert.notStrictEqual(fresh.ram, ram);
  assert.deepEqual(fresh.cpu.snapshot(), initialState());
  checkMemory(fresh.ram);
});

test("6800 decimal example rejects an incorrect saved pointer with a bounded loop", () => {
  const { cpu, ram, endAddress } = create6800DecimalExample();
  assert.equal(runCpu(cpu, { maxSteps: 16, endAddress }).stopReason, "step-limit");
  ram.write(0x81, 0xfe);
  const result = runCpu(cpu, { maxSteps: 5, endAddress });
  assert.equal(result.stopReason, "step-limit");
  assert.equal(cpu.snapshot().x, 0x3fe);
  assert.equal(cpu.snapshot().pc, 0x215);
  assert.deepEqual(result.records.slice(2).map(record => record.instruction?.bytes), [[0x26, 0xfe], [0x26, 0xfe], [0x26, 0xfe]]);
});
