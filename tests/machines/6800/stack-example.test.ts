import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu6800 } from "../../../src/components/cpus/6800.js";
import type { Cpu6800MemoryAccess, Cpu6800Snapshot, Cpu6800StepRecord } from "../../../src/components/cpus/6800.js";
import type { Ram } from "../../../src/components/memory/ram.js";
import {
  create6800StackExample,
  create6800StackExampleMemory,
} from "../../../src/machines/generated/6800/stack-example.js";
import { runCpu } from "../../../src/runtime/run-cpu.js";

function expectedInitialState(): Cpu6800Snapshot {
  return {
    a: 0x80, b: 0, x: 0x3456, sp: 0x0101, pc: 0x0200,
    flags: { h: true, i: false, n: true, z: true, v: true, c: true },
  };
}

function checkMemory(ram: Ram, finished: boolean): void {
  const expected = new Uint8Array(0x10000);
  // Literal image and residual stack bytes from the specification, independent of the factory.
  expected.set([0x8e, 1, 1, 0x36, 0x37, 0xbd, 2, 0x20, 0xb7, 0, 0x80, 0x33, 0x32], 0x0200);
  expected.set([0x86, 5, 0xc6, 7, 0x8d, 0x0a, 0x8b, 1, 0x39], 0x0220);
  expected.set([0x8b, 0x0a, 0x39], 0x0230);
  expected.set([0xaa, finished ? 0x10 : 0xcc, 0x55], 0x007f);
  expected[0x00fb] = 0xa5;
  expected[0x0102] = 0x5a;
  expected.set([2, 0], 0xfffe);
  if (finished) expected.set([2, 0x26, 2, 8, 0, 0x80], 0x00fc);
  assert.equal(ram.size, expected.length);
  for (const [address, byte] of expected.entries()) assert.equal(ram.read(address), byte, `memory at ${address}`);
}

function expectedRecords(): readonly Cpu6800StepRecord[] {
  const steps: readonly {
    bytes: readonly number[]; changes: Partial<Cpu6800Snapshot> & { pc: number }; data?: readonly Cpu6800MemoryAccess[];
  }[] = [
    { bytes: [0x8e, 1, 1], changes: { pc: 0x0203,
      flags: { h: true, i: false, n: false, z: false, v: false, c: true } } },
    { bytes: [0x36], changes: { pc: 0x0204, sp: 0x0100 },
      data: [{ kind: "write", address: 0x0101, value: 0x80 }] },
    { bytes: [0x37], changes: { pc: 0x0205, sp: 0x00ff },
      data: [{ kind: "write", address: 0x0100, value: 0 }] },
    { bytes: [0xbd, 2, 0x20], changes: { pc: 0x0220, sp: 0x00fd },
      data: [{ kind: "write", address: 0x00ff, value: 8 }, { kind: "write", address: 0x00fe, value: 2 }] },
    { bytes: [0x86, 5], changes: { pc: 0x0222, a: 5 } },
    { bytes: [0xc6, 7], changes: { pc: 0x0224, b: 7 } },
    { bytes: [0x8d, 0x0a], changes: { pc: 0x0230, sp: 0x00fb },
      data: [{ kind: "write", address: 0x00fd, value: 0x26 }, { kind: "write", address: 0x00fc, value: 2 }] },
    { bytes: [0x8b, 0x0a], changes: { pc: 0x0232, a: 0x0f,
      flags: { h: false, i: false, n: false, z: false, v: false, c: false } } },
    { bytes: [0x39], changes: { pc: 0x0226, sp: 0x00fd },
      data: [{ kind: "read", address: 0x00fc, value: 2 }, { kind: "read", address: 0x00fd, value: 0x26 }] },
    { bytes: [0x8b, 1], changes: { pc: 0x0228, a: 0x10,
      flags: { h: true, i: false, n: false, z: false, v: false, c: false } } },
    { bytes: [0x39], changes: { pc: 0x0208, sp: 0x00ff },
      data: [{ kind: "read", address: 0x00fe, value: 2 }, { kind: "read", address: 0x00ff, value: 8 }] },
    { bytes: [0xb7, 0, 0x80], changes: { pc: 0x020b },
      data: [{ kind: "write", address: 0x0080, value: 0x10 }] },
    { bytes: [0x33], changes: { pc: 0x020c, sp: 0x0100, b: 0 },
      data: [{ kind: "read", address: 0x0100, value: 0 }] },
    { bytes: [0x32], changes: { pc: 0x020d, sp: 0x0101, a: 0x80 },
      data: [{ kind: "read", address: 0x0101, value: 0x80 }] },
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

test("the 6800 stack factories create independent state and complete memory images", () => {
  const memory = create6800StackExampleMemory();
  checkMemory(memory, false);
  memory.write(0x0200, 0);
  memory.write(0x0101, 0xff);
  memory.write(0xfffe, 0xff);
  const second = create6800StackExampleMemory();
  assert.notStrictEqual(second, memory);
  checkMemory(second, false);
  const first = create6800StackExample();
  assert.deepEqual(first.cpu.snapshot(), expectedInitialState());
  assert.equal(first.endAddress, 0x020d);
  checkMemory(first.ram, false);
  runCpu(first.cpu, { maxSteps: 14, endAddress: first.endAddress });
  const fresh = create6800StackExample();
  assert.notStrictEqual(fresh.cpu, first.cpu);
  assert.notStrictEqual(fresh.ram, first.ram);
  assert.deepEqual(fresh.cpu.snapshot(), expectedInitialState());
  checkMemory(fresh.ram, false);
});

test("the 6800 stack example nests calls, stores the result, and restores A/B/SP without restoring flags", (t) => {
  const { cpu, ram, endAddress } = create6800StackExample();
  const read = t.mock.method(ram, "read");
  const write = t.mock.method(ram, "write");
  const expected = expectedRecords();
  const result = runCpu(cpu, { maxSteps: 14, endAddress });
  assert.equal(result.stopReason, "completed");
  assert.deepEqual(result.records, expected);
  const accesses = expected.flatMap(record => record.accesses);
  assert.deepEqual(read.mock.calls.map(call => call.arguments),
    accesses.filter(access => access.kind === "read").map(access => [access.address]));
  assert.deepEqual(write.mock.calls.map(call => call.arguments),
    [[0x0101, 0x80], [0x0100, 0], [0x00ff, 8], [0x00fe, 2], [0x00fd, 0x26], [0x00fc, 2], [0x0080, 0x10]]);
  read.mock.restore();
  write.mock.restore();
  checkMemory(ram, true);
  const final = {
    a: 0x80, b: 0, x: 0x3456, sp: 0x0101, pc: 0x020d,
    flags: { h: true, i: false, n: false, z: false, v: false, c: false },
  };
  assert.deepEqual(cpu.snapshot(), final);
  assert.deepEqual(runCpu(cpu, { maxSteps: 0, endAddress }), { records: [], stopReason: "completed" });
  assert.deepEqual(cpu.step(), {
    instruction: { address: 0x020d, bytes: [0] }, before: final, after: final,
    accesses: [{ kind: "read", address: 0x020d, value: 0 }], outcome: "unsupported", reason: "opcode",
  });
});

test("the 6800 stack example resumes from snapshots and RAM at different call depths and between pulls", () => {
  for (const pauseAfter of [4, 7, 9, 11, 13]) {
    const { cpu, ram, endAddress } = create6800StackExample();
    const first = runCpu(cpu, { maxSteps: pauseAfter, endAddress });
    const saved = structuredClone(first);
    assert.equal(first.stopReason, "step-limit");
    const resumed = new Cpu6800(ram, cpu.snapshot());
    const rest = runCpu(resumed, { maxSteps: 14 - pauseAfter, endAddress });
    assert.equal(rest.stopReason, "completed");
    assert.deepEqual([...first.records, ...rest.records], expectedRecords());
    checkMemory(ram, true);
    resumed.reset();
    ram.write(0x00fc, 0xff);
    Reflect.set(resumed.snapshot().flags, "c", true);
    assert.deepEqual(first, saved);
  }
});

test("6800 reset inside a nested call preserves SP and stack RAM; LDS and fresh restart are explicit", () => {
  const { cpu, ram, endAddress } = create6800StackExample();
  runCpu(cpu, { maxSteps: 7, endAddress });
  const before = {
    a: 5, b: 7, x: 0x3456, sp: 0x00fb, pc: 0x0230,
    flags: { h: true, i: false, n: false, z: false, v: false, c: true },
  };
  assert.deepEqual(cpu.snapshot(), before);
  const savedMemory = Array.from({ length: ram.size }, (_, address) => ram.read(address));
  const after = { ...before, pc: 0x0200, flags: { ...before.flags, i: true } };
  assert.deepEqual(cpu.reset(), {
    before, after,
    accesses: [{ kind: "read", address: 0xfffe, value: 2 }, { kind: "read", address: 0xffff, value: 0 }],
  });
  for (const [address, byte] of savedMemory.entries()) assert.equal(ram.read(address), byte);
  assert.deepEqual(cpu.step().after, { ...after, pc: 0x0203, sp: 0x0101 });
  const fresh = create6800StackExample();
  assert.notStrictEqual(fresh.cpu, cpu);
  assert.notStrictEqual(fresh.ram, ram);
  assert.deepEqual(fresh.cpu.snapshot(), expectedInitialState());
  checkMemory(fresh.ram, false);
});
