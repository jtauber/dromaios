import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu8088 } from "../../../src/components/cpus/8088.js";
import type { Cpu8088Snapshot, Cpu8088StepRecord, Cpu8088MemoryAccess } from "../../../src/components/cpus/8088.js";
import type { Ram } from "../../../src/components/memory/ram.js";
import { create8088TransfersExample, create8088TransfersExampleMemory } from "../../../src/machines/generated/8088/transfers-example.js";
import { runCpu } from "../../../src/runtime/run-cpu.js";

function initialState(): Cpu8088Snapshot {
  return { halted: false, waiting: false, interruptDeferred: false, recognitionDeferred: false, trapPending: false, ax: 0x1122, bx: 0x3344, cx: 0x5566, dx: 0x7788,
    sp: 0x8000, bp: 0x9000, si: 0x10, di: 0x20, cs: 0x1234, ds: 0x2000, ss: 0x3000, es: 0x4000, ip: 0x200,
    al: 0x22, ah: 0x11, bl: 0x44, bh: 0x33, cl: 0x66, ch: 0x55, dl: 0x88, dh: 0x77, pc: 0x12540,
    flags: { cf: true, pf: false, af: true, zf: true, sf: true, tf: false, if: true, df: true, of: true } };
}

function checkMemory(ram: Ram, finished = false): void {
  const expected = new Uint8Array(0x100000);
  // Literal bytes from the specification, independent of generated factories.
  expected.set([0xbb, 0x34, 0x12, 0xb8, 0xff, 0x7f, 4, 1, 0xb4, 0x80, 5, 0xff, 0xff,
    0xa3, 0x81, 0, 0xb0, 0x12, 0xa2, 0x83, 0, 0xb8, 0, 0, 0xa0, 0x83, 0, 0xa1, 0x81, 0, 0xb7, 0xab], 0x12540);
  expected.set(finished ? [0xde, 0xff, 0x7f, 0x12, 0xad] : [0xde, 0x11, 0x22, 0x33, 0xad], 0x20080);
  assert.equal(ram.size, expected.length);
  for (const [address, value] of expected.entries()) assert.equal(ram.read(address), value, `memory at ${address}`);
}

function expectedRecords(): readonly Cpu8088StepRecord[] {
  let before = initialState();
  const loadBx = { ...before, bx: 0x1234, bl: 0x34, bh: 0x12, ip: 0x203, pc: 0x12543 };
  const loadAx = { ...loadBx, ax: 0x7fff, al: 0xff, ah: 0x7f, ip: 0x206, pc: 0x12546 };
  const byteAdd = { ...loadAx, ax: 0x7f00, al: 0, ip: 0x208, pc: 0x12548,
    flags: { cf: true, pf: true, af: true, zf: true, sf: false, tf: false, if: true, df: true, of: false } };
  const highByte = { ...byteAdd, ax: 0x8000, ah: 0x80, ip: 0x20a, pc: 0x1254a };
  const wordAdd = { ...highByte, ax: 0x7fff, al: 0xff, ah: 0x7f, ip: 0x20d, pc: 0x1254d,
    flags: { cf: true, pf: true, af: false, zf: false, sf: false, tf: false, if: true, df: true, of: true } };
  const wordStore = { ...wordAdd, ip: 0x210, pc: 0x12550 };
  const lowByte = { ...wordStore, ax: 0x7f12, al: 0x12, ip: 0x212, pc: 0x12552 };
  const byteStore = { ...lowByte, ip: 0x215, pc: 0x12555 };
  const clearAx = { ...byteStore, ax: 0, al: 0, ah: 0, ip: 0x218, pc: 0x12558 };
  const byteLoad = { ...clearAx, ax: 0x12, al: 0x12, ip: 0x21b, pc: 0x1255b };
  const wordLoad = { ...byteLoad, ax: 0x7fff, al: 0xff, ah: 0x7f, ip: 0x21e, pc: 0x1255e };
  const highBx = { ...wordLoad, bx: 0xab34, bh: 0xab, ip: 0x220, pc: 0x12560 };
  const steps: readonly (readonly [readonly number[], Cpu8088Snapshot, readonly Cpu8088MemoryAccess[]])[] = [
    [[0xbb, 0x34, 0x12], loadBx, []],
    [[0xb8, 0xff, 0x7f], loadAx, []],
    [[4, 1], byteAdd, []],
    [[0xb4, 0x80], highByte, []],
    [[5, 0xff, 0xff], wordAdd, []],
    [[0xa3, 0x81, 0], wordStore, [{ kind: "write", address: 0x20081, value: 0xff }, { kind: "write", address: 0x20082, value: 0x7f }]],
    [[0xb0, 0x12], lowByte, []],
    [[0xa2, 0x83, 0], byteStore, [{ kind: "write", address: 0x20083, value: 0x12 }]],
    [[0xb8, 0, 0], clearAx, []],
    [[0xa0, 0x83, 0], byteLoad, [{ kind: "read", address: 0x20083, value: 0x12 }]],
    [[0xa1, 0x81, 0], wordLoad, [{ kind: "read", address: 0x20081, value: 0xff }, { kind: "read", address: 0x20082, value: 0x7f }]],
    [[0xb7, 0xab], highBx, []],
  ];
  return steps.map(([bytes, after, dataAccesses]) => {
    const record: Cpu8088StepRecord = { before, after, instruction: { address: before.pc, bytes }, outcome: "executed",
      accesses: [...bytes.map((value, offset) => ({ kind: "read" as const, address: before.pc + offset, value })), ...dataAccesses] };
    before = after;
    return record;
  });
}

test("8088 transfer factories own independent images, state, byte views, and physical completion", () => {
  const memory = create8088TransfersExampleMemory();
  const first = create8088TransfersExample();
  const second = create8088TransfersExample();
  for (const ram of [memory, first.ram, second.ram]) checkMemory(ram);
  for (const machine of [first, second]) {
    assert.deepEqual(machine.cpu.snapshot(), initialState());
    assert.equal(machine.endAddress, 0x12560);
  }
  memory.write(0x12540, 0);
  first.ram.write(0x20081, 0);
  first.cpu.step();
  assert.notStrictEqual(first.cpu, second.cpu);
  assert.notStrictEqual(first.ram, second.ram);
  assert.deepEqual(second.cpu.snapshot(), initialState());
  checkMemory(second.ram);
});

test("8088 transfers combine byte ownership, carry and overflow, and memory widths with complete records", t => {
  const { cpu, ram, endAddress } = create8088TransfersExample();
  const read = t.mock.method(ram, "read");
  const write = t.mock.method(ram, "write");
  const records = expectedRecords();
  assert.deepEqual(runCpu(cpu, { maxSteps: 12, endAddress }), { records, stopReason: "completed" });
  const reads = [...Array.from({ length: 27 }, (_, offset) => [0x12540 + offset]), [0x20083],
    [0x1255b], [0x1255c], [0x1255d], [0x20081], [0x20082], [0x1255e], [0x1255f]];
  assert.deepEqual(read.mock.calls.map(call => call.arguments), reads);
  assert.deepEqual(write.mock.calls.map(call => call.arguments), [[0x20081, 0xff], [0x20082, 0x7f], [0x20083, 0x12]]);
  assert.deepEqual(cpu.snapshot(), records[11]!.after);
  assert.deepEqual(runCpu(cpu, { maxSteps: 0, endAddress }), { records: [], stopReason: "completed" });
  assert.deepEqual(runCpu(cpu, { maxSteps: 0, endAddress: 0x220 }), { records: [], stopReason: "step-limit" });
  const alias = new Cpu8088(ram, { ...cpu.snapshot(), cs: 0x1244, ip: 0x120 });
  assert.deepEqual(runCpu(alias, { maxSteps: 0, endAddress }), { records: [], stopReason: "completed" });
  assert.equal(read.mock.callCount(), 35);
  t.mock.restoreAll();
  checkMemory(ram, true);
  // Without an endpoint, zero-filled RAM executes ADD and the step budget stops the run.
  assert.equal(runCpu(cpu, { maxSteps: 1 }).stopReason, "step-limit");
});

test("8088 transfers pause after byte carry, restore snapshots, and retain detached records", () => {
  const { cpu, ram, endAddress } = create8088TransfersExample();
  const expected = expectedRecords();
  const first = runCpu(cpu, { maxSteps: 3, endAddress });
  const saved = structuredClone(first);
  assert.deepEqual(first, { records: expected.slice(0, 3), stopReason: "step-limit" });
  const restored = new Cpu8088(ram, cpu.snapshot());
  assert.deepEqual(runCpu(cpu, { maxSteps: 9, endAddress }), { records: expected.slice(3), stopReason: "completed" });
  assert.deepEqual(runCpu(restored, { maxSteps: 9, endAddress }), { records: expected.slice(3), stopReason: "completed" });
  assert.deepEqual(first, saved);
  const live = cpu.snapshot();
  Reflect.set(first.records[0]!.after, "bh", 0);
  Reflect.set(first.records[0]!.after.flags, "cf", false);
  assert.deepEqual(first.records[1]!.before, saved.records[1]!.before);
  assert.deepEqual(cpu.snapshot(), live);
});

test("8088 transfer reset preserves results without reading RAM; restart restores the original example", t => {
  const { cpu, ram, endAddress } = create8088TransfersExample();
  const records = runCpu(cpu, { maxSteps: 12, endAddress }).records;
  const saved = structuredClone(records);
  const before = expectedRecords()[11]!.after;
  const after = { ...before, cs: 0xffff, ds: 0, ss: 0, es: 0, ip: 0, pc: 0xffff0,
    flags: { cf: false, pf: false, af: false, zf: false, sf: false, tf: false, if: false, df: false, of: false } };
  const read = t.mock.method(ram, "read");
  const write = t.mock.method(ram, "write");
  const reset = cpu.reset();
  assert.deepEqual(reset, { before, after, accesses: [] });
  assert.equal(read.mock.callCount(), 0);
  assert.equal(write.mock.callCount(), 0);
  t.mock.restoreAll();
  checkMemory(ram, true);
  ram.write(0xffff0, 0x0f); // Deliberately test rejection instead of relying on zero-filled RAM.
  assert.equal(cpu.step().outcome, "unsupported");
  assert.deepEqual(reset.after, after);
  assert.deepEqual(records, saved);
  const fresh = create8088TransfersExample();
  assert.deepEqual(fresh.cpu.snapshot(), initialState());
  checkMemory(fresh.ram);
});
