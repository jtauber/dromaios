import assert from "node:assert/strict";
import { test } from "node:test";
import { CpuZ80 } from "../../../src/components/cpus/z80.js";
import type { CpuZ80State, CpuZ80RegisterBank, CpuZ80Snapshot, CpuZ80Flags, CpuZ80MemoryAccess, CpuZ80StepRecord } from "../../../src/components/cpus/z80.js";
import type { Ram } from "../../../src/components/memory/ram.js";
import { createZ80DecimalTotalExample, createZ80DecimalTotalExampleMemory } from "../../../src/machines/generated/z80/decimal-total-example.js";
import { runCpu } from "../../../src/runtime/run-cpu.js";

const main = [0xcd, 0x20, 2, 0x76];
const routine = [0x08, 0xd9, 0x21, 0, 1, 0x01, 2, 0, 0x11, 0, 4, 0x3e, 0, 0xef, 0x15, 0x09,
  0xc2, 0x2d, 2, 0x32, 0, 4, 0x7b, 0x32, 1, 4, 0xd9, 0x08, 0xc9];
const accumulate = [0x86, 0x27, 0xd0, 0x1c, 0xc9];
const amounts = [0x45, 0x67, 0x89, 0x72];

function bankViews(bank: CpuZ80RegisterBank) {
  return { ...bank, flags: { ...bank.flags }, bc: bank.b * 256 + bank.c, de: bank.d * 256 + bank.e, hl: bank.h * 256 + bank.l };
}
function views(state: CpuZ80State): CpuZ80Snapshot {
  return { ...state, ...bankViews(state), alternate: bankViews(state.alternate) };
}
function initialState(): CpuZ80Snapshot {
  return views({ a: 0x11, b: 0x22, c: 0x33, d: 0x44, e: 0x55, h: 0x66, l: 0x77,
    flags: { s: true, z: false, h: true, pv: false, n: true, c: false },
    alternate: { a: 0x88, b: 0x99, c: 0xaa, d: 0xbb, e: 0xcc, h: 0xdd, l: 0xee,
      flags: { s: false, z: true, h: false, pv: true, n: false, c: true } },
    ix: 0x1234, iy: 0x5678, pc: 0x200, sp: 0x9000, i: 0x42, r: 0xfe, im: 2, iff1: true, iff2: false, halted: false });
}
function checkMemory(ram: Ram, finished = false, input: readonly number[] = amounts): void {
  const expected = new Uint8Array(65536);
  expected.set(main, 0x200); expected.set(routine, 0x220); expected.set(accumulate, 0x28);
  expected.set([0xde, 0x45, 0xaa, 0x67, 0xbb, 0x89, 0xcc, 0x72, 0xdd, 0xad], 0xff);
  input.forEach((value, i) => { expected[0x100 + i * 2] = value; });
  expected.set([0xde, 0xaa, 0xbb, 0xad], 0x3ff);
  expected[0x8ffb] = 0xde; expected[0x9000] = 0xad;
  if (finished) {
    const total = input.reduce((sum, byte) => sum + Math.floor(byte / 16) * 10 + byte % 16, 0);
    expected[0x400] = Math.floor(total % 100 / 10) * 16 + total % 10;
    expected[0x401] = Math.floor(total / 100);
    expected.set([0x2e, 2, 3, 2], 0x8ffc);
  }
  for (const [address, value] of expected.entries()) assert.equal(ram.read(address), value, `RAM ${address.toString(16)}`);
}

function expectedRecords(): CpuZ80StepRecord[] {
  const records: CpuZ80StepRecord[] = [];
  let state = initialState();
  const flags = (changes: Partial<CpuZ80Flags> = {}): CpuZ80Flags => ({ s: false, z: false, h: false, pv: false, n: false, c: false, ...changes });
  const read = (address: number, value: number): CpuZ80MemoryAccess => ({ kind: "read", address, value });
  const write = (address: number, value: number): CpuZ80MemoryAccess => ({ kind: "write", address, value });
  const append = (bytes: readonly number[], changes: Partial<CpuZ80State> = {}, data: readonly CpuZ80MemoryAccess[] = []) => {
    const before = state;
    state = views({ ...state, pc: state.pc + bytes.length, r: 0x80 + (state.r + 1) % 128, ...changes });
    records.push({ before, after: state, outcome: state.halted ? "halted" : "executed", instruction: { address: before.pc, bytes },
      accesses: [...bytes.map((value, i) => read(before.pc + i, value)), ...data] });
  };
  append([0xcd, 0x20, 2], { pc: 0x220, sp: 0x8ffe }, [write(0x8fff, 2), write(0x8ffe, 3)]);
  const caller = initialState();
  append([0x08], { a: caller.alternate.a, flags: caller.alternate.flags,
    alternate: { ...caller.alternate, a: caller.a, flags: caller.flags } });
  append([0xd9], { b: 0x99, c: 0xaa, d: 0xbb, e: 0xcc, h: 0xdd, l: 0xee,
    alternate: { a: caller.a, flags: caller.flags, b: caller.b, c: caller.c, d: caller.d, e: caller.e, h: caller.h, l: caller.l } });
  append([0x21, 0, 1], { h: 1, l: 0 });
  append([0x01, 2, 0], { b: 0, c: 2 });
  append([0x11, 0, 4], { d: 4, e: 0 });
  append([0x3e, 0], { a: 0 });
  // Independently listed binary sums, decimal corrections, and carries: 45,112,201,273.
  const rows = [
    { input: 0x45, binary: 0x45, adjusted: 0x45, hundreds: 0, binaryFlags: flags(), decimalFlags: flags() },
    { input: 0x67, binary: 0xac, adjusted: 0x12, hundreds: 1, binaryFlags: flags({ s: true, pv: true }), decimalFlags: flags({ h: true, pv: true, c: true }) },
    { input: 0x89, binary: 0x9b, adjusted: 0x01, hundreds: 2, binaryFlags: flags({ s: true }), decimalFlags: flags({ h: true, c: true }) },
    { input: 0x72, binary: 0x73, adjusted: 0x73, hundreds: 2, binaryFlags: flags(), decimalFlags: flags() },
  ];
  for (const [i, row] of rows.entries()) {
    append([0xef], { pc: 0x28, sp: 0x8ffc }, [write(0x8ffd, 2), write(0x8ffc, 0x2e)]);
    append([0x86], { a: row.binary, flags: row.binaryFlags }, [read(0x100 + i * 2, row.input)]);
    append([0x27], { a: row.adjusted, flags: row.decimalFlags });
    if (row.decimalFlags.c) {
      append([0xd0]);
      append([0x1c], { e: row.hundreds, flags: flags({ c: true }) });
      append([0xc9], { pc: 0x22e, sp: 0x8ffe }, [read(0x8ffc, 0x2e), read(0x8ffd, 2)]);
    } else append([0xd0], { pc: 0x22e, sp: 0x8ffe }, [read(0x8ffc, 0x2e), read(0x8ffd, 2)]);
    append([0x15], { d: 3 - i, flags: flags({ n: true, z: i === 3, c: row.decimalFlags.c }) });
    append([0x09], { l: (i + 1) * 2, flags: flags({ z: i === 3 }) });
    append([0xc2, 0x2d, 2], { pc: i === 3 ? 0x233 : 0x22d });
  }
  append([0x32, 0, 4], {}, [write(0x400, 0x73)]);
  append([0x7b], { a: 2 });
  append([0x32, 1, 4], {}, [write(0x401, 2)]);
  append([0xd9], { b: caller.b, c: caller.c, d: caller.d, e: caller.e, h: caller.h, l: caller.l,
    alternate: { ...state.alternate, b: 0, c: 2, d: 0, e: 2, h: 1, l: 8 } });
  append([0x08], { a: caller.a, flags: caller.flags, alternate: { ...state.alternate, a: 2, flags: flags({ z: true }) } });
  append([0xc9], { pc: 0x203, sp: 0x9000 }, [read(0x8ffe, 3), read(0x8fff, 2)]);
  append([0x76], { halted: true });
  return records;
}

test("Z80 decimal total has 46 exact records, both carry paths, preserved caller state, and guarded memory", t => {
  const { cpu, ram } = createZ80DecimalTotalExample();
  assert.deepEqual(cpu.snapshot(), initialState());
  checkMemory(ram);
  const reads = t.mock.method(ram, "read"), writes = t.mock.method(ram, "write");
  const records = expectedRecords();
  assert.equal(records.length, 46);
  assert.deepEqual(runCpu(cpu, { maxSteps: 46 }), { records, stopReason: "halted" });
  const accesses = records.flatMap(record => record.accesses);
  assert.deepEqual(reads.mock.calls.map(call => call.arguments), accesses.filter(a => a.kind === "read").map(a => [a.address]));
  assert.deepEqual(writes.mock.calls.map(call => call.arguments), accesses.filter(a => a.kind === "write").map(a => [a.address, a.value]));
  t.mock.restoreAll();
  checkMemory(ram, true);
  assert.equal(cpu.snapshot().r, 0xac);
  assert.deepEqual(cpu.step(), { before: cpu.snapshot(), after: cpu.snapshot(), accesses: [], instruction: null, outcome: "halted" });
});

test("Z80 decimal total handles zero through 396, preserving tags and the caller's main bank", () => {
  for (const input of [[0, 0, 0, 0], [1, 2, 3, 4], [0x99, 1, 0, 0], [0x99, 0x99, 0x99, 0x99]]) {
    const { cpu, ram } = createZ80DecimalTotalExample();
    input.forEach((value, i) => ram.write(0x100 + i * 2, value));
    const result = runCpu(cpu, { maxSteps: 50 });
    const total = input.reduce((sum, byte) => sum + Math.floor(byte / 16) * 10 + byte % 16, 0);
    assert.equal(result.stopReason, "halted");
    assert.equal(result.records.length, 42 + 2 * Math.floor(total / 100));
    const after = cpu.snapshot(), before = initialState();
    assert.deepEqual(bankViews(after), bankViews({ ...after, a: before.a, b: before.b, c: before.c, d: before.d, e: before.e,
      h: before.h, l: before.l, flags: before.flags }));
    assert.equal(after.sp, 0x9000);
    checkMemory(ram, true, input);
  }
});

test("Z80 decimal total resumes at every boundary with alternate banks and nested return addresses intact", () => {
  const records = expectedRecords();
  for (let boundary = 0; boundary <= records.length; boundary++) {
    const { cpu, ram } = createZ80DecimalTotalExample();
    const first = runCpu(cpu, { maxSteps: boundary });
    const saved = structuredClone(first);
    assert.deepEqual(first.records, records.slice(0, boundary));
    if (boundary < records.length) {
      const restored = new CpuZ80(ram, cpu.snapshot());
      assert.deepEqual(runCpu(restored, { maxSteps: records.length - boundary }), { records: records.slice(boundary), stopReason: "halted" });
    }
    checkMemory(ram, true);
    assert.deepEqual(first, saved);
  }
});

test("Z80 decimal total observes edited inputs, bounds loops, resets without clearing output, and creates fresh instances", () => {
  const changed = createZ80DecimalTotalExample();
  runCpu(changed.cpu, { maxSteps: 7 });
  changed.ram.write(0x100, 0);
  assert.equal(runCpu(changed.cpu, { maxSteps: 50 }).stopReason, "halted");
  checkMemory(changed.ram, true, [0, 0x67, 0x89, 0x72]);
  const before = changed.cpu.snapshot();
  const after = views({ ...before, pc: 0, i: 0, r: 0, iff1: false, iff2: false, im: 0, halted: false });
  assert.deepEqual(changed.cpu.reset(), { before, after, accesses: [] });
  checkMemory(changed.ram, true, [0, 0x67, 0x89, 0x72]);
  const fresh = createZ80DecimalTotalExample();
  assert.deepEqual(fresh.cpu.snapshot(), initialState());
  checkMemory(fresh.ram);
  checkMemory(createZ80DecimalTotalExampleMemory());
  const loop = createZ80DecimalTotalExample();
  loop.ram.write(0x230, 0xc3); // JP NZ becomes unconditional JP; the runner still enforces its budget.
  const run = runCpu(loop.cpu, { maxSteps: 100 });
  assert.equal(run.stopReason, "step-limit");
  assert.equal(run.records.length, 100);
});
