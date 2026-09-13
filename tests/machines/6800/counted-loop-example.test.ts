import assert from "node:assert/strict";
import { test } from "node:test";
import type { Cpu6800MemoryAccess, Cpu6800Snapshot, Cpu6800StepRecord } from "../../../src/components/cpus/6800.js";
import type { Ram } from "../../../src/components/memory/ram.js";
import {
  create6800CountedLoopExample,
  create6800CountedLoopExampleMemory,
} from "../../../src/machines/generated/6800/counted-loop-example.js";
import { runCpu } from "../../../src/runtime/run-cpu.js";

function expectedInitialState(): Cpu6800Snapshot {
  return {
    a: 0x11, b: 0x22, x: 0x3456, sp: 0x7fff, pc: 0x0200,
    flags: { h: true, i: false, n: true, z: true, v: true, c: true },
  };
}

function checkMemory(ram: Ram, finished: boolean): void {
  const expected = new Uint8Array(0x10000);
  // Literal image from the specification, independent of the generated factory.
  expected.set([0xc6, 3, 0x86, 0, 0x8b, 5, 0x5a, 0x26, 0xfb, 0xb7, 0, 0x80], 0x0200);
  expected.set([2, 0], 0xfffe);
  if (finished) expected[0x80] = 0x0f;
  assert.equal(ram.size, expected.length);
  for (const [address, byte] of expected.entries()) assert.equal(ram.read(address), byte, `memory at ${address}`);
}

function expectedRecords(): readonly Cpu6800StepRecord[] {
  const steps: readonly {
    bytes: readonly number[]; changes: Partial<Cpu6800Snapshot>; data?: readonly Cpu6800MemoryAccess[];
  }[] = [
    { bytes: [0xc6, 3], changes: { pc: 0x0202, b: 3,
      flags: { h: true, i: false, n: false, z: false, v: false, c: true } } },
    { bytes: [0x86, 0], changes: { pc: 0x0204, a: 0,
      flags: { h: true, i: false, n: false, z: true, v: false, c: true } } },
    { bytes: [0x8b, 5], changes: { pc: 0x0206, a: 5,
      flags: { h: false, i: false, n: false, z: false, v: false, c: false } } },
    { bytes: [0x5a], changes: { pc: 0x0207, b: 2 } },
    { bytes: [0x26, 0xfb], changes: { pc: 0x0204 } },
    { bytes: [0x8b, 5], changes: { pc: 0x0206, a: 0x0a } },
    { bytes: [0x5a], changes: { pc: 0x0207, b: 1 } },
    { bytes: [0x26, 0xfb], changes: { pc: 0x0204 } },
    { bytes: [0x8b, 5], changes: { pc: 0x0206, a: 0x0f } },
    { bytes: [0x5a], changes: { pc: 0x0207, b: 0,
      flags: { h: false, i: false, n: false, z: true, v: false, c: false } } },
    { bytes: [0x26, 0xfb], changes: { pc: 0x0209 } },
    { bytes: [0xb7, 0, 0x80], changes: { pc: 0x020c,
      flags: { h: false, i: false, n: false, z: false, v: false, c: false } },
      data: [{ kind: "write", address: 0x0080, value: 0x0f }] },
  ];
  let state = expectedInitialState();
  return steps.map(({ bytes, changes, data = [] }) => {
    const before = state;
    state = { ...before, ...changes };
    return {
      instruction: { address: before.pc, bytes }, before, after: state,
      accesses: [...bytes.map((value, offset): Cpu6800MemoryAccess => ({
        kind: "read", address: before.pc + offset, value,
      })), ...data],
      outcome: "executed",
    };
  });
}

test("the 6800 counted-loop factories create independent state and complete memory images", () => {
  const memory = create6800CountedLoopExampleMemory();
  checkMemory(memory, false);
  memory.write(0x0200, 0);
  memory.write(0x80, 0xff);
  memory.write(0xfffe, 0xff);
  const second = create6800CountedLoopExampleMemory();
  assert.notStrictEqual(second, memory);
  checkMemory(second, false);
  const first = create6800CountedLoopExample();
  assert.deepEqual(first.cpu.snapshot(), expectedInitialState());
  assert.equal(first.endAddress, 0x020c);
  checkMemory(first.ram, false);
  first.cpu.step();
  first.ram.write(0x80, 0xff);
  const fresh = create6800CountedLoopExample();
  assert.notStrictEqual(fresh.cpu, first.cpu);
  assert.notStrictEqual(fresh.ram, first.ram);
  assert.deepEqual(fresh.cpu.snapshot(), expectedInitialState());
  checkMemory(fresh.ram, false);
});

test("the 6800 counted loop adds five three times and stores fifteen with exact records", (t) => {
  const { cpu, ram, endAddress } = create6800CountedLoopExample();
  const read = t.mock.method(ram, "read");
  const write = t.mock.method(ram, "write");
  const expected = expectedRecords();
  const result = runCpu(cpu, { maxSteps: 12, endAddress });
  assert.equal(result.stopReason, "completed");
  assert.deepEqual(result.records, expected);
  const accesses = expected.flatMap(record => record.accesses);
  assert.deepEqual(read.mock.calls.map(call => call.arguments),
    accesses.filter(access => access.kind === "read").map(access => [access.address]));
  assert.deepEqual(write.mock.calls.map(call => call.arguments), [[0x0080, 0x0f]]);
  read.mock.restore();
  write.mock.restore();
  checkMemory(ram, true);
  const final = {
    a: 0x0f, b: 0, x: 0x3456, sp: 0x7fff, pc: 0x020c,
    flags: { h: false, i: false, n: false, z: false, v: false, c: false },
  };
  assert.deepEqual(cpu.snapshot(), final);
  assert.deepEqual(runCpu(cpu, { maxSteps: 0, endAddress }), { records: [], stopReason: "completed" });
  assert.deepEqual(cpu.step(), {
    instruction: { address: 0x020c, bytes: [0] }, before: final, after: final,
    accesses: [{ kind: "read", address: 0x020c, value: 0 }], outcome: "unsupported", reason: "opcode",
  });
});

test("the 6800 counted loop resumes before BNE, preserves RAM and the stack pointer on reset, and restarts fresh", () => {
  const { cpu, ram, endAddress } = create6800CountedLoopExample();
  const first = runCpu(cpu, { maxSteps: 4, endAddress });
  const saved = structuredClone(first);
  assert.equal(first.stopReason, "step-limit");
  assert.deepEqual(cpu.snapshot(), {
    a: 5, b: 2, x: 0x3456, sp: 0x7fff, pc: 0x0207,
    flags: { h: false, i: false, n: false, z: false, v: false, c: false },
  });
  checkMemory(ram, false);
  const rest = runCpu(cpu, { maxSteps: 8, endAddress });
  assert.equal(rest.stopReason, "completed");
  assert.deepEqual([...first.records, ...rest.records], expectedRecords());
  const before = cpu.snapshot();
  const afterReset = { ...before, pc: 0x0200, flags: { ...before.flags, i: true } };
  assert.deepEqual(cpu.reset(), {
    before, after: afterReset,
    accesses: [{ kind: "read", address: 0xfffe, value: 2 }, { kind: "read", address: 0xffff, value: 0 }],
  });
  checkMemory(ram, true);
  assert.deepEqual(cpu.step().after, {
    ...afterReset, pc: 0x0202, b: 3,
    flags: { ...afterReset.flags, n: false, z: false, v: false },
  });
  const fresh = create6800CountedLoopExample();
  assert.notStrictEqual(fresh.cpu, cpu);
  assert.notStrictEqual(fresh.ram, ram);
  assert.deepEqual(fresh.cpu.snapshot(), expectedInitialState());
  checkMemory(fresh.ram, false);
  fresh.cpu.step();
  ram.write(0x0208, 0);
  assert.deepEqual(first, saved);
});

test("the 6800 counted loop remains bounded if a RAM edit redirects BNE to itself", () => {
  const { cpu, ram, endAddress } = create6800CountedLoopExample();
  ram.write(0x0208, 0xfe);
  const result = runCpu(cpu, { maxSteps: 9, endAddress });
  assert.equal(result.stopReason, "step-limit");
  assert.equal(result.records.length, 9);
  assert.deepEqual(result.records.slice(0, 4), expectedRecords().slice(0, 4));
  const state = cpu.snapshot();
  assert.equal(state.pc, 0x0207);
  assert.equal(ram.read(0x80), 0);
  for (const record of result.records.slice(4)) {
    assert.deepEqual(record, {
      instruction: { address: 0x0207, bytes: [0x26, 0xfe] }, before: state, after: state,
      accesses: [{ kind: "read", address: 0x0207, value: 0x26 }, { kind: "read", address: 0x0208, value: 0xfe }],
      outcome: "executed",
    });
  }
});
