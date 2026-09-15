import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu6800 } from "../../../src/components/cpus/6800.js";
import type { Cpu6800MemoryAccess, Cpu6800Snapshot, Cpu6800StepRecord } from "../../../src/components/cpus/6800.js";
import type { Ram } from "../../../src/components/memory/ram.js";
import {
  create6800LogicExample,
  create6800LogicExampleMemory,
} from "../../../src/machines/generated/6800/logic-example.js";
import { runCpu } from "../../../src/runtime/run-cpu.js";

function expectedInitialState(): Cpu6800Snapshot {
  return {
    waiting: false, a: 0x81, b: 0x22, x: 0x3456, sp: 0x0101, pc: 0x0200,
    flags: { h: true, i: false, n: true, z: true, v: true, c: true },
  };
}

function checkMemory(ram: Ram, finished: boolean, edits: readonly (readonly [number, number])[] = []): void {
  const expected = new Uint8Array(0x10000);
  // Literal program, guards, and residual stack bytes from the specification.
  expected.set([0x8e, 1, 1, 0x86, 5, 0xc6, 0xa5, 0xbd, 2, 0x20, 0xb7, 0, 0x80], 0x0200);
  expected.set([0x37, 0x84, 0x0f, 0x8a, 0x80, 0x88, 4, 0x85, 0x80, 0x27, 0x10,
    0xc4, 0x0f, 0xca, 0x80, 0xc8, 5, 0xc5, 0x7f, 0x27, 2, 0x86, 0, 0x88, 0x80, 0x8b, 0x0f, 0x33, 0x39], 0x0220);
  expected.set([0xaa, finished ? 0x10 : 0xcc, 0x55], 0x007f);
  expected[0x00fe] = 0x5a;
  expected[0x0102] = 0xa5;
  expected.set([2, 0], 0xfffe);
  if (finished) expected.set([0xa5, 2, 0x0a], 0x00ff);
  for (const [address, value] of edits) expected[address] = value;
  assert.equal(ram.size, expected.length);
  for (const [address, byte] of expected.entries()) assert.equal(ram.read(address), byte, `memory at ${address}`);
}

function expectedRecords(): readonly Cpu6800StepRecord[] {
  const steps: readonly {
    bytes: readonly number[]; changes: Partial<Cpu6800Snapshot> & { pc: number }; data?: readonly Cpu6800MemoryAccess[];
  }[] = [
    { bytes: [0x8e, 1, 1], changes: { pc: 0x0203,
      flags: { h: true, i: false, n: false, z: false, v: false, c: true } } },
    { bytes: [0x86, 5], changes: { pc: 0x0205, a: 5 } },
    { bytes: [0xc6, 0xa5], changes: { pc: 0x0207, b: 0xa5,
      flags: { h: true, i: false, n: true, z: false, v: false, c: true } } },
    { bytes: [0xbd, 2, 0x20], changes: { pc: 0x0220, sp: 0x00ff },
      data: [{ kind: "write", address: 0x0101, value: 0x0a }, { kind: "write", address: 0x0100, value: 2 }] },
    { bytes: [0x37], changes: { pc: 0x0221, sp: 0x00fe },
      data: [{ kind: "write", address: 0x00ff, value: 0xa5 }] },
    { bytes: [0x84, 0x0f], changes: { pc: 0x0223,
      flags: { h: true, i: false, n: false, z: false, v: false, c: true } } },
    { bytes: [0x8a, 0x80], changes: { pc: 0x0225, a: 0x85,
      flags: { h: true, i: false, n: true, z: false, v: false, c: true } } },
    { bytes: [0x88, 4], changes: { pc: 0x0227, a: 0x81 } },
    { bytes: [0x85, 0x80], changes: { pc: 0x0229 } },
    { bytes: [0x27, 0x10], changes: { pc: 0x022b } },
    { bytes: [0xc4, 0x0f], changes: { pc: 0x022d, b: 5,
      flags: { h: true, i: false, n: false, z: false, v: false, c: true } } },
    { bytes: [0xca, 0x80], changes: { pc: 0x022f, b: 0x85,
      flags: { h: true, i: false, n: true, z: false, v: false, c: true } } },
    { bytes: [0xc8, 5], changes: { pc: 0x0231, b: 0x80 } },
    { bytes: [0xc5, 0x7f], changes: { pc: 0x0233,
      flags: { h: true, i: false, n: false, z: true, v: false, c: true } } },
    { bytes: [0x27, 2], changes: { pc: 0x0237 } },
    { bytes: [0x88, 0x80], changes: { pc: 0x0239, a: 1,
      flags: { h: true, i: false, n: false, z: false, v: false, c: true } } },
    { bytes: [0x8b, 0x0f], changes: { pc: 0x023b, a: 0x10,
      flags: { h: true, i: false, n: false, z: false, v: false, c: false } } },
    { bytes: [0x33], changes: { pc: 0x023c, b: 0xa5, sp: 0x00ff },
      data: [{ kind: "read", address: 0x00ff, value: 0xa5 }] },
    { bytes: [0x39], changes: { pc: 0x020a, sp: 0x0101 },
      data: [{ kind: "read", address: 0x0100, value: 2 }, { kind: "read", address: 0x0101, value: 0x0a }] },
    { bytes: [0xb7, 0, 0x80], changes: { pc: 0x020d },
      data: [{ kind: "write", address: 0x0080, value: 0x10 }] },
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

test("the 6800 logic factories create independent state and complete memory images", () => {
  const memory = create6800LogicExampleMemory();
  checkMemory(memory, false);
  memory.write(0x0228, 0);
  memory.write(0x0101, 0xff);
  memory.write(0xfffe, 0xff);
  const second = create6800LogicExampleMemory();
  assert.notStrictEqual(second, memory);
  checkMemory(second, false);
  const first = create6800LogicExample();
  assert.deepEqual(first.cpu.snapshot(), expectedInitialState());
  assert.equal(first.endAddress, 0x020d);
  checkMemory(first.ram, false);
  runCpu(first.cpu, { maxSteps: 20, endAddress: first.endAddress });
  const fresh = create6800LogicExample();
  assert.notStrictEqual(fresh.cpu, first.cpu);
  assert.notStrictEqual(fresh.ram, first.ram);
  assert.deepEqual(fresh.cpu.snapshot(), expectedInitialState());
  checkMemory(fresh.ram, false);
});

test("the 6800 logic example exercises all eight forms, branches on BIT flags, and restores B/SP with exact records", (t) => {
  const { cpu, ram, endAddress } = create6800LogicExample();
  const read = t.mock.method(ram, "read");
  const write = t.mock.method(ram, "write");
  const expected = expectedRecords();
  const result = runCpu(cpu, { maxSteps: 20, endAddress });
  assert.equal(result.stopReason, "completed");
  assert.deepEqual(result.records, expected);
  const accesses = expected.flatMap(record => record.accesses);
  assert.deepEqual(read.mock.calls.map(call => call.arguments),
    accesses.filter(access => access.kind === "read").map(access => [access.address]));
  assert.deepEqual(write.mock.calls.map(call => call.arguments), [[0x0101, 0x0a], [0x0100, 2], [0x00ff, 0xa5], [0x0080, 0x10]]);
  read.mock.restore();
  write.mock.restore();
  checkMemory(ram, true);
  const final = {
    waiting: false, a: 0x10, b: 0xa5, x: 0x3456, sp: 0x0101, pc: 0x020d,
    flags: { h: true, i: false, n: false, z: false, v: false, c: false },
  };
  assert.deepEqual(cpu.snapshot(), final);
  assert.deepEqual(runCpu(cpu, { maxSteps: 0, endAddress }), { records: [], stopReason: "completed" });
  assert.deepEqual(cpu.step(), {
    instruction: { address: 0x020d, bytes: [0] }, before: final, after: final,
    accesses: [{ kind: "read", address: 0x020d, value: 0 }], outcome: "unsupported", reason: "opcode",
  });
});

test("the 6800 logic example resumes from snapshots after either BIT and before returning", () => {
  for (const pauseAfter of [9, 14, 18]) {
    const { cpu, ram, endAddress } = create6800LogicExample();
    const first = runCpu(cpu, { maxSteps: pauseAfter, endAddress });
    const saved = structuredClone(first);
    assert.equal(first.stopReason, "step-limit");
    const resumed = new Cpu6800(ram, cpu.snapshot());
    const rest = runCpu(resumed, { maxSteps: 20 - pauseAfter, endAddress });
    assert.equal(rest.stopReason, "completed");
    assert.deepEqual([...first.records, ...rest.records], expectedRecords());
    checkMemory(ram, true);
    resumed.reset();
    ram.write(0x0228, 0);
    assert.deepEqual(first, saved);
  }
});

test("6800 logic reset preserves final registers, flags except I, and all RAM; a fresh factory restarts the lesson", () => {
  const { cpu, ram, endAddress } = create6800LogicExample();
  runCpu(cpu, { maxSteps: 20, endAddress });
  const before = cpu.snapshot();
  const after = { ...before, pc: 0x0200, flags: { ...before.flags, i: true } };
  assert.deepEqual(cpu.reset(), {
    before, after,
    accesses: [{ kind: "read", address: 0xfffe, value: 2 }, { kind: "read", address: 0xffff, value: 0 }],
  });
  checkMemory(ram, true);
  assert.deepEqual(cpu.step().after, { ...after, pc: 0x0203 });
  const fresh = create6800LogicExample();
  assert.deepEqual(fresh.cpu.snapshot(), expectedInitialState());
  checkMemory(fresh.ram, false);
});

test("editing either BIT mask selects the early return or fallback without losing the saved B or return address", () => {
  for (const { address, mask, answer, flags, pcs } of [
    { address: 0x0228, mask: 0, answer: 0x81,
      flags: { h: true, i: false, n: true, z: false, v: false, c: true },
      pcs: [0x0200, 0x0203, 0x0205, 0x0207, 0x0220, 0x0221, 0x0223, 0x0225, 0x0227, 0x0229, 0x023b, 0x023c, 0x020a] },
    { address: 0x0232, mask: 0x80, answer: 0x8f,
      flags: { h: false, i: false, n: true, z: false, v: false, c: false },
      pcs: [0x0200, 0x0203, 0x0205, 0x0207, 0x0220, 0x0221, 0x0223, 0x0225, 0x0227, 0x0229,
        0x022b, 0x022d, 0x022f, 0x0231, 0x0233, 0x0235, 0x0237, 0x0239, 0x023b, 0x023c, 0x020a] },
  ]) {
    const { cpu, ram, endAddress } = create6800LogicExample();
    ram.write(address, mask);
    const result = runCpu(cpu, { maxSteps: pcs.length, endAddress });
    assert.equal(result.stopReason, "completed");
    assert.deepEqual(result.records.map(record => record.instruction?.address), pcs);
    assert.ok(result.records.every(record => record.outcome === "executed"));
    assert.deepEqual(cpu.snapshot(), { waiting: false, a: answer, b: 0xa5, x: 0x3456, sp: 0x0101, pc: 0x020d, flags });
    assert.deepEqual(result.records.flatMap(record => record.accesses).filter(access => access.kind === "write"), [
      { kind: "write", address: 0x0101, value: 0x0a }, { kind: "write", address: 0x0100, value: 2 },
      { kind: "write", address: 0x00ff, value: 0xa5 }, { kind: "write", address: 0x0080, value: answer },
    ]);
    checkMemory(ram, true, [[address, mask], [0x0080, answer]]);
  }
});
