import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu6800 } from "../../../src/components/cpus/6800.js";
import type { Cpu6800Snapshot, Cpu6800MemoryAccess, Cpu6800StepRecord } from "../../../src/components/cpus/6800.js";
import { Ram } from "../../../src/components/memory/ram.js";
import { create6800WordTransformExample, create6800WordTransformExampleMemory } from "../../../src/machines/generated/6800/word-transform-example.js";
import { runCpu } from "../../../src/runtime/run-cpu.js";

function initialState(): Cpu6800Snapshot {
  return { a: 0x81, b: 0x22, x: 0xff80, sp: 0x789a, pc: 0x200,
    flags: { h: true, i: false, n: true, z: false, v: true, c: true } };
}

function expectedMemory(finished = false): Uint8Array {
  const image = new Uint8Array(0x10000);
  image.set(finished ? [0, 0x40, 0xde, 0xad] : [0xff, 0x81, 0xde, 0xad]);
  image.set([0x67, 0x80, 0x76, 0, 1, 0x63, 0x80, 0x73, 0, 1, 0x7c, 0, 1,
    0x26, 2, 0x6c, 0x80, 0xa6, 0x80, 0xf6, 0, 1, 0x7d, 0, 0], 0x200);
  image.set([2, 0], 0xfffe);
  return image;
}

function checkMemory(ram: Ram, image: Uint8Array): void {
  assert.equal(ram.size, image.length);
  for (const [address, byte] of image.entries()) assert.equal(ram.read(address), byte, `RAM at ${address}`);
}

function expectedRecords(): Cpu6800StepRecord[] {
  const records: Cpu6800StepRecord[] = [];
  let state = initialState();
  const step = (bytes: number[], changes: Partial<Cpu6800Snapshot>, data: Cpu6800MemoryAccess[] = []) => {
    const before = state;
    state = { ...before, pc: before.pc + bytes.length, ...changes };
    records.push({ before, after: state, instruction: { address: before.pc, bytes }, outcome: "executed",
      accesses: [...bytes.map((value, offset): Cpu6800MemoryAccess => ({ kind: "read", address: before.pc + offset, value })), ...data] });
  };
  const modify = (address: number, before: number, after: number): Cpu6800MemoryAccess[] => [
    { kind: "read", address, value: before }, { kind: "write", address, value: after },
  ];
  const nz = (n: boolean, z: boolean) => ({ h: true, i: false, n, z, v: false, c: true });
  step([0x67, 0x80], { flags: nz(true, false) }, modify(0, 0xff, 0xff));
  step([0x76, 0, 1], {}, modify(1, 0x81, 0xc0));
  step([0x63, 0x80], { flags: nz(false, true) }, modify(0, 0xff, 0));
  step([0x73, 0, 1], { flags: nz(false, false) }, modify(1, 0xc0, 0x3f));
  step([0x7c, 0, 1], {}, modify(1, 0x3f, 0x40));
  step([0x26, 2], { pc: 0x211 });
  step([0xa6, 0x80], { a: 0, flags: nz(false, true) }, [{ kind: "read", address: 0, value: 0 }]);
  step([0xf6, 0, 1], { b: 0x40, flags: nz(false, false) }, [{ kind: "read", address: 1, value: 0x40 }]);
  step([0x7d, 0, 0], { flags: { ...nz(false, true), c: false } }, [{ kind: "read", address: 0, value: 0 }]);
  return records;
}

test("6800 word transformation negates an arithmetic half with nine exact records and real memory accesses", t => {
  const { cpu, ram, endAddress } = create6800WordTransformExample();
  assert.deepEqual(cpu.snapshot(), initialState());
  assert.equal(endAddress, 0x219);
  checkMemory(ram, expectedMemory());
  const read = t.mock.method(ram, "read");
  const write = t.mock.method(ram, "write");
  const result = runCpu(cpu, { maxSteps: 9, endAddress });
  const expected = expectedRecords();
  assert.equal(result.stopReason, "completed");
  assert.deepEqual(result.records, expected);
  const accesses = expected.flatMap(record => record.accesses);
  assert.deepEqual(read.mock.calls.map(call => call.arguments), accesses.filter(a => a.kind === "read").map(a => [a.address]));
  assert.deepEqual(write.mock.calls.map(call => call.arguments), accesses.filter(a => a.kind === "write").map(a => [a.address, a.value]));
  read.mock.restore(); write.mock.restore();
  assert.deepEqual(cpu.snapshot(), expected.at(-1)!.after);
  checkMemory(ram, expectedMemory(true));
});

test("6800 word transformation propagates low-byte wrap to the high byte using Z rather than carry", () => {
  const { cpu, ram, endAddress } = create6800WordTransformExample();
  ram.write(0, 0xfe); ram.write(1, 0); // -512 -> -256 -> +256
  const result = runCpu(cpu, { maxSteps: 10, endAddress });
  assert.equal(result.stopReason, "completed");
  assert.equal(result.records.length, 10);
  const increment = result.records[4]!;
  assert.deepEqual(increment.after.flags, { h: true, i: false, n: false, z: true, v: false, c: true });
  assert.equal(result.records[5]!.after.pc, 0x20f);
  assert.deepEqual(result.records[6]!.instruction, { address: 0x20f, bytes: [0x6c, 0x80] });
  assert.deepEqual(cpu.snapshot(), { ...initialState(), a: 1, b: 0, pc: 0x219,
    flags: { h: true, i: false, n: false, z: false, v: false, c: false } });
  const image = expectedMemory(true);
  image[0] = 1; image[1] = 0;
  checkMemory(ram, image);
});

test("6800 word transformation resumes between ASR/ROR, preserves the result on reset, and restarts independently", () => {
  const { cpu, ram, endAddress } = create6800WordTransformExample();
  const first = runCpu(cpu, { maxSteps: 1, endAddress });
  assert.equal(first.stopReason, "step-limit");
  const saved = structuredClone(first);
  const copy = new Ram(0x10000);
  for (let address = 0; address < 65536; address++) copy.write(address, ram.read(address));
  const resumed = new Cpu6800(copy, cpu.snapshot());
  const rest = runCpu(resumed, { maxSteps: 8, endAddress });
  assert.equal(rest.stopReason, "completed");
  assert.deepEqual([...first.records, ...rest.records], expectedRecords());
  checkMemory(copy, expectedMemory(true));
  const before = resumed.snapshot();
  assert.deepEqual(resumed.reset(), { before, after: { ...before, pc: 0x200, flags: { ...before.flags, i: true } },
    accesses: [{ kind: "read", address: 0xfffe, value: 2 }, { kind: "read", address: 0xffff, value: 0 }] });
  checkMemory(copy, expectedMemory(true));
  const fresh = create6800WordTransformExample();
  assert.notStrictEqual(fresh.cpu, cpu); assert.notStrictEqual(fresh.ram, ram);
  assert.deepEqual(fresh.cpu.snapshot(), initialState());
  checkMemory(fresh.ram, expectedMemory());
  const memory = create6800WordTransformExampleMemory();
  memory.write(0, 0);
  checkMemory(create6800WordTransformExampleMemory(), expectedMemory());
  copy.write(0, 0x12); resumed.step();
  assert.deepEqual(first, saved);
});

test("6800 word transformation remains bounded when a code edit traps the branch", () => {
  const { cpu, ram, endAddress } = create6800WordTransformExample();
  ram.write(0x20e, 0xfe); // BNE to itself after the low byte becomes 40.
  const result = runCpu(cpu, { maxSteps: 12, endAddress });
  assert.equal(result.stopReason, "step-limit");
  assert.equal(result.records.length, 12);
  assert.equal(cpu.snapshot().pc, 0x20d);
  assert.equal(ram.read(0), 0); assert.equal(ram.read(1), 0x40);
  assert.deepEqual(result.records.slice(0, 5), expectedRecords().slice(0, 5));
});
