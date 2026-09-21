import assert from "node:assert/strict";
import { test } from "node:test";
import { CpuZ80 } from "../../../src/components/cpus/generated/z80-cpu.js";
import type { CpuZ80MemoryAccess, CpuZ80Snapshot, CpuZ80StepRecord } from "../../../src/components/cpus/generated/z80-cpu.js";
import type { Ram } from "../../../src/components/memory/ram.js";
import { createZ80ChecksumExample, createZ80ChecksumExampleMemory } from "../../../src/machines/generated/z80/checksum-example.js";
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

function checkMemory(ram: Ram, finished: boolean): void {
  const expected = new Uint8Array(0x10000);
  expected.set([0xaa, 0xff, 2, 0xff, 0xbb, ...(finished ? [0, 2] : [0xcc, 0xcc]), 0x55], 0x7f);
  expected.set([0x21, 0x80, 0, 0x06, 3, 0x16, 0, 0xaf, 0x86, 0x5f, 0x7a, 0xce, 0, 0x57, 0x7b,
    0x2c, 0x10, 0xf6, 0x21, 0x84, 0, 0x77, 0x2c, 0x72, 0xfe, 0, 0x20, 8, 0x7a, 0xfe, 2, 0x20, 3, 0x76], 0x0200);
  expected.set([0x18, 0xfe], 0x0224);
  assert.equal(ram.size, expected.length);
  expected.forEach((value, address) => assert.equal(ram.read(address), value, `RAM ${address}`));
}

function expectedRecords(): readonly CpuZ80StepRecord[] {
  const records: CpuZ80StepRecord[] = [];
  let state = expectedInitialState();
  const clearFlags = { s: false, z: false, h: false, pv: false, n: false, c: false };
  const append = (bytes: readonly number[], changes: Partial<CpuZ80Snapshot> = {}, data: readonly CpuZ80MemoryAccess[] = []) => {
    const before = state;
    state = { ...before, pc: before.pc + bytes.length, r: 0x80 + (before.r - 0x80 + 1) % 128, ...changes };
    records.push({ before, after: state, instruction: { address: before.pc, bytes },
      accesses: [...bytes.map((value, offset): CpuZ80MemoryAccess => ({ kind: "read", address: before.pc + offset, value })), ...data],
      outcome: state.halted ? "halted" : "executed" });
  };
  append([0x21, 0x80, 0], { h: 0, l: 0x80, hl: 0x80 });
  append([0x06, 3], { b: 3, bc: 0x0333 });
  append([0x16, 0], { d: 0, de: 0x0055 });
  append([0xaf], { a: 0, flags: { ...clearFlags, z: true, pv: true } });
  // Independently calculated partial sums: 00FF, 0101, 0200.
  for (const [address, input, low, high, carry, half, remaining] of [
    [0x80, 0xff, 0xff, 0, false, false, 2],
    [0x81, 2, 1, 1, true, true, 1],
    [0x82, 0xff, 0, 2, true, true, 0],
  ] as const) {
    append([0x86], { a: low, flags: { ...clearFlags, s: low >= 128, z: low === 0, h: half, c: carry } },
      [{ kind: "read", address, value: input }]);
    append([0x5f], { e: low, de: state.d * 256 + low });
    append([0x7a], { a: state.d });
    append([0xce, 0], { a: high, flags: { ...clearFlags, z: high === 0 } });
    append([0x57], { d: high, de: high * 256 + low });
    append([0x7b], { a: low });
    append([0x2c], { l: address + 1, hl: address + 1, flags: { ...clearFlags, s: true } });
    append([0x10, 0xf6], { b: remaining, bc: remaining * 256 + 0x33, pc: remaining ? 0x0208 : 0x0212 });
  }
  append([0x21, 0x84, 0], { l: 0x84, hl: 0x84 });
  append([0x77], {}, [{ kind: "write", address: 0x84, value: 0 }]);
  append([0x2c], { l: 0x85, hl: 0x85 });
  append([0x72], {}, [{ kind: "write", address: 0x85, value: 2 }]);
  append([0xfe, 0], { flags: { ...clearFlags, z: true, n: true } });
  append([0x20, 8]);
  append([0x7a], { a: 2 });
  append([0xfe, 2]);
  append([0x20, 3]);
  append([0x76], { halted: true });
  return records;
}

test("Z80 checksum factories provide fresh components and the complete initial image", () => {
  const first = createZ80ChecksumExample();
  assert.deepEqual(first.cpu.snapshot(), expectedInitialState());
  checkMemory(first.ram, false);
  runCpu(first.cpu, { maxSteps: 38 });
  const fresh = createZ80ChecksumExample();
  assert.notStrictEqual(fresh.cpu, first.cpu);
  assert.notStrictEqual(fresh.ram, first.ram);
  assert.deepEqual(fresh.cpu.snapshot(), expectedInitialState());
  checkMemory(fresh.ram, false);
  const memory = createZ80ChecksumExampleMemory();
  memory.write(0x80, 0);
  checkMemory(createZ80ChecksumExampleMemory(), false);
});

test("Z80 checksum passes carry between bytes, compares the result, and halts with complete records", t => {
  const { cpu, ram } = createZ80ChecksumExample();
  const accesses: CpuZ80MemoryAccess[] = [];
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
  const records = expectedRecords();
  assert.equal(records.length, 38);
  assert.deepEqual(runCpu(cpu, { maxSteps: 38 }), { records, stopReason: "halted" });
  assert.deepEqual(accesses, records.flatMap(record => record.accesses));
  const final = cpu.snapshot();
  assert.deepEqual(cpu.step(), { before: final, after: final, instruction: null, accesses: [], outcome: "halted" });
  assert.deepEqual(accesses, records.flatMap(record => record.accesses));
  t.mock.restoreAll();
  checkMemory(ram, true);
  assert.equal(final.pc, 0x0222);
  assert.equal(final.r, 0xa4);
});

test("Z80 checksum resumes from snapshots across carry propagation, comparisons, and HALT", () => {
  for (const pauseAfter of [4, 5, 7, 13, 15, 21, 23, 28, 33, 36, 37]) {
    const { cpu, ram } = createZ80ChecksumExample();
    const first = runCpu(cpu, { maxSteps: pauseAfter });
    const saved = structuredClone(first);
    assert.equal(first.stopReason, "step-limit");
    const resumed = new CpuZ80(ram, cpu.snapshot());
    const rest = runCpu(resumed, { maxSteps: 38 - pauseAfter });
    assert.equal(rest.stopReason, "halted");
    assert.deepEqual([...first.records, ...rest.records], expectedRecords());
    checkMemory(ram, true);
    const before = resumed.snapshot();
    assert.deepEqual(resumed.reset(), { before,
      after: { ...before, pc: 0, i: 0, r: 0, interruptDeferred: false, nmiDeferred: false, iff1: false, iff2: false, im: 0, halted: false }, accesses: [] });
    checkMemory(ram, true);
    ram.write(0x84, 0xff);
    assert.deepEqual(first, saved);
  }
});

test("Z80 checksum takes either comparison's failure branch and runs only to its instruction budget", () => {
  for (const [address, value, steps, low, high] of [[0x82, 0xfe, 34, 0xff, 1], [0x021e, 3, 37, 0, 2]] as const) {
    const { cpu, ram } = createZ80ChecksumExample();
    ram.write(address, value);
    const first = runCpu(cpu, { maxSteps: steps });
    const saved = structuredClone(first);
    assert.equal(first.stopReason, "step-limit");
    assert.equal(first.records.length, steps);
    assert.equal(cpu.snapshot().pc, 0x0224);
    assert.equal(cpu.snapshot().flags.z, false);
    assert.equal(cpu.snapshot().halted, false);
    assert.equal(ram.read(0x84), low);
    assert.equal(ram.read(0x85), high);
    const loop = runCpu(cpu, { maxSteps: 3 });
    assert.equal(loop.stopReason, "step-limit");
    assert.deepEqual(loop.records.map(record => record.instruction), Array.from({ length: 3 }, () => ({ address: 0x0224, bytes: [0x18, 0xfe] })));
    assert.deepEqual(first, saved);
  }
});
