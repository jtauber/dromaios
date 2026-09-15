import assert from "node:assert/strict";
import { test } from "node:test";
import { CpuZ80 } from "../../../src/components/cpus/z80.js";
import type { CpuZ80MemoryAccess, CpuZ80Snapshot, CpuZ80StepRecord } from "../../../src/components/cpus/z80.js";
import type { Ram } from "../../../src/components/memory/ram.js";
import {
  createZ80TransfersExample,
  createZ80TransfersExampleMemory,
} from "../../../src/machines/generated/z80/transfers-example.js";
import { runCpu } from "../../../src/runtime/run-cpu.js";

function expectedInitialState(): CpuZ80Snapshot {
  return {
    a: 0x11, b: 0x22, c: 0x33, d: 0x44, e: 0x55, h: 0x66, l: 0x77,
    bc: 0x2233, de: 0x4455, hl: 0x6677,
    flags: { s: true, z: true, h: true, pv: true, n: true, c: true },
    alternate: {
      a: 0x88, b: 0x99, c: 0xaa, d: 0xbb, e: 0xcc, h: 0xdd, l: 0xee,
      bc: 0x99aa, de: 0xbbcc, hl: 0xddee,
      flags: { s: false, z: true, h: false, pv: true, n: false, c: true },
    },
    ix: 0x1234, iy: 0x5678, pc: 0x0200, sp: 0xabcd, i: 0x42, r: 0xfe,
    interruptDeferred: false, nmiDeferred: false, iff1: true, iff2: false, im: 2, halted: false,
  };
}

function checkMemory(ram: Ram, buffer: readonly number[]): void {
  const expected = new Uint8Array(0x10000);
  // Literal image from the specification, independent of the generated factory.
  expected.set([0xcc, ...buffer, 0xcc], 0x7f);
  expected.set([
    0x01, 0, 3, 0x11, 0x55, 0x7f, 0x21, 0x80, 0, 0x31, 0, 0xf0,
    0x72, 0x14, 0x2c, 0x10, 0xfb, 0x36, 0, 0x21, 0x80, 0, 0x7e, 0x4f,
    0x21, 0x82, 0, 0x5e, 0x76,
  ], 0x0200);
  assert.equal(ram.size, expected.length);
  for (const [address, byte] of expected.entries()) assert.equal(ram.read(address), byte, `memory at ${address}`);
}

function expectedRecords(): readonly CpuZ80StepRecord[] {
  const incrementFlags = { s: true, z: false, h: false, pv: false, n: false, c: true };
  const steps: readonly {
    bytes: readonly number[]; changes: Partial<CpuZ80Snapshot>; data?: readonly CpuZ80MemoryAccess[];
  }[] = [
    { bytes: [0x01, 0, 3], changes: { pc: 0x0203, b: 3, c: 0, bc: 0x0300, r: 0xff } },
    { bytes: [0x11, 0x55, 0x7f], changes: { pc: 0x0206, d: 0x7f, de: 0x7f55, r: 0x80 } },
    { bytes: [0x21, 0x80, 0], changes: { pc: 0x0209, h: 0, l: 0x80, hl: 0x0080, r: 0x81 } },
    { bytes: [0x31, 0, 0xf0], changes: { pc: 0x020c, sp: 0xf000, r: 0x82 } },
    { bytes: [0x72], changes: { pc: 0x020d, r: 0x83 }, data: [{ kind: "write", address: 0x80, value: 0x7f }] },
    { bytes: [0x14], changes: { pc: 0x020e, d: 0x80, de: 0x8055, r: 0x84,
      flags: { ...incrementFlags, h: true, pv: true } } },
    { bytes: [0x2c], changes: { pc: 0x020f, l: 0x81, hl: 0x0081, r: 0x85, flags: incrementFlags } },
    { bytes: [0x10, 0xfb], changes: { pc: 0x020c, b: 2, bc: 0x0200, r: 0x86 } },
    { bytes: [0x72], changes: { pc: 0x020d, r: 0x87 }, data: [{ kind: "write", address: 0x81, value: 0x80 }] },
    { bytes: [0x14], changes: { pc: 0x020e, d: 0x81, de: 0x8155, r: 0x88 } },
    { bytes: [0x2c], changes: { pc: 0x020f, l: 0x82, hl: 0x0082, r: 0x89 } },
    { bytes: [0x10, 0xfb], changes: { pc: 0x020c, b: 1, bc: 0x0100, r: 0x8a } },
    { bytes: [0x72], changes: { pc: 0x020d, r: 0x8b }, data: [{ kind: "write", address: 0x82, value: 0x81 }] },
    { bytes: [0x14], changes: { pc: 0x020e, d: 0x82, de: 0x8255, r: 0x8c } },
    { bytes: [0x2c], changes: { pc: 0x020f, l: 0x83, hl: 0x0083, r: 0x8d } },
    { bytes: [0x10, 0xfb], changes: { pc: 0x0211, b: 0, bc: 0, r: 0x8e } },
    { bytes: [0x36, 0], changes: { pc: 0x0213, r: 0x8f }, data: [{ kind: "write", address: 0x83, value: 0 }] },
    { bytes: [0x21, 0x80, 0], changes: { pc: 0x0216, l: 0x80, hl: 0x0080, r: 0x90 } },
    { bytes: [0x7e], changes: { pc: 0x0217, a: 0x7f, r: 0x91 }, data: [{ kind: "read", address: 0x80, value: 0x7f }] },
    { bytes: [0x4f], changes: { pc: 0x0218, c: 0x7f, bc: 0x007f, r: 0x92 } },
    { bytes: [0x21, 0x82, 0], changes: { pc: 0x021b, l: 0x82, hl: 0x0082, r: 0x93 } },
    { bytes: [0x5e], changes: { pc: 0x021c, e: 0x81, de: 0x8281, r: 0x94 }, data: [{ kind: "read", address: 0x82, value: 0x81 }] },
    { bytes: [0x76], changes: { pc: 0x021d, r: 0x95, halted: true } },
  ];
  let state = expectedInitialState();
  return steps.map(({ bytes, changes, data = [] }) => {
    const before = state;
    state = { ...before, ...changes };
    return {
      instruction: { address: before.pc, bytes }, before, after: state,
      accesses: [...bytes.map((value, offset): CpuZ80MemoryAccess => ({ kind: "read", address: before.pc + offset, value })), ...data],
      outcome: state.halted ? "halted" : "executed",
    };
  });
}

test("the Z80 transfer factories provide independent RAM and explicit state without executing", () => {
  const { cpu, ram } = createZ80TransfersExample();
  const memory = createZ80TransfersExampleMemory();
  assert.notStrictEqual(memory, ram);
  assert.deepEqual(cpu.snapshot(), expectedInitialState());
  checkMemory(ram, [0, 0, 0, 0xcc]);
  checkMemory(memory, [0, 0, 0, 0xcc]);
  ram.write(0x80, 0xff);
  assert.equal(memory.read(0x80), 0);
});

test("the Z80 transfer example fills and reads back a buffer with exact records and RAM accesses", (t) => {
  const { cpu, ram } = createZ80TransfersExample();
  const read = t.mock.method(ram, "read");
  const write = t.mock.method(ram, "write");
  const result = runCpu(cpu, { maxSteps: 23 });
  const records = expectedRecords();
  assert.equal(result.stopReason, "halted");
  assert.deepEqual(result.records, records);
  assert.deepEqual(cpu.snapshot(), records.at(-1)!.after);
  const accesses = records.flatMap(record => record.accesses);
  assert.deepEqual(read.mock.calls.map(call => call.arguments), accesses.flatMap(access => access.kind === "read" ? [[access.address]] : []));
  assert.deepEqual(write.mock.calls.map(call => call.arguments), [[0x80, 0x7f], [0x81, 0x80], [0x82, 0x81], [0x83, 0]]);
  const reads = read.mock.callCount();
  const final = cpu.snapshot();
  assert.deepEqual(cpu.step(), { before: final, after: final, instruction: null, accesses: [], outcome: "halted" });
  assert.equal(read.mock.callCount(), reads);
  assert.equal(write.mock.callCount(), 4);
  read.mock.restore();
  write.mock.restore();
  checkMemory(ram, [0x7f, 0x80, 0x81, 0]);
});

test("the Z80 transfer loop resumes from a snapshot and keeps its trace detached through reset and edits", () => {
  const { cpu, ram } = createZ80TransfersExample();
  const first = runCpu(cpu, { maxSteps: 8 });
  const saved = structuredClone(first);
  assert.equal(first.stopReason, "step-limit");
  assert.deepEqual(first.records, expectedRecords().slice(0, 8));
  checkMemory(ram, [0x7f, 0, 0, 0xcc]);
  const resumed = new CpuZ80(ram, cpu.snapshot());
  const rest = runCpu(resumed, { maxSteps: 15 });
  assert.equal(rest.stopReason, "halted");
  assert.deepEqual([...first.records, ...rest.records], expectedRecords());
  const before = resumed.snapshot();
  const reset = resumed.reset();
  assert.deepEqual(reset, {
    before, after: { ...before, pc: 0, i: 0, r: 0, interruptDeferred: false, nmiDeferred: false, iff1: false, iff2: false, im: 0, halted: false }, accesses: [],
  });
  checkMemory(ram, [0x7f, 0x80, 0x81, 0]);
  Reflect.set(rest.records[0]!.before.alternate.flags, "z", false);
  Reflect.set(reset.after, "hl", 0);
  ram.write(0x80, 0);
  assert.deepEqual(first, saved);
  const fresh = createZ80TransfersExample();
  assert.notStrictEqual(fresh.cpu, cpu);
  assert.notStrictEqual(fresh.ram, ram);
  assert.deepEqual(fresh.cpu.snapshot(), expectedInitialState());
  checkMemory(fresh.ram, [0, 0, 0, 0xcc]);
});
