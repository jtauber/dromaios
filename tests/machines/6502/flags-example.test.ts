import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu6502 } from "../../../src/components/cpus/6502.js";
import type { Cpu6502Flags, Cpu6502MemoryAccess, Cpu6502Snapshot, Cpu6502StepRecord } from "../../../src/components/cpus/6502.js";
import type { Ram } from "../../../src/components/memory/ram.js";
import { create6502FlagsExample, create6502FlagsExampleMemory } from "../../../src/machines/generated/6502/flags-example.js";
import { runCpu } from "../../../src/runtime/run-cpu.js";

function expectedInitialState(): Cpu6502Snapshot {
  return { a: 0x11, x: 0x22, y: 0x33, sp: 0xab, pc: 0x0200,
    flags: { n: true, v: true, d: true, i: true, z: true, c: true } };
}

function checkMemory(ram: Ram, finished: boolean): void {
  const expected = new Uint8Array(0x10000);
  expected.set([0xaa, 0xc0, 2, 0x55], 0x7f);
  expected.set([0xaa, finished ? 3 : 0xcc, 0x55], 0x8f);
  expected.set([0xaa, finished ? 1 : 0xcc, 0x55], 0x17f);
  expected.set([
    0xd8, 0xa2, 0x80, 0x9a, 0xa9, 1, 0x48, 0xba, 0xe0, 0x7f, 0xd0, 0x24, 0xa0, 0,
    0xc8, 0xc4, 0x81, 0x90, 0xfb, 0x24, 0x80, 0xf0, 3, 0x4c, 0x30, 2, 0xb8, 0x50, 3,
    0x4c, 0x30, 2, 0x68, 0x38, 0x69, 1, 0xf8, 0xea, 0x8d, 0x90, 0, 0x4c, 0x40, 2,
  ], 0x0200);
  expected.set([0, 2], 0xfffc);
  assert.equal(ram.size, expected.length);
  expected.forEach((value, address) => assert.equal(ram.read(address), value, `RAM ${address}`));
}

function expectedRecords(): readonly Cpu6502StepRecord[] {
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
  append([0xd8], 0x0201, { flags: { d: false } });
  append([0xa2, 0x80], 0x0203, { x: 0x80, flags: { n: true, z: false } });
  append([0x9a], 0x0204, { sp: 0x80 });
  append([0xa9, 1], 0x0206, { a: 1, flags: { n: false, z: false } });
  append([0x48], 0x0207, { sp: 0x7f }, [{ kind: "write", address: 0x0180, value: 1 }]);
  append([0xba], 0x0208, { x: 0x7f, flags: { n: false, z: false } });
  append([0xe0, 0x7f], 0x020a, { flags: { n: false, z: true, c: true } });
  append([0xd0, 0x24], 0x020c);
  append([0xa0, 0], 0x020e, { y: 0, flags: { n: false, z: true } });
  append([0xc8], 0x020f, { y: 1, flags: { n: false, z: false } });
  append([0xc4, 0x81], 0x0211, { flags: { n: true, z: false, c: false } }, [{ kind: "read", address: 0x81, value: 2 }]);
  append([0x90, 0xfb], 0x020e);
  append([0xc8], 0x020f, { y: 2, flags: { n: false, z: false } });
  append([0xc4, 0x81], 0x0211, { flags: { n: false, z: true, c: true } }, [{ kind: "read", address: 0x81, value: 2 }]);
  append([0x90, 0xfb], 0x0213);
  append([0x24, 0x80], 0x0215, { flags: { n: true, v: true, z: true } }, [{ kind: "read", address: 0x80, value: 0xc0 }]);
  append([0xf0, 3], 0x021a);
  append([0xb8], 0x021b, { flags: { v: false } });
  append([0x50, 3], 0x0220);
  append([0x68], 0x0221, { a: 1, sp: 0x80, flags: { n: false, z: false } }, [{ kind: "read", address: 0x0180, value: 1 }]);
  append([0x38], 0x0222, { flags: { c: true } });
  append([0x69, 1], 0x0224, { a: 3, flags: { n: false, v: false, z: false, c: false } });
  append([0xf8], 0x0225, { flags: { d: true } });
  append([0xea], 0x0226);
  append([0x8d, 0x90, 0], 0x0229, {}, [{ kind: "write", address: 0x90, value: 3 }]);
  append([0x4c, 0x40, 2], 0x0240);
  return records;
}

test("6502 flag factories provide independent components and the full initial memory image", () => {
  const first = create6502FlagsExample();
  assert.deepEqual(first.cpu.snapshot(), expectedInitialState());
  assert.equal(first.endAddress, 0x0240);
  checkMemory(first.ram, false);
  runCpu(first.cpu, { maxSteps: 26, endAddress: first.endAddress });
  const fresh = create6502FlagsExample();
  assert.notStrictEqual(fresh.cpu, first.cpu);
  assert.notStrictEqual(fresh.ram, first.ram);
  assert.deepEqual(fresh.cpu.snapshot(), expectedInitialState());
  checkMemory(fresh.ram, false);
  const memory = create6502FlagsExampleMemory();
  memory.write(0x80, 0);
  checkMemory(create6502FlagsExampleMemory(), false);
});

test("6502 compares indices, tests memory bits, and controls flags around a selected stack slot", t => {
  const { cpu, ram, endAddress } = create6502FlagsExample();
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
  const records = expectedRecords();
  assert.equal(records.length, 26);
  assert.deepEqual(runCpu(cpu, { maxSteps: 26, endAddress }), { records, stopReason: "completed" });
  assert.deepEqual(accesses, records.flatMap(record => record.accesses));
  t.mock.restoreAll();
  assert.deepEqual(cpu.snapshot(), { a: 3, x: 0x7f, y: 2, sp: 0x80, pc: 0x0240,
    flags: { n: false, v: false, d: true, i: true, z: false, c: false } });
  checkMemory(ram, true);
  assert.deepEqual(runCpu(cpu, { maxSteps: 0, endAddress }), { records: [], stopReason: "completed" });
});

test("6502 flag examples resume through stack and flag changes and preserve records across reset", () => {
  for (const pauseAfter of [3, 5, 6, 11, 16, 18, 21, 23, 24]) {
    const { cpu, ram, endAddress } = create6502FlagsExample();
    const first = runCpu(cpu, { maxSteps: pauseAfter, endAddress });
    const saved = structuredClone(first);
    assert.equal(first.stopReason, "step-limit");
    const resumed = new Cpu6502(ram, cpu.snapshot());
    const rest = runCpu(resumed, { maxSteps: 26 - pauseAfter, endAddress });
    assert.equal(rest.stopReason, "completed");
    assert.deepEqual([...first.records, ...rest.records], expectedRecords());
    const before = resumed.snapshot();
    assert.deepEqual(resumed.reset(), { before, after: { ...before, pc: 0x0200, sp: 0x7d },
      accesses: [{ kind: "read", address: 0xfffc, value: 0 }, { kind: "read", address: 0xfffd, value: 2 }] });
    checkMemory(ram, true);
    ram.write(0x0180, 0);
    assert.deepEqual(first, saved);
  }
});

test("6502 BIT observes a changed status byte and follows the failure path without storing a result", () => {
  const { cpu, ram, endAddress } = create6502FlagsExample();
  runCpu(cpu, { maxSteps: 15, endAddress });
  ram.write(0x80, 0xc1); // A=1 now matches bit 0; N and V remain set, Z becomes clear.
  const result = runCpu(cpu, { maxSteps: 10, endAddress });
  assert.equal(result.stopReason, "unsupported");
  assert.deepEqual(result.records.map(record => record.instruction.address), [0x0213, 0x0215, 0x0217, 0x0230]);
  assert.deepEqual(cpu.snapshot(), { a: 1, x: 0x7f, y: 2, sp: 0x7f, pc: 0x0230,
    flags: { n: true, v: true, d: false, i: true, z: false, c: true } });
  assert.equal(ram.read(0x90), 0xcc);
  assert.equal(ram.read(0x0180), 1);
});
