import assert from "node:assert/strict";
import { test } from "node:test";
import type { CpuZ80MemoryAccess, CpuZ80Snapshot, CpuZ80StepRecord } from "../../../src/components/cpus/z80.js";
import type { Ram } from "../../../src/components/memory/ram.js";
import {
  createZ80CountedLoopExample,
  createZ80CountedLoopExampleMemory,
} from "../../../src/machines/generated/z80/counted-loop-example.js";
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

function checkMemory(ram: Ram, result: number, count = 3): void {
  const expected = new Uint8Array(0x10000);
  // Literal image from the specification, independent of the generated factory.
  expected.set([0x06, count, 0x3e, 0, 0xc6, 5, 0x10, 0xfc, 0x32, 0x80, 0, 0x76], 0x0200);
  expected[0x80] = result;
  assert.equal(ram.size, expected.length);
  for (const [address, byte] of expected.entries()) assert.equal(ram.read(address), byte, `memory at ${address}`);
}

function expectedRecords(): readonly CpuZ80StepRecord[] {
  const steps: readonly {
    bytes: readonly number[]; changes: Partial<CpuZ80Snapshot>; data?: readonly CpuZ80MemoryAccess[];
  }[] = [
    { bytes: [0x06, 3], changes: { pc: 0x0202, b: 3, bc: 0x0333, r: 0xff } },
    { bytes: [0x3e, 0], changes: { pc: 0x0204, a: 0, r: 0x80 } },
    { bytes: [0xc6, 5], changes: { pc: 0x0206, a: 5, r: 0x81,
      flags: { s: false, z: false, h: false, pv: false, n: false, c: false } } },
    { bytes: [0x10, 0xfc], changes: { pc: 0x0204, b: 2, bc: 0x0233, r: 0x82 } },
    { bytes: [0xc6, 5], changes: { pc: 0x0206, a: 0x0a, r: 0x83 } },
    { bytes: [0x10, 0xfc], changes: { pc: 0x0204, b: 1, bc: 0x0133, r: 0x84 } },
    { bytes: [0xc6, 5], changes: { pc: 0x0206, a: 0x0f, r: 0x85 } },
    { bytes: [0x10, 0xfc], changes: { pc: 0x0208, b: 0, bc: 0x0033, r: 0x86 } },
    { bytes: [0x32, 0x80, 0], changes: { pc: 0x020b, r: 0x87 },
      data: [{ kind: "write", address: 0x0080, value: 0x0f }] },
    { bytes: [0x76], changes: { pc: 0x020c, r: 0x88, halted: true } },
  ];
  let state = expectedInitialState();
  return steps.map(({ bytes, changes, data = [] }) => {
    const before = state;
    state = { ...before, ...changes };
    return {
      instruction: { address: before.pc, bytes }, before, after: state,
      accesses: [...bytes.map((value, offset): CpuZ80MemoryAccess => ({
        kind: "read", address: before.pc + offset, value,
      })), ...data],
      outcome: state.halted ? "halted" : "executed",
    };
  });
}

test("the Z80 counted-loop factories create independent banks and complete memory images", () => {
  const memory = createZ80CountedLoopExampleMemory();
  checkMemory(memory, 0);
  memory.write(0x0200, 0);
  memory.write(0x80, 0xff);
  const second = createZ80CountedLoopExampleMemory();
  assert.notStrictEqual(second, memory);
  checkMemory(second, 0);
  const first = createZ80CountedLoopExample();
  assert.deepEqual(first.cpu.snapshot(), expectedInitialState());
  assert.equal(Object.hasOwn(first, "endAddress"), false);
  checkMemory(first.ram, 0);
  first.cpu.step();
  first.ram.write(0x80, 0xff);
  const fresh = createZ80CountedLoopExample();
  assert.notStrictEqual(fresh.cpu, first.cpu);
  assert.notStrictEqual(fresh.ram, first.ram);
  assert.deepEqual(fresh.cpu.snapshot(), expectedInitialState());
  checkMemory(fresh.ram, 0);
});

test("the Z80 counted loop adds five three times, preserves DJNZ flags, stores fifteen, and halts with exact records", (t) => {
  const { cpu, ram } = createZ80CountedLoopExample();
  const read = t.mock.method(ram, "read");
  const write = t.mock.method(ram, "write");
  const expected = expectedRecords();
  const result = runCpu(cpu, { maxSteps: 10 });
  assert.deepEqual(result, { records: expected, stopReason: "halted" });
  const accesses = expected.flatMap(record => record.accesses);
  assert.deepEqual(read.mock.calls.map(call => call.arguments),
    accesses.flatMap(access => access.kind === "read" ? [[access.address]] : []));
  assert.deepEqual(write.mock.calls.map(call => call.arguments), [[0x0080, 0x0f]]);
  const final = {
    ...expectedInitialState(), a: 0x0f, b: 0, bc: 0x0033, pc: 0x020c, r: 0x88, halted: true,
    flags: { s: false, z: false, h: false, pv: false, n: false, c: false },
  };
  assert.deepEqual(cpu.snapshot(), final);
  const readCount = read.mock.callCount();
  assert.deepEqual(cpu.step(), { before: final, after: final, instruction: null, accesses: [], outcome: "halted" });
  assert.equal(read.mock.callCount(), readCount);
  assert.equal(write.mock.callCount(), 1);
  read.mock.restore();
  write.mock.restore();
  checkMemory(ram, 0x0f);
});

test("the Z80 counted loop resumes before DJNZ, resets to zero while preserving data, and restarts at its entry point", () => {
  const { cpu, ram } = createZ80CountedLoopExample();
  const first = runCpu(cpu, { maxSteps: 3 });
  const saved = structuredClone(first);
  assert.equal(first.stopReason, "step-limit");
  assert.deepEqual(cpu.snapshot(), {
    ...expectedInitialState(), a: 5, b: 3, bc: 0x0333, pc: 0x0206, r: 0x81,
    flags: { s: false, z: false, h: false, pv: false, n: false, c: false },
  });
  checkMemory(ram, 0);
  const rest = runCpu(cpu, { maxSteps: 7 });
  assert.equal(rest.stopReason, "halted");
  assert.deepEqual([...first.records, ...rest.records], expectedRecords());
  const before = cpu.snapshot();
  const afterReset = { ...before, pc: 0, i: 0, r: 0, interruptDeferred: false, nmiDeferred: false, iff1: false, iff2: false, im: 0, halted: false };
  assert.deepEqual(cpu.reset(), { before, after: afterReset, accesses: [] });
  checkMemory(ram, 0x0f);
  assert.deepEqual(cpu.step(), {
    before: afterReset, after: { ...afterReset, pc: 1, r: 1 }, instruction: { address: 0, bytes: [0] },
    accesses: [{ kind: "read", address: 0, value: 0 }], outcome: "executed",
  });
  const fresh = createZ80CountedLoopExample();
  assert.notStrictEqual(fresh.cpu, cpu);
  assert.notStrictEqual(fresh.ram, ram);
  assert.deepEqual(fresh.cpu.snapshot(), expectedInitialState());
  checkMemory(fresh.ram, 0);
  fresh.cpu.step();
  ram.write(0x0207, 0);
  assert.deepEqual(first, saved);
});

test("a zero initial Z80 loop count wraps B and runs 256 iterations under bounded budgets", (t) => {
  const { cpu, ram } = createZ80CountedLoopExample();
  ram.write(0x0201, 0);
  const first = runCpu(cpu, { maxSteps: 10 });
  const saved = structuredClone(first);
  assert.equal(first.stopReason, "step-limit");
  assert.equal(first.records.length, 10);
  assert.deepEqual(cpu.snapshot(), {
    ...expectedInitialState(), a: 0x14, b: 0xfc, bc: 0xfc33, pc: 0x0204, r: 0x88,
    flags: { s: false, z: false, h: true, pv: false, n: false, c: false },
  });
  checkMemory(ram, 0, 0);
  const write = t.mock.method(ram, "write");
  const rest = runCpu(cpu, { maxSteps: 506 });
  assert.equal(rest.stopReason, "halted");
  assert.equal(rest.records.length, 506);
  assert.deepEqual(cpu.snapshot(), {
    ...expectedInitialState(), a: 0, b: 0, bc: 0x0033, pc: 0x020c, r: 0x82, halted: true,
    flags: { s: false, z: true, h: true, pv: false, n: false, c: true },
  });
  assert.deepEqual(write.mock.calls.map(call => call.arguments), [[0x80, 0]]);
  write.mock.restore();
  checkMemory(ram, 0, 0);
  assert.deepEqual(first, saved);
});
