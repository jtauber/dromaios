import assert from "node:assert/strict";
import { test } from "node:test";
import type { Cpu6502MemoryAccess, Cpu6502Snapshot, Cpu6502StepRecord } from "../../../src/components/cpus/generated/6502-cpu.js";
import type { Ram } from "../../../src/components/memory/ram.js";
import {
  create6502CountedLoopExample,
  create6502CountedLoopExampleMemory,
} from "../../../src/machines/generated/6502/counted-loop-example.js";
import { runCpu } from "../../../src/runtime/run-cpu.js";

function expectedInitialState(): Cpu6502Snapshot {
  return {
    a: 0x11, x: 0x22, y: 0x33, pc: 0x0200, sp: 0xff,
    flags: { n: true, v: true, d: false, i: false, z: true, c: true },
  };
}

function checkMemory(ram: Ram, finished: boolean): void {
  const expected = new Uint8Array(0x10000);
  // Literal image from the specification, independent of the generated factory.
  expected.set([
    0xa2, 3, 0xa0, 0, 0xa9, 0, 0x18, 0x69, 5, 0xc8, 0xca, 0xd0, 0xf9, 0x8d, 0x80, 0,
  ], 0x0200);
  expected.set([0, 2], 0xfffc);
  if (finished) expected[0x80] = 0x0f;
  assert.equal(ram.size, expected.length);
  for (const [address, byte] of expected.entries()) assert.equal(ram.read(address), byte, `memory at ${address}`);
}

function expectedRecords(): readonly Cpu6502StepRecord[] {
  const steps: readonly {
    bytes: readonly number[]; changes: Partial<Cpu6502Snapshot>; data?: readonly Cpu6502MemoryAccess[];
  }[] = [
    { bytes: [0xa2, 3], changes: { pc: 0x0202, x: 3,
      flags: { n: false, v: true, d: false, i: false, z: false, c: true } } },
    { bytes: [0xa0, 0], changes: { pc: 0x0204, y: 0,
      flags: { n: false, v: true, d: false, i: false, z: true, c: true } } },
    { bytes: [0xa9, 0], changes: { pc: 0x0206, a: 0 } },
    { bytes: [0x18], changes: { pc: 0x0207,
      flags: { n: false, v: true, d: false, i: false, z: true, c: false } } },
    { bytes: [0x69, 5], changes: { pc: 0x0209, a: 5,
      flags: { n: false, v: false, d: false, i: false, z: false, c: false } } },
    { bytes: [0xc8], changes: { pc: 0x020a, y: 1 } },
    { bytes: [0xca], changes: { pc: 0x020b, x: 2 } },
    { bytes: [0xd0, 0xf9], changes: { pc: 0x0206 } },
    { bytes: [0x18], changes: { pc: 0x0207 } },
    { bytes: [0x69, 5], changes: { pc: 0x0209, a: 0x0a } },
    { bytes: [0xc8], changes: { pc: 0x020a, y: 2 } },
    { bytes: [0xca], changes: { pc: 0x020b, x: 1 } },
    { bytes: [0xd0, 0xf9], changes: { pc: 0x0206 } },
    { bytes: [0x18], changes: { pc: 0x0207 } },
    { bytes: [0x69, 5], changes: { pc: 0x0209, a: 0x0f } },
    { bytes: [0xc8], changes: { pc: 0x020a, y: 3 } },
    { bytes: [0xca], changes: { pc: 0x020b, x: 0,
      flags: { n: false, v: false, d: false, i: false, z: true, c: false } } },
    { bytes: [0xd0, 0xf9], changes: { pc: 0x020d } },
    { bytes: [0x8d, 0x80, 0], changes: { pc: 0x0210 },
      data: [{ kind: "write", address: 0x0080, value: 0x0f }] },
  ];
  let state = expectedInitialState();
  return steps.map(({ bytes, changes, data = [] }) => {
    const before = state;
    state = { ...before, ...changes };
    return {
      instruction: { address: before.pc, bytes }, before, after: state,
      accesses: [...bytes.map((value, offset): Cpu6502MemoryAccess => ({
        kind: "read", address: before.pc + offset, value,
      })), ...data],
      outcome: "executed",
    };
  });
}

test("the 6502 counted-loop factories create independent state and complete memory images", () => {
  const memory = create6502CountedLoopExampleMemory();
  checkMemory(memory, false);
  memory.write(0x0200, 0);
  memory.write(0x80, 0xff);
  memory.write(0xfffd, 0xff);
  const second = create6502CountedLoopExampleMemory();
  assert.notStrictEqual(second, memory);
  checkMemory(second, false);
  const first = create6502CountedLoopExample();
  assert.deepEqual(first.cpu.snapshot(), expectedInitialState());
  assert.equal(first.endAddress, 0x0210);
  checkMemory(first.ram, false);
  first.cpu.step();
  first.ram.write(0x80, 0xff);
  const fresh = create6502CountedLoopExample();
  assert.notStrictEqual(fresh.cpu, first.cpu);
  assert.notStrictEqual(fresh.ram, first.ram);
  assert.deepEqual(fresh.cpu.snapshot(), expectedInitialState());
  checkMemory(fresh.ram, false);
});

test("the 6502 counted loop adds five three times and stores fifteen with exact records", (t) => {
  const { cpu, ram, endAddress } = create6502CountedLoopExample();
  const read = t.mock.method(ram, "read");
  const write = t.mock.method(ram, "write");
  const expected = expectedRecords();
  const result = runCpu(cpu, { maxSteps: 19, endAddress });
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
    a: 0x0f, x: 0, y: 3, sp: 0xff, pc: 0x0210,
    flags: { n: false, v: false, d: false, i: false, z: true, c: false },
  };
  assert.deepEqual(cpu.snapshot(), final);
  assert.deepEqual(runCpu(cpu, { maxSteps: 0, endAddress }), { records: [], stopReason: "completed" });
  const brk = cpu.step();
  assert.equal(brk.outcome, "executed");
  assert.deepEqual(brk.instruction, { address: 0x0210, bytes: [0, 0] });
  assert.equal(brk.after.pc, 0); // The unused IRQ/BRK vector contains zero.
});

test("the 6502 counted loop resumes before BNE, preserves RAM on reset, and restarts with fresh components", () => {
  const { cpu, ram, endAddress } = create6502CountedLoopExample();
  const first = runCpu(cpu, { maxSteps: 7, endAddress });
  const saved = structuredClone(first);
  assert.equal(first.stopReason, "step-limit");
  assert.deepEqual(cpu.snapshot(), {
    a: 5, x: 2, y: 1, sp: 0xff, pc: 0x020b,
    flags: { n: false, v: false, d: false, i: false, z: false, c: false },
  });
  checkMemory(ram, false);
  const rest = runCpu(cpu, { maxSteps: 12, endAddress });
  assert.equal(rest.stopReason, "completed");
  assert.deepEqual([...first.records, ...rest.records], expectedRecords());
  const before = cpu.snapshot();
  const afterReset = { ...before, pc: 0x0200, sp: 0xfc, flags: { ...before.flags, i: true } };
  assert.deepEqual(cpu.reset(), {
    before, after: afterReset,
    accesses: [{ kind: "read", address: 0xfffc, value: 0 }, { kind: "read", address: 0xfffd, value: 2 }],
  });
  checkMemory(ram, true);
  assert.deepEqual(cpu.step().after, {
    ...afterReset, pc: 0x0202, x: 3, flags: { ...afterReset.flags, n: false, z: false },
  });
  const fresh = create6502CountedLoopExample();
  assert.notStrictEqual(fresh.cpu, cpu);
  assert.notStrictEqual(fresh.ram, ram);
  assert.deepEqual(fresh.cpu.snapshot(), expectedInitialState());
  checkMemory(fresh.ram, false);
  fresh.cpu.step();
  ram.write(0x020c, 0);
  assert.deepEqual(first, saved);
});

test("the 6502 counted loop remains bounded if a RAM edit redirects BNE to itself", () => {
  const { cpu, ram, endAddress } = create6502CountedLoopExample();
  ram.write(0x020c, 0xfe);
  const result = runCpu(cpu, { maxSteps: 12, endAddress });
  assert.equal(result.stopReason, "step-limit");
  assert.equal(result.records.length, 12);
  assert.deepEqual(result.records.slice(0, 7), expectedRecords().slice(0, 7));
  const state = cpu.snapshot();
  assert.equal(state.pc, 0x020b);
  assert.equal(ram.read(0x80), 0);
  for (const record of result.records.slice(7)) {
    assert.deepEqual(record, {
      instruction: { address: 0x020b, bytes: [0xd0, 0xfe] }, before: state, after: state,
      accesses: [{ kind: "read", address: 0x020b, value: 0xd0 }, { kind: "read", address: 0x020c, value: 0xfe }],
      outcome: "executed",
    });
  }
});
