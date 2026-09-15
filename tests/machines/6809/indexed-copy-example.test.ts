import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu6809 } from "../../../src/components/cpus/6809.js";
import type { Cpu6809Snapshot, Cpu6809MemoryAccess, Cpu6809StepRecord } from "../../../src/components/cpus/6809.js";
import { Ram } from "../../../src/components/memory/ram.js";
import { create6809IndexedCopyExample, create6809IndexedCopyExampleMemory } from "../../../src/machines/generated/6809/indexed-copy-example.js";
import { runCpu } from "../../../src/runtime/run-cpu.js";

function initialState(): Cpu6809Snapshot {
  return { a: 0x11, b: 0x34, d: 0x1134, dp: 0x20, x: 0x2345, y: 0x4567, s: 0x8000, u: 0x5000, pc: 0x200,
    flags: { e: true, f: false, h: true, i: false, n: true, z: true, v: true, c: true } };
}

function expectedMemory(finished = false): Uint8Array {
  const image = new Uint8Array(0x10000);
  image.set([0xbe, 0x20, 0x10, 0xce, 0x40, 0, 0xec, 0x81, 0xed, 0xc1, 0x26, 0xfa, 0x9f, 0x10, 0xdf, 0x12], 0x200);
  image.set([0x30, 0, 0, 0], 0x2010);
  image.set([0xde, 0xad, 0x12, 0x34, 0x80, 0, 0xff, 0xff, 0, 0, 0xbe, 0xef], 0x2ffe);
  image.set([0xde, 0xad, 0xcc, 0xcc, 0xcc, 0xcc, 0xcc, 0xcc, 0xcc, 0xcc, 0xbe, 0xef], 0x3ffe);
  image.set([2, 0], 0xfffe);
  if (finished) {
    image.set([0x12, 0x34, 0x80, 0, 0xff, 0xff, 0, 0], 0x4000);
    image.set([0x30, 8, 0x40, 8], 0x2010);
  }
  return image;
}

function checkMemory(ram: Ram, expected: Uint8Array): void {
  assert.equal(ram.size, expected.length);
  for (const [address, value] of expected.entries()) assert.equal(ram.read(address), value, `RAM at ${address}`);
}

function expectedRecords(): Cpu6809StepRecord[] {
  const records: Cpu6809StepRecord[] = [];
  let state = initialState();
  const read = (address: number, value: number): Cpu6809MemoryAccess => ({ kind: "read", address, value });
  const write = (address: number, value: number): Cpu6809MemoryAccess => ({ kind: "write", address, value });
  const nz = (n: boolean, z: boolean) => ({ ...state.flags, n, z, v: false });
  const step = (bytes: number[], changes: Partial<Cpu6809Snapshot>, data: Cpu6809MemoryAccess[] = []) => {
    const before = state;
    state = { ...before, pc: before.pc + bytes.length, ...changes };
    records.push({ before, after: state, instruction: { address: before.pc, bytes }, outcome: "executed",
      accesses: [...bytes.map((value, offset) => read(before.pc + offset, value)), ...data] });
  };
  step([0xbe, 0x20, 0x10], { x: 0x3000, flags: nz(false, false) }, [read(0x2010, 0x30), read(0x2011, 0)]);
  step([0xce, 0x40, 0], { u: 0x4000, flags: nz(false, false) });
  for (const [offset, high, low, d, n, z] of [
    [0, 0x12, 0x34, 0x1234, false, false], [2, 0x80, 0, 0x8000, true, false],
    [4, 0xff, 0xff, 0xffff, true, false], [6, 0, 0, 0, false, true],
  ] as const) {
    step([0xec, 0x81], { a: high, b: low, d, x: 0x3002 + offset, flags: nz(n, z) },
      [read(0x3000 + offset, high), read(0x3001 + offset, low)]);
    step([0xed, 0xc1], { u: 0x4002 + offset }, [write(0x4000 + offset, high), write(0x4001 + offset, low)]);
    step([0x26, 0xfa], { pc: z ? 0x20c : 0x206 });
  }
  step([0x9f, 0x10], { flags: nz(false, false) }, [write(0x2010, 0x30), write(0x2011, 8)]);
  step([0xdf, 0x12], {}, [write(0x2012, 0x40), write(0x2013, 8)]);
  return records;
}

test("6809 indexed copy transfers three words and the sentinel with sixteen exact records and real accesses", t => {
  const { cpu, ram, endAddress } = create6809IndexedCopyExample();
  assert.deepEqual(cpu.snapshot(), initialState());
  assert.equal(endAddress, 0x210);
  checkMemory(ram, expectedMemory());
  const read = t.mock.method(ram, "read");
  const write = t.mock.method(ram, "write");
  const result = runCpu(cpu, { maxSteps: 16, endAddress });
  assert.equal(result.stopReason, "completed");
  const expected = expectedRecords();
  assert.deepEqual(result.records, expected);
  const accesses = expected.flatMap(record => record.accesses);
  assert.deepEqual(read.mock.calls.map(call => call.arguments), accesses.filter(a => a.kind === "read").map(a => [a.address]));
  assert.deepEqual(write.mock.calls.map(call => call.arguments), accesses.filter(a => a.kind === "write").map(a => [a.address, a.value]));
  read.mock.restore(); write.mock.restore();
  assert.deepEqual(cpu.snapshot(), expected.at(-1)!.after);
  checkMemory(ram, expectedMemory(true));
});

test("6809 indexed copy can resume from a snapshot between load and store, reset, and restart fresh", () => {
  const { cpu, ram, endAddress } = create6809IndexedCopyExample();
  const first = runCpu(cpu, { maxSteps: 6, endAddress }); // Second LDD has advanced X, but not U.
  assert.equal(first.stopReason, "step-limit");
  const saved = structuredClone(first);
  const copy = new Ram(0x10000);
  for (let address = 0; address < 65536; address++) copy.write(address, ram.read(address));
  const resumed = new Cpu6809(copy, cpu.snapshot());
  const rest = runCpu(resumed, { maxSteps: 10, endAddress });
  assert.equal(rest.stopReason, "completed");
  assert.deepEqual([...first.records, ...rest.records], expectedRecords());
  checkMemory(copy, expectedMemory(true));
  const before = resumed.snapshot();
  assert.deepEqual(resumed.reset(), { before, after: { ...before, pc: 0x200, dp: 0,
    flags: { ...before.flags, f: true, i: true } }, accesses: [
    { kind: "read", address: 0xfffe, value: 2 }, { kind: "read", address: 0xffff, value: 0 },
  ] });
  checkMemory(copy, expectedMemory(true));
  assert.equal(resumed.step().after.x, 0x3008); // Reset uses the current saved source pointer.
  const fresh = create6809IndexedCopyExample();
  assert.notStrictEqual(fresh.cpu, cpu);
  assert.notStrictEqual(fresh.ram, ram);
  assert.deepEqual(fresh.cpu.snapshot(), initialState());
  checkMemory(fresh.ram, expectedMemory());
  ram.write(0x3002, 0);
  assert.deepEqual(first, saved);
  const memory = create6809IndexedCopyExampleMemory();
  memory.write(0x2010, 0);
  checkMemory(create6809IndexedCopyExampleMemory(), expectedMemory());
});

test("6809 indexed copy follows the current RAM pointer and stops on a reserved postbyte", () => {
  const { cpu, ram, endAddress } = create6809IndexedCopyExample();
  ram.write(0x2011, 6); // Start at the sentinel.
  const result = runCpu(cpu, { maxSteps: 7, endAddress });
  assert.equal(result.stopReason, "completed");
  assert.equal(cpu.snapshot().u, 0x4002);
  assert.equal(ram.read(0x4000), 0);
  assert.equal(ram.read(0x4001), 0);
  assert.equal(ram.read(0x4002), 0xcc);
  const broken = create6809IndexedCopyExample();
  broken.ram.write(0x207, 0x90); // [,X+] is undefined.
  const rejected = runCpu(broken.cpu, { maxSteps: 16, endAddress });
  assert.equal(rejected.stopReason, "unsupported");
  assert.equal(rejected.records.length, 3);
  assert.equal(broken.cpu.snapshot().pc, 0x206);
  assert.equal(broken.ram.read(0x4000), 0xcc);
});
