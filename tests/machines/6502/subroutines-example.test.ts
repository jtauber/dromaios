import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu6502 } from "../../../src/components/cpus/generated/6502-cpu.js";
import type { Cpu6502MemoryAccess, Cpu6502Snapshot, Cpu6502StepRecord } from "../../../src/components/cpus/generated/6502-cpu.js";
import type { Ram } from "../../../src/components/memory/ram.js";
import {
  create6502SubroutinesExample,
  create6502SubroutinesExampleMemory,
} from "../../../src/machines/generated/6502/subroutines-example.js";
import { runCpu } from "../../../src/runtime/run-cpu.js";

function expectedInitialState(): Cpu6502Snapshot {
  return {
    a: 0x11, x: 0x22, y: 0x33, pc: 0x0200, sp: 1,
    flags: { n: false, v: true, d: false, i: false, z: true, c: true },
  };
}

function checkMemory(ram: Ram, finished: boolean): void {
  // Literal image and residual stack bytes from the specification, independent of the factory.
  const expected = new Uint8Array(0x10000);
  expected.set([0xa9, 0x80, 0x48, 0x20, 0x20, 2, 0x8d, 0x80, 0, 0x68, 0x4c, 0x40, 2, 0xa9, 0xee], 0x0200);
  expected.set([0xa9, 5, 0x18, 0x20, 0x30, 2, 0x69, 1, 0x60], 0x0220);
  expected.set([0x69, 0x0a, 0x60], 0x0230);
  expected.set([0xaa, finished ? 0x10 : 0xcc, 0x55], 0x007f);
  expected[0x0102] = 0x5a;
  expected[0x01fc] = 0xa5;
  expected.set([0, 2], 0xfffc);
  if (finished) {
    expected.set([2, 0x80], 0x0100);
    expected.set([0x25, 2, 5], 0x01fd);
  }
  assert.equal(ram.size, expected.length);
  for (const [address, byte] of expected.entries()) assert.equal(ram.read(address), byte, `memory at ${address}`);
}

function expectedRecords(): readonly Cpu6502StepRecord[] {
  const read = (address: number, value: number): Cpu6502MemoryAccess => ({ kind: "read", address, value });
  const write = (address: number, value: number): Cpu6502MemoryAccess => ({ kind: "write", address, value });
  const steps: readonly {
    bytes: readonly number[]; changes: Partial<Cpu6502Snapshot> & { pc: number }; accesses: readonly Cpu6502MemoryAccess[];
  }[] = [
    { bytes: [0xa9, 0x80], changes: { pc: 0x0202, a: 0x80,
      flags: { n: true, v: true, d: false, i: false, z: false, c: true } },
      accesses: [read(0x0200, 0xa9), read(0x0201, 0x80)] },
    { bytes: [0x48], changes: { pc: 0x0203, sp: 0 }, accesses: [read(0x0202, 0x48), write(0x0101, 0x80)] },
    { bytes: [0x20, 0x20, 2], changes: { pc: 0x0220, sp: 0xfe },
      accesses: [read(0x0203, 0x20), read(0x0204, 0x20), write(0x0100, 2), write(0x01ff, 5), read(0x0205, 2)] },
    { bytes: [0xa9, 5], changes: { pc: 0x0222, a: 5,
      flags: { n: false, v: true, d: false, i: false, z: false, c: true } },
      accesses: [read(0x0220, 0xa9), read(0x0221, 5)] },
    { bytes: [0x18], changes: { pc: 0x0223,
      flags: { n: false, v: true, d: false, i: false, z: false, c: false } }, accesses: [read(0x0222, 0x18)] },
    { bytes: [0x20, 0x30, 2], changes: { pc: 0x0230, sp: 0xfc },
      accesses: [read(0x0223, 0x20), read(0x0224, 0x30), write(0x01fe, 2), write(0x01fd, 0x25), read(0x0225, 2)] },
    { bytes: [0x69, 0x0a], changes: { pc: 0x0232, a: 0x0f,
      flags: { n: false, v: false, d: false, i: false, z: false, c: false } },
      accesses: [read(0x0230, 0x69), read(0x0231, 0x0a)] },
    { bytes: [0x60], changes: { pc: 0x0226, sp: 0xfe },
      accesses: [read(0x0232, 0x60), read(0x01fd, 0x25), read(0x01fe, 2)] },
    { bytes: [0x69, 1], changes: { pc: 0x0228, a: 0x10 }, accesses: [read(0x0226, 0x69), read(0x0227, 1)] },
    { bytes: [0x60], changes: { pc: 0x0206, sp: 0 },
      accesses: [read(0x0228, 0x60), read(0x01ff, 5), read(0x0100, 2)] },
    { bytes: [0x8d, 0x80, 0], changes: { pc: 0x0209 },
      accesses: [read(0x0206, 0x8d), read(0x0207, 0x80), read(0x0208, 0), write(0x0080, 0x10)] },
    { bytes: [0x68], changes: { pc: 0x020a, sp: 1, a: 0x80,
      flags: { n: true, v: false, d: false, i: false, z: false, c: false } },
      accesses: [read(0x0209, 0x68), read(0x0101, 0x80)] },
    { bytes: [0x4c, 0x40, 2], changes: { pc: 0x0240 },
      accesses: [read(0x020a, 0x4c), read(0x020b, 0x40), read(0x020c, 2)] },
  ];
  let state = expectedInitialState();
  return steps.map(({ bytes, changes, accesses }) => {
    const before = state;
    state = { ...before, ...changes };
    return { instruction: { address: before.pc, bytes }, before, after: state, accesses, outcome: "executed" };
  });
}

test("6502 subroutine factories provide independent components, complete images, and an explicit endpoint", () => {
  const memory = create6502SubroutinesExampleMemory();
  checkMemory(memory, false);
  memory.write(0x0200, 0);
  memory.write(0x0101, 0xff);
  memory.write(0xfffc, 0xff);
  const second = create6502SubroutinesExampleMemory();
  assert.notStrictEqual(second, memory);
  checkMemory(second, false);
  const first = create6502SubroutinesExample();
  assert.deepEqual(first.cpu.snapshot(), expectedInitialState());
  assert.equal(first.endAddress, 0x0240);
  checkMemory(first.ram, false);
  runCpu(first.cpu, { maxSteps: 13, endAddress: first.endAddress });
  const fresh = create6502SubroutinesExample();
  assert.notStrictEqual(fresh.cpu, first.cpu);
  assert.notStrictEqual(fresh.ram, first.ram);
  assert.deepEqual(fresh.cpu.snapshot(), expectedInitialState());
  checkMemory(fresh.ram, false);
});

test("6502 nested calls wrap the page-one stack, store 10, restore A/SP, and jump to completion", t => {
  const { cpu, ram, endAddress } = create6502SubroutinesExample();
  // Capture reads and writes together, so their interleaving is checked independently of records.
  const actual: Cpu6502MemoryAccess[] = [];
  const originalRead = ram.read.bind(ram), originalWrite = ram.write.bind(ram);
  t.mock.method(ram, "read", (address: number) => {
    const value = originalRead(address);
    actual.push({ kind: "read", address, value });
    return value;
  });
  t.mock.method(ram, "write", (address: number, value: number) => {
    originalWrite(address, value);
    actual.push({ kind: "write", address, value });
  });
  const result = runCpu(cpu, { maxSteps: 13, endAddress });
  const expected = expectedRecords();
  assert.equal(result.stopReason, "completed");
  assert.deepEqual(result.records, expected);
  assert.deepEqual(actual, expected.flatMap(record => record.accesses));
  t.mock.restoreAll();
  checkMemory(ram, true);
  const final: Cpu6502Snapshot = { a: 0x80, x: 0x22, y: 0x33, pc: 0x0240, sp: 1,
    flags: { n: true, v: false, d: false, i: false, z: false, c: false } };
  assert.deepEqual(cpu.snapshot(), final);
  assert.deepEqual(runCpu(cpu, { maxSteps: 0, endAddress }), { records: [], stopReason: "completed" });
  const brk = cpu.step();
  assert.equal(brk.outcome, "executed");
  assert.deepEqual(brk.instruction, { address: 0x0240, bytes: [0, 0] });
  assert.equal(brk.after.pc, 0); // The unused IRQ/BRK vector contains zero.
});

test("6502 subroutines resume from snapshots and RAM at either call depth and after returns", () => {
  for (const pauseAfter of [3, 6, 8, 10, 12]) {
    const { cpu, ram, endAddress } = create6502SubroutinesExample();
    const first = runCpu(cpu, { maxSteps: pauseAfter, endAddress });
    const saved = structuredClone(first);
    assert.equal(first.stopReason, "step-limit");
    const resumed = new Cpu6502(ram, cpu.snapshot());
    const rest = runCpu(resumed, { maxSteps: 13 - pauseAfter, endAddress });
    assert.equal(rest.stopReason, "completed");
    assert.deepEqual([...first.records, ...rest.records], expectedRecords());
    checkMemory(ram, true);
    resumed.reset();
    ram.write(0x01fd, 0xff);
    assert.deepEqual(first, saved);
  }
});

test("6502 reset inside a nested call decrements SP and preserves the saved addresses; restart supplies fresh state", () => {
  const { cpu, ram, endAddress } = create6502SubroutinesExample();
  const run = runCpu(cpu, { maxSteps: 6, endAddress });
  const savedRun = structuredClone(run);
  const before: Cpu6502Snapshot = { a: 5, x: 0x22, y: 0x33, pc: 0x0230, sp: 0xfc,
    flags: { n: false, v: true, d: false, i: false, z: false, c: false } };
  assert.deepEqual(cpu.snapshot(), before);
  const savedMemory = Array.from({ length: ram.size }, (_, address) => ram.read(address));
  const after = { ...before, pc: 0x0200, sp: 0xf9, flags: { ...before.flags, i: true } };
  assert.deepEqual(cpu.reset(), {
    before, after, accesses: [{ kind: "read", address: 0xfffc, value: 0 }, { kind: "read", address: 0xfffd, value: 2 }],
  });
  for (const [address, byte] of savedMemory.entries()) assert.equal(ram.read(address), byte);
  assert.equal(runCpu(cpu, { maxSteps: 13, endAddress }).stopReason, "completed");
  assert.deepEqual(cpu.snapshot(), { ...after, pc: 0x0240, a: 0x80,
    flags: { n: true, v: false, d: false, i: true, z: false, c: false } });
  assert.deepEqual(run, savedRun);
  const fresh = create6502SubroutinesExample();
  assert.deepEqual(fresh.cpu.snapshot(), expectedInitialState());
  checkMemory(fresh.ram, false);
});

test("an edited 6502 JMP can loop indefinitely while the runner remains bounded", () => {
  const { cpu, ram, endAddress } = create6502SubroutinesExample();
  runCpu(cpu, { maxSteps: 12, endAddress });
  ram.write(0x020b, 0x0a);
  const before = cpu.snapshot();
  const expected: Cpu6502StepRecord = {
    before, after: before, outcome: "executed", instruction: { address: 0x020a, bytes: [0x4c, 0x0a, 2] },
    accesses: [{ kind: "read", address: 0x020a, value: 0x4c }, { kind: "read", address: 0x020b, value: 0x0a },
      { kind: "read", address: 0x020c, value: 2 }],
  };
  assert.deepEqual(runCpu(cpu, { maxSteps: 3, endAddress }), { records: [expected, expected, expected], stopReason: "step-limit" });
});
