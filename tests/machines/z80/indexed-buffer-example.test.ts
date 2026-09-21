import assert from "node:assert/strict";
import { test } from "node:test";
import { CpuZ80 } from "../../../src/components/cpus/generated/z80-cpu.js";
import type { CpuZ80State, CpuZ80RegisterBank, CpuZ80Snapshot, CpuZ80Flags, CpuZ80MemoryAccess, CpuZ80StepRecord } from "../../../src/components/cpus/generated/z80-cpu.js";
import type { Ram } from "../../../src/components/memory/ram.js";
import { createZ80IndexedBufferExample, createZ80IndexedBufferExampleMemory } from "../../../src/machines/generated/z80/indexed-buffer-example.js";
import { runCpu } from "../../../src/runtime/run-cpu.js";

const program = [0x21, 0xfe, 0, 0x11, 0, 4, 0x01, 4, 0, 0xed, 0xb0, 0xdd, 0x21, 1, 4, 0xfd, 0x21, 4, 4,
  0xdd, 0x7e, 0xff, 0xfd, 0x77, 0xff, 0xdd, 0xcb, 0xff, 0x0e, 0xfd, 0xcb, 0xff, 0xc6, 0x3e, 0x13,
  0x21, 0, 4, 0x01, 4, 0, 0xed, 0xb1, 0xc2, 0x40, 2, 0xed, 0x63, 0, 5, 0xfd, 0xcb, 0, 0xc6, 0x76];
const failure = [0x3e, 0, 0xfd, 0x77, 0, 0x76];
const input = [0x12, 0x34, 0x56, 0x78], output = [9, 0x34, 0x56, 0x13];
const read = (address: number, value: number): CpuZ80MemoryAccess => ({ kind: "read", address, value });
const write = (address: number, value: number): CpuZ80MemoryAccess => ({ kind: "write", address, value });

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
    ix: 0x1234, iy: 0x5678, pc: 0x200, sp: 0x9000, i: 0x42, r: 0xfe, im: 2, interruptDeferred: false, nmiDeferred: false, iff1: true, iff2: false, halted: false });
}
function memoryImage(finished = false, target = 0x13): Uint8Array {
  const bytes = new Uint8Array(65536);
  bytes.set(program, 0x200); bytes.set(failure, 0x240); bytes[0x222] = target;
  bytes.set([0xde, ...input, 0xad], 0xfd);
  bytes.set([0xde, 0xaa, 0xbb, 0xcc, 0xdd, 0x80, 0xad], 0x3ff);
  bytes.set([0xde, 0xaa, 0xbb, 0xad], 0x4ff);
  if (finished) {
    bytes.set(output, 0x400);
    const match = output.indexOf(target);
    bytes[0x404] = match < 0 ? 0 : 0x81;
    if (match >= 0) bytes.set([match + 1, 4], 0x500);
  }
  return bytes;
}
function checkMemory(ram: Ram, finished = false, target = 0x13): void {
  for (const [address, value] of memoryImage(finished, target).entries()) assert.equal(ram.read(address), value, `RAM ${address.toString(16)}`);
}

function expectedRecords(): CpuZ80StepRecord[] {
  const records: CpuZ80StepRecord[] = [];
  let state = initialState();
  const flags = (changes: Partial<CpuZ80Flags> = {}): CpuZ80Flags => ({ s: false, z: false, h: false, pv: false, n: false, c: false, ...changes });
  const append = (bytes: readonly number[], changes: Partial<CpuZ80State> = {}, data: readonly CpuZ80MemoryAccess[] = []) => {
    const before = state;
    const fetches = [0xed, 0xdd, 0xfd].includes(bytes[0]!) ? 2 : 1;
    state = views({ ...state, pc: state.pc + bytes.length, r: 0x80 + (state.r + fetches) % 128, ...changes });
    records.push({ before, after: state, outcome: state.halted ? "halted" : "executed", instruction: { address: before.pc, bytes },
      accesses: [...bytes.map((value, i) => read(before.pc + i, value)), ...data] });
  };
  append([0x21, 0xfe, 0], { h: 0, l: 0xfe });
  append([0x11, 0, 4], { d: 4, e: 0 });
  append([0x01, 4, 0], { b: 0, c: 4 });
  input.forEach((value, i) => append([0xed, 0xb0], { h: Math.floor((0xff + i) / 256), l: (0xff + i) % 256,
    e: i + 1, c: 3 - i, pc: i === 3 ? 0x20b : 0x209, flags: flags({ s: true, pv: i !== 3 }) }, [read(0xfe + i, value), write(0x400 + i, value)]));
  append([0xdd, 0x21, 1, 4], { ix: 0x401 });
  append([0xfd, 0x21, 4, 4], { iy: 0x404 });
  append([0xdd, 0x7e, 0xff], { a: 0x12 }, [read(0x400, 0x12)]);
  append([0xfd, 0x77, 0xff], {}, [write(0x403, 0x12)]);
  append([0xdd, 0xcb, 0xff, 0x0e], { flags: flags({ pv: true }) }, [read(0x400, 0x12), write(0x400, 9)]);
  append([0xfd, 0xcb, 0xff, 0xc6], {}, [read(0x403, 0x12), write(0x403, 0x13)]);
  append([0x3e, 0x13], { a: 0x13 });
  append([0x21, 0, 4], { h: 4, l: 0 });
  append([0x01, 4, 0], { b: 0, c: 4 });
  const comparisons = [flags({ h: true, pv: true, n: true }), flags({ s: true, h: true, pv: true, n: true }),
    flags({ s: true, h: true, pv: true, n: true }), flags({ z: true, n: true })];
  output.forEach((value, i) => append([0xed, 0xb1], { l: i + 1, c: 3 - i, flags: comparisons[i]!, pc: i === 3 ? 0x22b : 0x229 }, [read(0x400 + i, value)]));
  append([0xc2, 0x40, 2]);
  append([0xed, 0x63, 0, 5], {}, [write(0x500, 4), write(0x501, 4)]);
  append([0xfd, 0xcb, 0, 0xc6], {}, [read(0x404, 0x80), write(0x404, 0x81)]);
  append([0x76], { halted: true });
  return records;
}

test("Z80 indexed buffer has 24 exact records, guarded memory, and two visible four-iteration blocks", t => {
  const { cpu, ram } = createZ80IndexedBufferExample();
  assert.deepEqual(cpu.snapshot(), initialState());
  checkMemory(ram);
  const reads = t.mock.method(ram, "read"), writes = t.mock.method(ram, "write");
  const records = expectedRecords();
  assert.equal(records.length, 24);
  assert.deepEqual(runCpu(cpu, { maxSteps: 24 }), { records, stopReason: "halted" });
  const accesses = records.flatMap(record => record.accesses);
  assert.deepEqual(reads.mock.calls.map(call => call.arguments), accesses.flatMap(a => a.kind === "read" ? [[a.address]] : []));
  assert.deepEqual(writes.mock.calls.map(call => call.arguments), accesses.flatMap(a => a.kind === "write" ? [[a.address, a.value]] : []));
  t.mock.restoreAll();
  checkMemory(ram, true);
  assert.equal(cpu.snapshot().r, 0xa6);
  assert.deepEqual(cpu.step(), { before: cpu.snapshot(), after: cpu.snapshot(), accesses: [], instruction: null, outcome: "halted" });
});

test("Z80 indexed buffer finds every buffer position and handles an absent marker", () => {
  for (const target of [...output, 0x99]) {
    const { cpu, ram } = createZ80IndexedBufferExample();
    ram.write(0x222, target);
    const result = runCpu(cpu, { maxSteps: 25 });
    assert.equal(result.stopReason, "halted");
    const match = output.indexOf(target);
    const after = cpu.snapshot();
    assert.equal(after.bc, match < 0 ? 0 : 3 - match);
    assert.equal(after.hl, match < 0 ? 0x404 : 0x401 + match);
    assert.equal(after.flags.z, match >= 0);
    assert.equal(after.flags.pv, match >= 0 && match < 3);
    assert.deepEqual(after.alternate, initialState().alternate);
    checkMemory(ram, true, target);
  }
});

test("Z80 indexed buffer is bounded and resumable at every boundary, including mid-copy and mid-search", () => {
  const records = expectedRecords();
  for (let boundary = 0; boundary <= records.length; boundary++) {
    const { cpu, ram } = createZ80IndexedBufferExample();
    const first = runCpu(cpu, { maxSteps: boundary });
    assert.deepEqual(first.records, records.slice(0, boundary));
    assert.equal(first.stopReason, boundary === records.length ? "halted" : "step-limit");
    const retained = structuredClone(first);
    const resumed = new CpuZ80(ram, cpu.snapshot());
    if (boundary < records.length) assert.deepEqual(runCpu(resumed, { maxSteps: records.length - boundary }), { records: records.slice(boundary), stopReason: "halted" });
    else assert.equal(resumed.step().instruction, null);
    checkMemory(ram, true);
    assert.deepEqual(first, retained);
  }
});

test("Z80 indexed buffer reset preserves changed RAM and data; fresh factories restore the original setup", () => {
  const { cpu, ram } = createZ80IndexedBufferExample();
  runCpu(cpu, { maxSteps: 24 });
  const before = cpu.snapshot();
  assert.deepEqual(cpu.reset(), { before, after: { ...before, pc: 0, i: 0, r: 0, interruptDeferred: false, nmiDeferred: false, iff1: false, iff2: false, im: 0, halted: false }, accesses: [] });
  checkMemory(ram, true);
  const fresh = createZ80IndexedBufferExample();
  assert.notEqual(fresh.cpu, cpu); assert.notEqual(fresh.ram, ram);
  assert.deepEqual(fresh.cpu.snapshot(), initialState());
  checkMemory(fresh.ram);
  const first = createZ80IndexedBufferExampleMemory(), second = createZ80IndexedBufferExampleMemory();
  first.write(0x400, 0);
  checkMemory(second);
});
